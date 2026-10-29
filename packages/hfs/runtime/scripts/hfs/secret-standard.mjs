// secret-standard.mjs - the app secrets standard (ruling app-secrets-one-standard, contexts/project/stacks.md
// PROJECT-STACKS-5) judged and repaired: `audit` names every deviation, `migrate` moves a member to `<member>.enc.yaml` sealed
// to its environment's recipients, `split` divides a member that mixes providers into one member per provider. The dry run
// reads only envelope key names and recipients; an executed move decrypts in memory through the sops seam and seals again,
// never writing plaintext to disk or printing a value.
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "../../engine/yaml.mjs";
import { lsFiles } from "../api/git/ls-files.mjs";
import { MEMBER_SUFFIX, isLegacyName, memberOfName } from "../lib/sealed-member.mjs";
import { configuredRecipients } from "./secret-init.mjs";
import { envelopeOf, validateMap } from "./secret-document.mjs";
import { deleteSealed, fileOf, sealedFiles, writeSecret } from "./secret-store.mjs";
import { SecretError } from "./secret-errors.mjs";

/** The provider a key belongs to: its first word (`SEPAY_IPN_SECRET_KEY` is `sepay`, `OPENROUTER_API_KEY` is `openrouter`). */
export const providerOf = (key) => key.split("_")[0].toLowerCase();

const sameSet = (left, right) => left.length === right.length && left.every((item) => right.includes(item));
const keyList = (keys) => keys.join(", ");

/** The keys an environment's `secrets:` declares for `member`: an entry naming `key` with that `member`, or a whole-member entry. */
function declaredKeys(spec, member, keys) {
  const entries = Array.isArray(spec?.secrets) ? spec.secrets : [];
  const memberOfEntry = (entry) => entry?.member ?? /^secrets\/([a-z0-9-]+)/u.exec(entry?.where ?? "")?.[1] ?? entry?.name;
  if (entries.some((entry) => entry?.key === undefined && memberOfEntry(entry) === member)) return keys;
  return entries.filter((entry) => entry?.key !== undefined && memberOfEntry(entry) === member).map((entry) => entry.key);
}

/** The tracked member file names of one environment, or null outside a git work tree. */
function trackedNames(repoRoot, environment) {
  const run = lsFiles(["-z", "--", `.starcistacks/${environment}/secrets`], { cwd: repoRoot, encoding: "utf8" });
  if (run.error || run.status !== 0) return null;
  return new Set(String(run.stdout).split("\0").filter(Boolean).map((file) => path.posix.basename(file)));
}

const recipientsFor = (repoRoot, file) => {
  try { return configuredRecipients(repoRoot, file); } catch { return []; }
};

/**
 * Every deviation of the app at `repoRoot` (one environment, else each with a secrets folder): LEGACY_MEMBER, MIXED_PROVIDERS,
 * RECIPIENT_DRIFT, UNDECLARED_KEY (only where application-stacks.yaml declares the environment), UNTRACKED. Names only.
 */
export function auditSecrets(repoRoot, environment = null) {
  const stacksFile = path.join(repoRoot, ".starcistacks", "application-stacks.yaml");
  const stacks = fs.existsSync(stacksFile) ? parseYaml(fs.readFileSync(stacksFile, "utf8")) ?? {} : {};
  const root = path.join(repoRoot, ".starcistacks");
  const environments = environment
    ? [environment]
    : (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [])
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "secrets")))
        .map((entry) => entry.name)
        .sort();
  const findings = [];
  for (const env of environments) {
    const directory = path.join(root, env, "secrets");
    const spec = stacks.environments?.[env];
    const tracked = trackedNames(repoRoot, env);
    for (const name of sealedFiles(directory)) {
      const member = memberOfName(name);
      const file = path.join(directory, name);
      const envelope = envelopeOf(fs.readFileSync(file, "utf8"));
      const add = (code, detail) => findings.push({ code, env, member: name, detail });
      const providers = [...new Set(envelope.keys.map(providerOf))];
      if (isLegacyName(name)) add("LEGACY_MEMBER", `is a dotenv .enc member; move it: starci app secret migrate ${env} ${member} [--to <provider>] --execute`);
      if (providers.length > 1) add("MIXED_PROVIDERS", `holds keys of ${providers.length} providers by their first word (${providers.join(", ")}); split it: starci app secret split ${env} ${member} --execute`);
      const wanted = recipientsFor(repoRoot, path.join(directory, `${member}${MEMBER_SUFFIX}`));
      if (!isLegacyName(name) && wanted.length && !sameSet(wanted, envelope.recipients))
        add("RECIPIENT_DRIFT", `is sealed to ${keyList(envelope.recipients)}, its environment's rule names ${keyList(wanted)}; seal it again: starci app secret migrate ${env} ${member} --execute`);
      if (spec) {
        const declared = declaredKeys(spec, member, envelope.keys);
        const missing = envelope.keys.filter((key) => !declared.includes(key));
        if (missing.length) add("UNDECLARED_KEY", `holds ${keyList(missing)}, not declared in environments.${env}.secrets of application-stacks.yaml`);
      }
      if (tracked && !tracked.has(name)) add("UNTRACKED", "is not committed; commit it (it is ciphertext)");
    }
    for (const entry of Array.isArray(spec?.secrets) ? spec.secrets : []) {
      const member = entry?.member ?? /^secrets\/([a-z0-9-]+)/u.exec(entry?.where ?? "")?.[1];
      if (member && !fs.existsSync(fileOf(directory, member)))
        findings.push({ code: "MISSING", env, member, detail: `is declared by environments.${env}.secrets ${entry.name} but no ${member}${MEMBER_SUFFIX} is sealed; remove the entry or seal the member` });
    }
  }
  return findings;
}

const indentOf = (line) => /^ */u.exec(line)[0].length;
const meaningful = (line) => line.trim() !== "" && !line.trimStart().startsWith("#");

/** The [from, to) lines of the block under line `at`: every following line indented deeper, or blank, or a comment. */
function blockOf(lines, at) {
  const indent = indentOf(lines[at]);
  let to = at + 1;
  let last = at;
  for (; to < lines.length && (!meaningful(lines[to]) || indentOf(lines[to]) > indent); to += 1) if (meaningful(lines[to])) last = to;
  return { from: at + 1, to: last + 1 };
}

/** The line of `key:` among the direct children of a block, or -1. */
function childLine(lines, block, key) {
  const first = lines.slice(block.from, block.to).find(meaningful);
  if (first === undefined) return -1;
  const indent = indentOf(first);
  for (let at = block.from; at < block.to; at += 1)
    if (meaningful(lines[at]) && indentOf(lines[at]) === indent && lines[at].trimStart().startsWith(`${key}:`)) return at;
  return -1;
}

/**
 * Declares each of `keys` of `member` in environment `environment`'s `secrets:` of application-stacks.yaml, one entry per key
 * (`name: <kebab of the key>, member, key, where: secrets/<member>`), so the key is materialized as its own `<KEY>_FILE`. A key
 * already declared is left alone. Edits the text in place (comments and order kept) and proves the result parses to the
 * expected document; a shape this edit cannot place returns the keys to declare by hand.
 */
export function declareKeys(repoRoot, environment, member, keys) {
  const file = path.join(repoRoot, ".starcistacks", "application-stacks.yaml");
  if (!fs.existsSync(file)) return { declared: [], byHand: [] };
  const text = fs.readFileSync(file, "utf8");
  const document = parseYaml(text) ?? {};
  const spec = document.environments?.[environment];
  if (!spec) return { declared: [], byHand: [] };
  const missing = keys.filter((key) => !declaredKeys(spec, member, keys).includes(key));
  if (!missing.length) return { declared: [], byHand: [] };
  // A swarm environment's secret is a versioned external secret its stack file names (runtimeName, deploy grants): its
  // declaration is wired with the stack, not appended here.
  if (spec.runtime === "docker-swarm") return { declared: [], byHand: missing };
  const sibling = Object.values(document.environments).flatMap((each) => (Array.isArray(each?.secrets) ? each.secrets : []))[0];
  const entries = missing.map((key) => ({
    name: key.toLowerCase().replaceAll("_", "-"), member, key, where: `secrets/${member}`,
    recipientPolicy: "its environment's rule of the app's managed .sops.yaml",
    keyCustody: sibling?.keyCustody ?? "SOPS_AGE_KEY in the harness secret.env",
  }));
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const root = lines.findIndex((line) => /^environments:\s*(?:#.*)?$/u.test(line));
  const envLine = root < 0 ? -1 : childLine(lines, blockOf(lines, root), environment);
  const secrets = envLine < 0 ? -1 : childLine(lines, blockOf(lines, envLine), "secrets");
  if (secrets < 0 || !/^ *secrets:\s*(?:\[\s*\])?\s*(?:#.*)?$/u.test(lines[secrets])) return { declared: [], byHand: missing };
  const pad = indentOf(lines[secrets]);
  lines[secrets] = `${" ".repeat(pad)}secrets:`;
  const items = blockOf(lines, secrets);
  const firstItem = lines.slice(items.from, items.to).find(meaningful);
  const dash = " ".repeat(firstItem === undefined ? pad + 2 : indentOf(firstItem));
  const rendered = entries.flatMap((entry) => Object.entries(entry).map(([name, value], index) => `${dash}${index ? "  " : "- "}${name}: ${JSON.stringify(value)}`));
  lines.splice(items.to, 0, ...rendered);
  const expected = structuredClone(document);
  const target = expected.environments[environment];
  target.secrets = [...(Array.isArray(target.secrets) ? target.secrets : []), ...entries];
  const edited = lines.join(newline);
  let parsed;
  try { parsed = parseYaml(edited); } catch { parsed = undefined; }
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) return { declared: [], byHand: missing };
  fs.writeFileSync(file, edited);
  return { declared: missing, byHand: [] };
}

/** `starci app secret audit [<env>]`: each deviation on its own line and exit 1, else one clean line and exit 0. */
export function printAudit(repoRoot, environment, stdout) {
  const findings = auditSecrets(repoRoot, environment);
  for (const finding of findings) stdout(`${finding.code} ${finding.env}/${finding.member}: ${finding.detail}\n`);
  if (findings.length) return 1;
  stdout(`app secrets follow the standard${environment ? ` in ${environment}` : ""}\n`);
  return 0;
}

/** Seals `map` as a fresh member `<slug>.enc.yaml` (no merge), to the recipients its environment's rule names. */
function sealFresh(directory, slug, map, sops) {
  const file = path.join(directory, `${slug}${MEMBER_SUFFIX}`);
  writeSecret({ file, values: map, age: [], sops });
  return file;
}

function plannedMember(directory, member) {
  const file = fileOf(directory, member);
  if (!fs.existsSync(file)) throw new SecretError(`${member} is not a sealed member of this environment`);
  return { file, envelope: envelopeOf(fs.readFileSync(file, "utf8")) };
}

/**
 * `migrate <env> <member> [--to <slug>] [--execute]`: moves a member (a legacy dotenv `.enc`, or one sealed to other recipients
 * than its rule) to `<slug>.enc.yaml` sealed to the environment's recipients, then removes the old file. A dry run until --execute.
 */
export function migrateMember({ directory, environment, member, to, execute, sops, stdout }) {
  const { file, envelope } = plannedMember(directory, member);
  const target = to ?? member;
  const targetFile = path.join(directory, `${target}${MEMBER_SUFFIX}`);
  if (targetFile !== file && fs.existsSync(targetFile)) throw new SecretError(`${environment}/${target}${MEMBER_SUFFIX} already exists; migrate never merges two members`);
  const plan = `${environment}/${path.basename(file)} (${keyList(envelope.keys)}) to ${environment}/${target}${MEMBER_SUFFIX}`;
  if (!execute) {
    stdout(`dry run: would move ${plan}; add --execute\n`);
    return 0;
  }
  const seam = sops();
  const map = seam.decrypt(file, envelope.format);
  validateMap(map);
  if (!sameSet(Object.keys(map), envelope.keys)) throw new SecretError("sops returned keys that differ from the envelope");
  // Re-sealing the same file replaces every key it holds, so it reads nothing more and stays in place until the new one lands.
  sealFresh(directory, target, map, seam);
  if (targetFile !== file) deleteSealed(file);
  stdout(`moved ${plan}\n`);
  return 0;
}

/**
 * `split <env> <member> [--execute]`: divides a member that mixes providers into one `<provider>.enc.yaml` per provider
 * (providerOf), each sealed to the environment's recipients, then removes the old file. A dry run until --execute.
 */
export function splitMember({ directory, environment, member, execute, sops, stdout }) {
  const { file, envelope } = plannedMember(directory, member);
  const groups = new Map();
  for (const key of envelope.keys) groups.set(providerOf(key), [...(groups.get(providerOf(key)) ?? []), key]);
  if (groups.size < 2) throw new SecretError(`${environment}/${member} holds one provider's keys; nothing to split (migrate renames a member)`);
  for (const provider of groups.keys()) {
    const target = path.join(directory, `${provider}${MEMBER_SUFFIX}`);
    if (target !== file && fs.existsSync(target)) throw new SecretError(`${environment}/${provider}${MEMBER_SUFFIX} already exists; split never merges into a member`);
  }
  const plan = [...groups].map(([provider, keys]) => `${provider}${MEMBER_SUFFIX} (${keyList(keys)})`).join(", ");
  if (!execute) {
    stdout(`dry run: would split ${environment}/${path.basename(file)} into ${plan}; add --execute\n`);
    return 0;
  }
  const seam = sops();
  const map = seam.decrypt(file, envelope.format);
  validateMap(map);
  if (!sameSet(Object.keys(map), envelope.keys)) throw new SecretError("sops returned keys that differ from the envelope");
  const own = groups.has(member) && path.basename(file) === `${member}${MEMBER_SUFFIX}`;
  for (const [provider, keys] of groups) {
    if (own && provider === member) continue;
    sealFresh(directory, provider, Object.fromEntries(keys.map((key) => [key, map[key]])), seam);
  }
  if (own) {
    // The member keeps only its own provider's keys: sealed beside it first, then moved over it, so no key is ever unsealed.
    const staged = sealFresh(directory, `${member}-split`, Object.fromEntries(groups.get(member).map((key) => [key, map[key]])), seam);
    fs.renameSync(staged, file);
  } else deleteSealed(file);
  stdout(`split ${environment}/${path.basename(file)} into ${plan}\n`);
  return 0;
}

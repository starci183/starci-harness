// secret-standard.mjs - the app secrets standard (ruling app-secrets-one-standard, contexts/project/stacks.md
// PROJECT-STACKS-5) judged and repaired: `audit` names every deviation, `migrate` moves a member to `<member>.enc.yaml` sealed
// to its environment's recipients (or merges it into an existing member), `split` divides a member into one member per provider
// or per the owner's --group. A member every key of which the stack declares in it is a deliberate group, not a mix. The dry run
// reads only envelope key names and recipients; an executed move decrypts in memory through the sops seam and seals again,
// never writing plaintext to disk or printing a value.
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "../../engine/yaml.mjs";
import { lsFiles } from "../api/git/ls-files.mjs";
import { MEMBER_SUFFIX, isLegacyName, memberOfName } from "../lib/sealed-member.mjs";
import { configuredRecipients } from "./secret-init.mjs";
import { type SecretEnvelope, envelopeOf, validateMap } from "./secret-document.mjs";
import { deleteSealed, fileOf, sealedFiles, writeSecret } from "./secret-store.mjs";
import { SecretError } from "./secret-errors.mjs";
import type { SecretSops } from "./secret-sops.mjs";

/** One entry of an environment's `secrets:` in application-stacks.yaml. */
export interface SecretsEntry {
  name?: string;
  member?: string;
  where?: string;
  key?: string;
  keys?: string[];
  keyCustody?: string;
  recipientPolicy?: string;
}

/** One environment of application-stacks.yaml, as far as the secrets standard reads it. */
export interface EnvironmentSpec {
  secrets?: SecretsEntry[];
  runtime?: string;
  deploy?: { remote?: { sealed?: string | Record<string, string>; serverRecipient?: string } };
  [name: string]: unknown;
}

/** application-stacks.yaml, as far as the secrets standard reads it. */
export interface StacksDocument {
  environments?: Record<string, EnvironmentSpec>;
  [name: string]: unknown;
}

/** One deviation from the app secrets standard: a code, the environment and member it concerns and a public detail. */
export interface AuditFinding {
  code: string;
  env: string;
  member: string;
  detail: string;
}

/** A line range of a YAML block: [from, to). */
interface Block {
  from: number;
  to: number;
}

/** The ways a move (migrate, split) is asked for. */
export interface MoveOptions {
  directory: string;
  environment: string;
  member: string;
  to?: string | undefined;
  intoExisting?: boolean | undefined;
  execute?: boolean | undefined;
  sops: () => SecretSops;
  stdout: (text: string) => unknown;
}

/** One target of a move: its keys, whether it is the source itself, whether it already exists and what it already holds. */
interface PlannedTarget {
  target: string;
  keys: string[];
  own: boolean;
  existing: boolean;
  overlap: string[];
  file: string;
}

/** The provider a key belongs to: its first word (`SEPAY_IPN_SECRET_KEY` is `sepay`, `OPENROUTER_API_KEY` is `openrouter`). */
export const providerOf = (key: string): string => (key.split("_")[0] as string).toLowerCase();

const sameSet = (left: string[], right: string[]): boolean => left.length === right.length && left.every((item) => right.includes(item));
const keyList = (keys: string[]): string => keys.join(", ");

/** The member a `secrets:` entry names: `member`, else the slug of `where`, else its `name`. */
const memberOfEntry = (entry: SecretsEntry | undefined): string | undefined => entry?.member ?? /^secrets\/([a-z0-9-]+)/u.exec(entry?.where ?? "")?.[1] ?? entry?.name;

/** The keys an environment's `secrets:` declares for `member`: an entry naming `key` with that `member`, or a whole-member entry. */
function declaredKeys(spec: EnvironmentSpec | undefined, member: string, keys: string[]): string[] {
  const entries = Array.isArray(spec?.secrets) ? spec.secrets : [];
  if (entries.some((entry) => entry?.key === undefined && memberOfEntry(entry) === member)) return keys;
  return entries.filter((entry) => entry?.key !== undefined && memberOfEntry(entry) === member).map((entry) => entry.key as string);
}

/** The keys of the one sealed SSH member `deploy.remote.sealed` names (stack/remote.mjs): the deploy transport reads exactly these. */
const SSH_GROUP: readonly string[] = Object.freeze(["VPS_HOST", "VPS_USER", "privateKey", "knownHosts"]);

/**
 * True when the stack groups `member` on purpose: every key of it is declared in the environment's `secrets:`, per key (`key` with
 * `member: <member>`) or in the `keys` list of an entry naming the member, or is a key of the sealed SSH member the deploy names.
 * A member the owner groups (an app's own keys, the keys one service reads, the VPS session) holds keys of several first words by design.
 */
function declaredGroup(spec: EnvironmentSpec | undefined, member: string, keys: string[]): boolean {
  const entries = Array.isArray(spec?.secrets) ? spec.secrets : [];
  const sealed = spec?.deploy?.remote?.sealed;
  const ssh: readonly string[] = (typeof sealed === "string" ? [sealed] : Object.values(sealed ?? {})).includes(member) ? SSH_GROUP : [];
  const declared = (key: string): boolean => ssh.includes(key) || entries.some((entry) => memberOfEntry(entry) === member
    && (entry?.key === key || (Array.isArray(entry?.keys) && entry.keys.includes(key))));
  return keys.length > 0 && keys.every(declared);
}

/** The tracked member file names of one environment, or null outside a git work tree. */
function trackedNames(repoRoot: string, environment: string): Set<string> | null {
  const run = lsFiles(["-z", "--", `.starcistacks/${environment}/secrets`], { cwd: repoRoot, encoding: "utf8" });
  if (run.error || run.status !== 0) return null;
  return new Set(String(run.stdout).split("\0").filter(Boolean).map((file) => path.posix.basename(file)));
}

const recipientsFor = (repoRoot: string, file: string): string[] => {
  try { return configuredRecipients(repoRoot, file); } catch { return []; }
};

/**
 * Every deviation of the app at `repoRoot` (one environment, else each with a secrets folder): LEGACY_MEMBER, MIXED_PROVIDERS,
 * RECIPIENT_DRIFT, UNDECLARED_KEY (only where application-stacks.yaml declares the environment), UNTRACKED. Names only.
 */
export function auditSecrets(repoRoot: string, environment: string | null = null): AuditFinding[] {
  const stacksFile = path.join(repoRoot, ".starcistacks", "application-stacks.yaml");
  const stacks: StacksDocument = fs.existsSync(stacksFile) ? parseYaml(fs.readFileSync(stacksFile, "utf8")) ?? {} : {};
  const root = path.join(repoRoot, ".starcistacks");
  const environments = environment
    ? [environment]
    : (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [])
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "secrets")))
        .map((entry) => entry.name)
        .sort();
  const findings: AuditFinding[] = [];
  for (const env of environments) {
    const directory = path.join(root, env, "secrets");
    const spec = stacks.environments?.[env];
    const tracked = trackedNames(repoRoot, env);
    for (const name of sealedFiles(directory)) {
      const member = memberOfName(name);
      const file = path.join(directory, name);
      const envelope = envelopeOf(fs.readFileSync(file, "utf8"));
      const add = (code: string, detail: string): number => findings.push({ code, env, member: name, detail });
      const providers = [...new Set(envelope.keys.map(providerOf))];
      if (isLegacyName(name)) add("LEGACY_MEMBER", `is a dotenv .enc member; move it: starci app secret migrate --env ${env} ${member} [--to <provider>] --execute`);
      if (providers.length > 1 && !declaredGroup(spec, member, envelope.keys))
        add("MIXED_PROVIDERS", `holds keys of ${providers.length} providers by their first word (${providers.join(", ")}) that the stack does not group in it; split it (starci app secret split --env ${env} ${member} [--group KEY=member] --execute) or declare its keys in environments.${env}.secrets (an entry naming ${member} with keys: [...])`);
      const wanted = recipientsFor(repoRoot, path.join(directory, `${member}${MEMBER_SUFFIX}`));
      if (!isLegacyName(name) && wanted.length && !sameSet(wanted, envelope.recipients))
        add("RECIPIENT_DRIFT", `is sealed to ${keyList(envelope.recipients)}, its environment's rule names ${keyList(wanted)}; seal it again: starci app secret migrate --env ${env} ${member} --execute`);
      if (spec) {
        const declared = declaredKeys(spec, member, envelope.keys);
        const missing = envelope.keys.filter((key) => !declared.includes(key));
        if (missing.length) add("UNDECLARED_KEY", `holds ${keyList(missing)}, not declared in environments.${env}.secrets of application-stacks.yaml`);
      }
      if (tracked && !tracked.has(name)) add("UNTRACKED", "is not committed; commit it (it is ciphertext)");
    }
    const drift = serverRecipientDrift(repoRoot, env, spec);
    if (drift) findings.push({ code: "RECIPIENT_DRIFT", env, member: ".sops.yaml", detail: drift });
    for (const entry of Array.isArray(spec?.secrets) ? spec.secrets : []) {
      const member = entry?.member ?? /^secrets\/([a-z0-9-]+)/u.exec(entry?.where ?? "")?.[1];
      if (member && !fs.existsSync(fileOf(directory, member)))
        findings.push({ code: "MISSING", env, member, detail: `is declared by environments.${env}.secrets ${entry.name} but no ${member}${MEMBER_SUFFIX} is sealed; remove the entry or seal the member` });
    }
  }
  return findings;
}

const indentOf = (line: string): number => (/^ */u.exec(line) as RegExpExecArray)[0].length;
const meaningful = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");

/** The [from, to) lines of the block under line `at`: every following line indented deeper, or blank, or a comment. */
function blockOf(lines: string[], at: number): Block {
  const indent = indentOf(lines[at] as string);
  let to = at + 1;
  let last = at;
  for (; to < lines.length && (!meaningful(lines[to] as string) || indentOf(lines[to] as string) > indent); to += 1) if (meaningful(lines[to] as string)) last = to;
  return { from: at + 1, to: last + 1 };
}

/** The line of `key:` among the direct children of a block, or -1. */
function childLine(lines: string[], block: Block, key: string): number {
  const first = lines.slice(block.from, block.to).find(meaningful);
  if (first === undefined) return -1;
  const indent = indentOf(first);
  for (let at = block.from; at < block.to; at += 1)
    if (meaningful(lines[at] as string) && indentOf(lines[at] as string) === indent && (lines[at] as string).trimStart().startsWith(`${key}:`)) return at;
  return -1;
}

/**
 * Declares each of `keys` of `member` in environment `environment`'s `secrets:` of application-stacks.yaml, one entry per key
 * (`name: <kebab of the key>, member, key, where: secrets/<member>`), so the key is materialized as its own `<KEY>_FILE`. A key
 * already declared is left alone. Edits the text in place (comments and order kept) and proves the result parses to the
 * expected document; a shape this edit cannot place returns the keys to declare by hand.
 */
export function declareKeys(
  repoRoot: string,
  environment: string,
  member: string,
  keys: string[],
): { declared: string[]; byHand: string[] } {
  const file = path.join(repoRoot, ".starcistacks", "application-stacks.yaml");
  if (!fs.existsSync(file)) return { declared: [], byHand: [] };
  const text = fs.readFileSync(file, "utf8");
  const document: StacksDocument = parseYaml(text) ?? {}; // reason: parsed YAML boundary, read from disk
  const spec = document.environments?.[environment];
  if (!spec) return { declared: [], byHand: [] };
  const missing = keys.filter((key) => !declaredKeys(spec, member, keys).includes(key));
  if (!missing.length) return { declared: [], byHand: [] };
  // A swarm environment's secret is a versioned external secret its stack file names (runtimeName, deploy grants): its
  // declaration is wired with the stack, not appended here.
  if (spec.runtime === "docker-swarm") return { declared: [], byHand: missing };
  const sibling = Object.values(document.environments as Record<string, EnvironmentSpec>).flatMap((each) => (Array.isArray(each?.secrets) ? each.secrets : []))[0];
  const entries: SecretsEntry[] = missing.map((key) => ({
    name: key.toLowerCase().replaceAll("_", "-"), member, key, where: `secrets/${member}`,
    recipientPolicy: "its environment's rule of the app's managed .sops.yaml",
    keyCustody: sibling?.keyCustody ?? "SOPS_AGE_KEY in the harness secret.env",
  }));
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const root = lines.findIndex((line) => /^environments:\s*(?:#.*)?$/u.test(line));
  const envLine = root < 0 ? -1 : childLine(lines, blockOf(lines, root), environment);
  const secrets = envLine < 0 ? -1 : childLine(lines, blockOf(lines, envLine), "secrets");
  if (secrets < 0 || !/^ *secrets:\s*(?:\[\s*\])?\s*(?:#.*)?$/u.test(lines[secrets] as string)) return { declared: [], byHand: missing };
  const pad = indentOf(lines[secrets] as string);
  lines[secrets] = `${" ".repeat(pad)}secrets:`;
  const items = blockOf(lines, secrets);
  const firstItem = lines.slice(items.from, items.to).find(meaningful);
  const dash = " ".repeat(firstItem === undefined ? pad + 2 : indentOf(firstItem));
  const rendered = entries.flatMap((entry) => Object.entries(entry).map(([name, value], index) => `${dash}${index ? "  " : "- "}${name}: ${JSON.stringify(value)}`));
  lines.splice(items.to, 0, ...rendered);
  const expected = structuredClone(document);
  const target = (expected.environments as Record<string, EnvironmentSpec>)[environment] as EnvironmentSpec;
  target.secrets = [...(Array.isArray(target.secrets) ? target.secrets : []), ...entries];
  const edited = lines.join(newline);
  let parsed: unknown;
  try { parsed = parseYaml(edited); } catch { parsed = undefined; }
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) return { declared: [], byHand: missing };
  fs.writeFileSync(file, edited);
  return { declared: missing, byHand: [] };
}

/**
 * Records `recipient` as `environments.<environment>.deploy.remote.serverRecipient` of application-stacks.yaml: the public age
 * recipient of the deploy server's own identity, which `starci app secret server-key` made on the server and audit holds the
 * environment's rule to. Edits the text in place (comments and order kept), replacing the line or adding it as the last child of
 * `remote:`, and proves the result parses to the expected document; a shape this edit cannot place is refused.
 */
export function recordServerRecipient(repoRoot: string, environment: string, recipient: string): void {
  const file = path.join(repoRoot, ".starcistacks", "application-stacks.yaml");
  const text = fs.readFileSync(file, "utf8");
  const document: StacksDocument = parseYaml(text) ?? {}; // reason: parsed YAML boundary, read from disk
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const root = lines.findIndex((line) => /^environments:\s*(?:#.*)?$/u.test(line));
  const envLine = root < 0 ? -1 : childLine(lines, blockOf(lines, root), environment);
  const deploy = envLine < 0 ? -1 : childLine(lines, blockOf(lines, envLine), "deploy");
  const remote = deploy < 0 ? -1 : childLine(lines, blockOf(lines, deploy), "remote");
  const unplaced = new SecretError(`cannot record the server recipient in environments.${environment}.deploy.remote of application-stacks.yaml; add serverRecipient: ${recipient} there by hand`);
  if (remote < 0 || !/^ *remote:\s*(?:#.*)?$/u.test(lines[remote] as string)) throw unplaced;
  const block = blockOf(lines, remote);
  const own = childLine(lines, block, "serverRecipient");
  const first = lines.slice(block.from, block.to).find(meaningful);
  const pad = " ".repeat(first === undefined ? indentOf(lines[remote] as string) + 2 : indentOf(first));
  if (own >= 0) lines[own] = `${pad}serverRecipient: ${recipient}`;
  else lines.splice(block.to, 0, `${pad}serverRecipient: ${recipient}`);
  const expected = structuredClone(document);
  const expectedEnvironment = (expected.environments as Record<string, EnvironmentSpec>)[environment] as EnvironmentSpec & {
    deploy: { remote: { serverRecipient?: string } };
  };
  expectedEnvironment.deploy.remote.serverRecipient = recipient;
  const edited = lines.join(newline);
  let parsed: unknown;
  try { parsed = parseYaml(edited); } catch { parsed = undefined; }
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) throw unplaced;
  if (edited !== text) fs.writeFileSync(file, edited);
}

/**
 * The RECIPIENT_DRIFT of an environment's rule against its deploy server: a rule that does not name the recorded
 * `deploy.remote.serverRecipient` together with another recipient (the owner key), or a production swarm deploy with a remote
 * and no server recipient recorded. Null when the rule holds.
 */
function serverRecipientDrift(repoRoot: string, env: string, spec: EnvironmentSpec | undefined): string | null {
  const remote = spec?.deploy?.remote;
  if (!remote || typeof remote !== "object") return null;
  const server = remote.serverRecipient;
  if (server === undefined)
    return env === "production" && spec.runtime === "docker-swarm"
      ? `records no deploy server recipient; production is sealed to the server key and the owner key: starci app secret server-key --env ${env} --execute`
      : null;
  const rule = recipientsFor(repoRoot, path.join(repoRoot, ".starcistacks", env, "secrets", `member${MEMBER_SUFFIX}`));
  if (!rule.includes(server)) return `its rule names ${keyList(rule) || "no recipient"}, not the deploy server recipient ${server}; run starci app secret server-key --env ${env} --execute`;
  if (rule.length < 2) return `its rule names only the deploy server recipient ${server}; add the owner key: starci app secret recipients --env ${env} --add owner --execute, then starci app secret server-key --env ${env} --execute`;
  return null;
}

/** `starci app secret audit [--env <env>]`: each deviation on its own line and exit 1, else one clean line and exit 0. */
export function printAudit(repoRoot: string, environment: string | null | undefined, stdout: (text: string) => unknown): number {
  const findings = auditSecrets(repoRoot, environment);
  for (const finding of findings) stdout(`${finding.code} ${finding.env}/${finding.member}: ${finding.detail}\n`);
  if (findings.length) return 1;
  stdout(`app secrets follow the standard${environment ? ` in ${environment}` : ""}\n`);
  return 0;
}

/** Seals `map` as member `<slug>.enc.yaml` to the recipients its environment's rule names; `map` holds every key it keeps. */
function sealFresh(directory: string, slug: string, map: Record<string, string>, sops: SecretSops): string {
  const file = path.join(directory, `${slug}${MEMBER_SUFFIX}`);
  writeSecret({ file, values: map, age: [], sops });
  return file;
}

function plannedMember(directory: string, member: string): { file: string; envelope: SecretEnvelope } {
  const file = fileOf(directory, member);
  if (!fs.existsSync(file)) throw new SecretError(`${member} is not a sealed member of this environment`);
  return { file, envelope: envelopeOf(fs.readFileSync(file, "utf8")) };
}

/**
 * Each target of a move: its keys, whether it is the source member itself (`own`, re-sealed in place) and whether it is another
 * member that already exists (`existing`, merged into only with --into-existing, never a legacy one). Refuses before any read.
 */
function plannedTargets({
  directory,
  environment,
  file,
  groups,
  intoExisting,
  verb,
}: {
  directory: string;
  environment: string;
  file: string;
  groups: Map<string, string[]>;
  intoExisting?: boolean | undefined;
  verb: string;
}): PlannedTarget[] {
  return [...groups].map(([target, keys]) => {
    const resolved = fileOf(directory, target);
    const own = resolved === file && !isLegacyName(path.basename(file));
    const existing = resolved !== file && fs.existsSync(resolved);
    const label = `${environment}/${path.basename(resolved)}`;
    if (existing && isLegacyName(path.basename(resolved))) throw new SecretError(`${label} is a legacy member; migrate it first, then merge into it`);
    if (existing && !intoExisting) throw new SecretError(`${label} already exists; ${verb} merges into it only with --into-existing`);
    const held = existing ? envelopeOf(fs.readFileSync(resolved, "utf8")).keys : [];
    const overlap = keys.filter((key) => held.includes(key));
    return { target, keys, own, existing, overlap, file: existing ? resolved : path.join(directory, `${target}${MEMBER_SUFFIX}`) };
  });
}

const planText = (environment: string, targets: PlannedTarget[]): string => targets.map(({ target, keys, existing, overlap }) => {
  const merge = overlap.length ? `; it already holds ${keyList(overlap)}, which must be identical` : "";
  return `${environment}/${target}${MEMBER_SUFFIX} (${keyList(keys)})${existing ? ` merged into the existing member${merge}` : ""}`;
}).join(", ");

/**
 * Moves the keys of the source member `file` into `targets`, decrypting in memory only. Every existing target is opened and
 * checked first: a key it already holds with another value refuses the whole move, naming the keys and never a value. Then
 * each target is written once, and only after every target is written is the source removed (or, for an own target, the
 * re-sealed copy staged beside it is moved over it), so no key is ever held by no member.
 */
function moveKeys({
  directory,
  environment,
  file,
  envelope,
  targets,
  member,
  sops,
}: {
  directory: string;
  environment: string;
  file: string;
  envelope: SecretEnvelope;
  targets: PlannedTarget[];
  member: string;
  sops: () => SecretSops;
}): void {
  const seam = sops();
  const map = seam.decrypt(file, envelope.format);
  validateMap(map);
  if (!sameSet(Object.keys(map), envelope.keys)) throw new SecretError("sops returned keys that differ from the envelope");
  const writes = targets.map((target): { target: PlannedTarget; values: Record<string, string>; colliding: string[] } => {
    const values: Record<string, string> = Object.fromEntries(target.keys.map((key): [string, string] => [key, map[key] as string]));
    if (!target.existing) return { target, values, colliding: [] };
    const held = seam.decrypt(target.file, envelopeOf(fs.readFileSync(target.file, "utf8")).format);
    validateMap(held);
    const colliding = target.keys.filter((key) => Object.hasOwn(held, key) && held[key] !== values[key]);
    return { target, values: { ...held, ...values }, colliding };
  });
  const collisions = writes.filter((write) => write.colliding.length);
  if (collisions.length)
    throw new SecretError(`refused, nothing was written: ${collisions.map(({ target, colliding }) => `${environment}/${path.basename(target.file)} already holds ${keyList(colliding)} with another value`).join("; ")}; rename or unset one side first`);
  const staging = `${member}-staged`;
  if (targets.some((target) => target.own) && fs.existsSync(fileOf(directory, staging)))
    throw new SecretError(`${environment}/${staging}${MEMBER_SUFFIX} exists; remove it before moving ${member}`);
  let staged: string | null = null;
  for (const { target, values } of writes) {
    if (target.own) staged = sealFresh(directory, staging, values, seam);
    else writeSecret({ file: target.file, values, age: [], sops: seam });
  }
  if (staged) fs.renameSync(staged, file);
  else deleteSealed(file);
}

/** The `--group-file` YAML map (`KEY: member`) and the `--group KEY=member` entries as one map; a key named twice is refused. */
export function groupMap(entries: string[] = [], groupFile: string | null = null): Map<string, string> {
  const pairs: [string, string][] = [];
  if (groupFile) {
    if (!fs.existsSync(groupFile)) throw new SecretError(`--group-file ${groupFile} does not exist`);
    let document: unknown; // reason: parsed YAML boundary, read from disk
    try { document = parseYaml(fs.readFileSync(groupFile, "utf8")); } catch { document = undefined; }
    if (!document || typeof document !== "object" || Array.isArray(document) || Object.values(document).some((value) => typeof value !== "string"))
      throw new SecretError(`--group-file ${groupFile} must be a YAML map of KEY: member`);
    pairs.push(...Object.entries(document));
  }
  for (const entry of entries) {
    const at = entry.indexOf("=");
    if (at < 1 || !entry.slice(at + 1)) throw new SecretError("--group takes KEY=member");
    pairs.push([entry.slice(0, at), entry.slice(at + 1)]);
  }
  const groups = new Map<string, string>();
  for (const [key, member] of pairs) {
    if (groups.has(key)) throw new SecretError(`--group names ${key} twice`);
    groups.set(key, member);
  }
  return groups;
}

/**
 * `migrate --env <env> <member> [--to <slug>] [--into-existing] [--execute]`: moves a member (a legacy dotenv `.enc`, one sealed to
 * other recipients than its rule, or one whose keys belong to another member) to `<slug>.enc.yaml` sealed to the environment's
 * recipients, merging into an existing `<slug>` only with --into-existing, then removes the old file. A dry run until --execute.
 */
export function migrateMember({ directory, environment, member, to, intoExisting, execute, sops, stdout }: MoveOptions): number {
  const { file, envelope } = plannedMember(directory, member);
  const targets = plannedTargets({ directory, environment, file, groups: new Map([[to ?? member, envelope.keys]]), intoExisting, verb: "migrate" });
  const plan = `${environment}/${path.basename(file)} to ${planText(environment, targets)}`;
  if (!execute) {
    stdout(`dry run: would move ${plan}; add --execute\n`);
    return 0;
  }
  moveKeys({ directory, environment, file, envelope, targets, member, sops });
  stdout(`moved ${plan}\n`);
  return 0;
}

/**
 * `split --env <env> <member> [--group KEY=member ...] [--group-file <yaml>] [--into-existing] [--execute]`: divides a member into one
 * `<member>.enc.yaml` per group, each sealed to the environment's recipients, then removes the old file. A key's group is its
 * --group member, else its provider (providerOf); an existing member is merged into only with --into-existing. A dry run until
 * --execute.
 */
export function splitMember({ directory, environment, member, groups: chosen = new Map<string, string>(), intoExisting, execute, sops, stdout }: MoveOptions & { groups?: Map<string, string> | undefined }): number {
  const { file, envelope } = plannedMember(directory, member);
  const stray = [...chosen.keys()].filter((key) => !envelope.keys.includes(key));
  if (stray.length) throw new SecretError(`--group names ${keyList(stray)}, which ${environment}/${member} does not hold`);
  const groups = new Map<string, string[]>();
  for (const key of envelope.keys) {
    const group = chosen.get(key) ?? providerOf(key);
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }
  if (groups.size < 2 && groups.has(member))
    throw new SecretError(`${environment}/${member} holds one group's keys; nothing to split (migrate renames a member)`);
  const targets = plannedTargets({ directory, environment, file, groups, intoExisting, verb: "split" });
  const plan = planText(environment, targets);
  if (!execute) {
    stdout(`dry run: would split ${environment}/${path.basename(file)} into ${plan}; add --execute\n`);
    return 0;
  }
  moveKeys({ directory, environment, file, envelope, targets, member, sops });
  stdout(`split ${environment}/${path.basename(file)} into ${plan}\n`);
  return 0;
}

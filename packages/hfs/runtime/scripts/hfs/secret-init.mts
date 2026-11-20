// secret-init.mts — initialize the public app rule and an age identity outside Git.
import fs from "node:fs";
import path from "node:path";
import { parseYaml, stringifyYaml } from "../../engine/yaml.mjs";
import { secretEnv } from "../../engine/secrets.mjs";
import { resolveSops } from "../api/sops/resolve-sops.mjs";
import { selectedAgeRecipient } from "../api/sops/selected-age-recipient.mjs";
import type { Capture, SopsInvocation } from "../api/sops/lib.mjs";
import { resolveRealTool } from "../api/process/resolve-real-tool.mjs";
import { runProgram } from "../api/process/run-program.mjs";
import { claimFile } from "../api/fs/claim-file.mjs";
import { expectedRecipients, firstRuleFor, memberProbe, recipientPolicy, serverRecipientOf, type CreationRule, type RecipientPolicy } from "../lib/sops-recipients.mjs";
import { declaredSealedMembers, materializeDeclaredPlaceholders } from "./sealed-members.mjs";
import { defaultSops } from "./secret-sops.mjs";
import {
  mainCheckout,
  outsideRepository,
  privateDirectory,
  secretRoots,
} from "./secret-files.mjs";

const PATH_RULE = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;
/** The rule an earlier init wrote, which matches legacy `.enc` members only; init and recipients treat it as the app's own. */
const LEGACY_PATH_RULE = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;
/** The path_regex of one environment's rule: its members, current or legacy. */
export const environmentRule = (environment: string): string =>
  String.raw`\.starcistacks[/\\]` + environment + String.raw`[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;
const AGE_IDENTITY_NAME = /^SOPS_AGE_KEY(?:_FILE)?$/i;
const INITIALIZATION_PATH_RULES: readonly (string | undefined)[] = [PATH_RULE, LEGACY_PATH_RULE];
const MANAGED_HEADER = "# Managed by starci app secret init and recipients: one rule per environment, public age recipients only.\n";

/** One creation rule of an app's .sops.yaml. */
export interface SopsRule {
  path_regex?: string;
  age?: string;
  [name: string]: unknown;
}

/** An app's .sops.yaml: its creation rules and anything else it keeps. */
export interface SopsConfig {
  creation_rules?: SopsRule[];
  [name: string]: unknown;
}

/** A subprocess result as the sops api seams hand it back; the stdout and the error carry no value of a secret. */
export type ProgramResult = Capture;

/** Runs one program without a shell. */
export type RunProgram = SopsInvocation["runProgram"];

/** Seams a caller (a test, the harness CLI) may replace: the tool resolvers and the private secret.env loader. */
export interface SecretToolOverrides {
  secretEnv?: ((directory: string, env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv | undefined) | undefined;
  resolveSops?: ((env: NodeJS.ProcessEnv) => string | null | undefined) | undefined;
  resolveRealTool?: SopsInvocation["resolveRealTool"] | undefined;
  runProgram?: RunProgram | undefined;
}

/** The resolved tools of a secret operation. */
export interface SecretTools {
  sops: string;
  keygen: string;
  run: RunProgram;
}

/** The harness CLI's own source of the age key: where it came from (`label`) and a read that is called only when needed. */
export interface AgeHost {
  label: string;
  read: () => unknown;
}

/** The age identity selection of an app: the environment a sops call runs with, where it came from, every place looked. */
export interface AgeIdentitySelection {
  env: NodeJS.ProcessEnv;
  source: string | null;
  looked: string[];
}

/** What the recipient policy made of an app's rules: the environments given a rule, the ones whose rule was kept, the ones left without one and why. */
export interface PolicyRules {
  rules: SopsRule[];
  written: string[];
  kept: string[];
  skipped: string[];
}

/**
 * The creation rules of the recipient policy (owner, 2026-11-21, model B; lib/sops-recipients.mts): one rule per environment the stack declares,
 * written before any app-wide rule. A dev environment gets the harness recipient alone; a deployed one its server key plus the server's backup,
 * public halves only (this machine never needs or looks for a private server key). An environment a rule already reaches keeps that rule: init
 * never rotates a recipient. One whose set cannot be resolved yet gets no rule, and the reason is returned.
 */
export function policyCreationRules(repoRoot: string, rules: readonly SopsRule[], policy: RecipientPolicy = recipientPolicy()): PolicyRules {
  let stackDoc: unknown = null;
  try { stackDoc = parseYaml(fs.readFileSync(path.join(repoRoot, ".starcistacks", "application-stacks.yaml"), "utf8")); } catch { stackDoc = null; }
  const declared = stackDoc && typeof stackDoc === "object" && (stackDoc as { environments?: unknown }).environments;
  const environments = declared && typeof declared === "object" && !Array.isArray(declared) ? Object.keys(declared).sort() : [];
  const next: SopsRule[] = [...rules];
  const result: PolicyRules = { rules: next, written: [], kept: [], skipped: [] };
  for (const environment of environments) {
    if (firstRuleFor(next as CreationRule[], memberProbe(environment)) >= 0) { result.kept.push(environment); continue; }
    const expected = expectedRecipients(policy, environment, serverRecipientOf(stackDoc, environment));
    if (expected.unresolved.length) { result.skipped.push(`${environment}: ${expected.unresolved.join("; ")}`); continue; }
    const appWide = next.findIndex((rule) => !rule?.path_regex || INITIALIZATION_PATH_RULES.includes(rule.path_regex));
    next.splice(appWide < 0 ? next.length : appWide, 0, { path_regex: environmentRule(environment), age: expected.recipients.join(",") });
    result.written.push(environment);
  }
  return result;
}

/**
 * The scaffold's secret bootstrap: the policy's rules for a new app, and nothing private. No age identity is minted and nothing is written to the
 * app's `.claude/secret.env`: dev members open with the harness SOPS_AGE_KEY every app shares. Returns the rules and the files written.
 */
export function initializeAppRules(
  repoRoot: string,
  { write }: { write?: ((file: string, content: string | Buffer) => void) | undefined } = {},
): PolicyRules & { files: string[] } {
  const config = readInitializationConfig(path.join(repoRoot, ".sops.yaml"));
  if ((config.creation_rules ?? []).some((rule) => rule?.age))
    throw new Error("the app already has an age recipient; initialization must not rotate it");
  const made = policyCreationRules(repoRoot, config.creation_rules ?? []);
  config.creation_rules = made.rules;
  const text = `${MANAGED_HEADER}${stringifyYaml(config)}`;
  (write ?? ((file: string, content: string | Buffer) => fs.writeFileSync(file, content)))(path.join(repoRoot, ".sops.yaml"), text);
  return { ...made, files: [".sops.yaml"] };
}

/**
 * The app's host-local age selection: SOPS_AGE_KEY or SOPS_AGE_KEY_FILE of the explicit environment, else of the git-ignored
 * `.claude/secret.env` of the app root, else of its main checkout's when the root is a git worktree, else the SOPS_AGE_KEY the
 * `host` port reads (the harness CLI's secret.env: `{ label, read }`, read only when nothing before it selects one). `env` is the explicit
 * environment with that selection added below it (no other credential is copied); `source` names where it came from, or is
 * null; `looked` lists every secret.env read, for a refusal that names them. No value ever leaves in `source` or `looked`.
 */
export function localAgeIdentity(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  tools?: SecretToolOverrides,
  host: AgeHost | null = null,
): AgeIdentitySelection {
  const own = Object.keys(env).filter((name) => AGE_IDENTITY_NAME.test(name));
  if (own.length) return { env: { ...env }, source: `the environment (${own.join(", ")})`, looked: [] };
  const load = tools?.secretEnv ?? secretEnv;
  const roots = [...new Set([repoRoot, mainCheckout(repoRoot)].map((root) => path.resolve(root)))];
  const looked: string[] = [];
  for (const root of roots) {
    const file = path.join(root, ".claude", "secret.env");
    looked.push(file);
    let resolved: NodeJS.ProcessEnv;
    try {
      resolved = load(path.join(root, ".claude"), env) ?? {};
    } catch {
      continue;
    }
    const local = Object.fromEntries(
      Object.entries(resolved).filter(([name]) => AGE_IDENTITY_NAME.test(name)),
    );
    if (Object.keys(local).length)
      return { env: { ...env, ...local }, source: `${file} (${Object.keys(local).join(", ")})`, looked };
  }
  if (host) {
    looked.push(host.label);
    const value = host.read();
    if (typeof value === "string" && value.trim())
      return { env: { ...env, SOPS_AGE_KEY: value.trim() }, source: `${host.label} (SOPS_AGE_KEY)`, looked };
  }
  return { env: { ...env }, source: null, looked };
}

/**
 * The one age identity every decrypt of a sealed member opens with (secret get, verify, materialize, set over an existing member,
 * migrate, split, the edit verbs, updatekeys, server-key, the stack's sealed members and the CLI's custody): localAgeIdentity's
 * order (the environment, the app's `.claude/secret.env`, its main checkout's, the `host` port), then sops' per-user keys.txt.
 * Same shape as localAgeIdentity; `looked` names every place read, keys.txt last.
 */
export function decryptionIdentity(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  {
    tools,
    host = null,
    platform = process.platform,
  }: {
    tools?: SecretToolOverrides | undefined;
    host?: AgeHost | null | undefined;
    platform?: NodeJS.Platform | undefined;
  } = {},
): AgeIdentitySelection {
  const local = localAgeIdentity(repoRoot, env, tools, host);
  if (local.source !== null) return local;
  const keys = secretRoots(env, platform).identity;
  const looked = [...local.looked, keys];
  if (!fs.existsSync(keys)) return { ...local, looked };
  return { env: { ...local.env, SOPS_AGE_KEY_FILE: keys }, source: keys, looked };
}

/** Load host-local age selections below the explicit environment (localAgeIdentity), without copying any other credentials. */
export function ageIdentityEnv(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  tools?: SecretToolOverrides,
): NodeJS.ProcessEnv {
  return localAgeIdentity(repoRoot, env, tools).env;
}

/** Select the first matching public age rule, including for SOPS's isolated CI identity path. */
export function configuredRecipients(repoRoot: string, file: string): string[] {
  let config: SopsConfig | null | undefined; // reason: parsed YAML boundary, read from disk
  try {
    config = parseYaml(
      fs.readFileSync(path.join(repoRoot, ".sops.yaml"), "utf8"),
    );
  } catch {
    throw new Error(
      "a valid .sops.yaml is required; run starci app secret init",
    );
  }
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  if (!Array.isArray(config?.creation_rules))
    throw new Error(
      ".sops.yaml requires creation_rules; run starci app secret init",
    );
  // A `.enc.yaml` member also matches a rule written for the legacy `.enc` spelling, so an app's existing .sops.yaml keeps
  // sealing until `starci app secret recipients` rewrites it.
  const spellings = [relative, ...(relative.endsWith(".enc.yaml") ? [relative.slice(0, -".yaml".length)] : [])];
  const rule = config.creation_rules.find((entry) => {
    try {
      return (
        !entry.path_regex ||
        spellings.some((spelling) =>
          new RegExp(entry.path_regex as string).test(spelling) ||
          new RegExp(entry.path_regex as string).test(spelling.replaceAll("/", "\\")))
      );
    } catch {
      throw new Error(".sops.yaml has an invalid path_regex");
    }
  });
  const recipients =
    typeof rule?.age === "string"
      ? rule.age.split(",").map((value) => value.trim())
      : [];
  if (
    !recipients.length ||
    recipients.some((value) => !/^age1[a-z0-9]+$/.test(value))
  )
    throw new Error(
      ".sops.yaml must supply public age recipients for this secret; run starci app secret init",
    );
  return recipients;
}

/**
 * Whether sops itself finds a creation rule for `file`: the first rule whose path_regex matches the path as written (sops reads the file's own
 * name, so a `.enc.yaml` member is not matched by a rule written for the legacy `.enc` spelling, which configuredRecipients tolerates when it
 * only reads recipients). A rule with no path_regex matches everything.
 */
export function sopsFindsRule(repoRoot: string, file: string): boolean {
  let config: SopsConfig | null | undefined; // reason: parsed YAML boundary, read from disk
  try { config = parseYaml(fs.readFileSync(path.join(repoRoot, ".sops.yaml"), "utf8")); } catch { return false; }
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  return (config?.creation_rules ?? []).some((entry) => {
    try {
      return !entry.path_regex || new RegExp(entry.path_regex).test(relative) || new RegExp(entry.path_regex).test(relative.replaceAll("/", "\\"));
    } catch { return false; }
  });
}

/** Resolve required tools without exposing subprocess output (which can contain private data). */
export function secretTools(
  env: NodeJS.ProcessEnv,
  tools: SecretToolOverrides = {},
): SecretTools {
  const sops = (tools.resolveSops ?? resolveSops)(env);
  if (!sops)
    throw new Error(
      "sops is not installed; install SOPS and put sops on PATH (Windows: winget install Mozilla.SOPS)",
    );
  const resolve = tools.resolveRealTool ?? resolveRealTool;
  const age = resolve("age", { env });
  const keygen = resolve("age-keygen", { env });
  if (!age || !keygen)
    throw new Error(
      "age or age-keygen is not installed; install age and put age and age-keygen on PATH",
    );
  return { sops, keygen, run: tools.runProgram ?? runProgram };
}

function readInitializationConfig(configFile: string): SopsConfig {
  let config: SopsConfig = {}; // reason: parsed YAML boundary, read from disk
  try {
    if (fs.existsSync(configFile))
      config = parseYaml(fs.readFileSync(configFile, "utf8")) ?? {};
  } catch {
    throw new Error(
      ".sops.yaml is invalid; repair it before initializing secrets",
    );
  }
  if (
    typeof config !== "object" ||
    Array.isArray(config) ||
    (config.creation_rules !== undefined &&
      !Array.isArray(config.creation_rules))
  )
    throw new Error(".sops.yaml must hold a creation_rules list");
  return config;
}

function legacyInitializationRecipient(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform | undefined,
  tool: SecretTools,
): string {
  const identity = secretRoots(env, platform).identity;
  outsideRepository(repoRoot, identity);
  privateDirectory(repoRoot, path.dirname(identity));
  const held = claimFile(identity);
  if (!held.ok)
    throw new Error(
      "the age identity is being initialized; retry after that operation settles",
    );
  try {
    if (!fs.existsSync(identity)) {
      const generated = tool.run(tool.keygen, ["-o", identity], {
        env,
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (generated.error || generated.status !== 0)
        throw new Error(
          "age-keygen could not create the private identity outside the repository",
        );
    }
    const stat = fs.lstatSync(identity);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("the age identity must be an ordinary private file");
    if (process.platform !== "win32") fs.chmodSync(identity, 0o600);
    const publicKey = tool.run(tool.keygen, ["-y", identity], {
      env,
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (publicKey.error || publicKey.status !== 0)
      throw new Error(
        "age-keygen could not read the public recipient from the existing identity",
      );
    const recipients = String(publicKey.stdout ?? "")
      .trim()
      .split(/\s+/);
    if (
      !recipients.length ||
      recipients.some((value) => !/^age1[a-z0-9]+$/.test(value))
    )
      throw new Error("age-keygen returned an invalid public recipient");
    return recipients.join(",");
  } finally {
    held.release();
  }
}

function initializationRecipient(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform | undefined,
  tool: SecretTools,
  tools?: SecretToolOverrides,
): string {
  const selectedEnv = ageIdentityEnv(repoRoot, env, tools);
  if (!Object.keys(selectedEnv).some((name) => /^SOPS_AGE_KEY$/i.test(name)))
    return legacyInitializationRecipient(repoRoot, env, platform, tool);
  const result = selectedAgeRecipient({
    env: selectedEnv,
    cwd: repoRoot,
    invocation: {
      runProgram: tool.run,
      resolveRealTool: tools?.resolveRealTool ?? resolveRealTool,
    },
  });
  if (!result.ok)
    throw new Error(`SOPS_AGE_KEY public recipient could not be derived (${result.reason})`);
  return result.publicRecipient;
}

/**
 * The public recipient of the owner's age identity, as localAgeIdentity finds it (`host` its last source). Only an inline
 * SOPS_AGE_KEY is derived; with none the caller names the recipient itself.
 */
export function ownerRecipient(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  {
    platform,
    tools,
    host = null,
  }: {
    platform?: NodeJS.Platform | undefined;
    tools?: SecretToolOverrides | undefined;
    host?: AgeHost | null | undefined;
  },
): string {
  const local = localAgeIdentity(repoRoot, env, tools, host);
  if (!Object.keys(local.env).some((name) => /^SOPS_AGE_KEY$/i.test(name)))
    throw new Error(
      `no SOPS_AGE_KEY found (looked in the environment${local.looked.length ? `, ${local.looked.join(", ")}` : ""}); name the owner's public recipient (age1...) instead of owner`,
    );
  return initializationRecipient(repoRoot, local.env, platform, secretTools(env, tools), tools);
}

/**
 * `starci app secret recipients --env <env> [--add <age1...|owner>] [--remove <age1...|owner>] [--execute]`: prints the public
 * recipients a member of the environment is sealed to, or (with --add/--remove) says what the environment's own rule of the
 * app's managed .sops.yaml would become and, only with --execute, rewrites it (one rule per environment, written before the
 * app-wide rule, public keys only). `owner` is the owner identity's recipient (ownerRecipient). A member sealed before keeps
 * its recipients until it is sealed again. `execute` defaults to true for the library callers (stack/server-key.mts); the verb
 * passes the flag, so a dry run is the default there.
 */
export function environmentRecipients(
  repoRoot: string,
  environment: string,
  {
    add = [],
    remove = [],
    execute = true,
    owner,
    stdout,
  }: {
    add?: string[] | undefined;
    remove?: string[] | undefined;
    execute?: boolean | undefined;
    owner: () => string;
    stdout: (text: string) => void;
  },
): number {
  const configFile = path.join(repoRoot, ".sops.yaml");
  const config = readInitializationConfig(configFile);
  const rules = Array.isArray(config.creation_rules) ? config.creation_rules : [];
  const probe = path.join(repoRoot, ".starcistacks", environment, "secrets", "member.enc.yaml");
  let current: string[] = [];
  try { current = configuredRecipients(repoRoot, probe); } catch { current = []; }
  if (!add.length && !remove.length) {
    stdout(`${environment}: ${current.join(", ") || "no rule names a recipient; run starci app secret init"}\n`);
    return 0;
  }
  let ownerValue: string | undefined;
  const resolve = (value: string): string => {
    if (value !== "owner") return value;
    ownerValue ??= owner();
    return ownerValue;
  };
  const next = [...current];
  for (const value of add.map(resolve)) {
    if (!/^age1[a-z0-9]+$/u.test(value)) throw new Error(`${value} is not a public age recipient (age1...)`);
    if (!next.includes(value)) next.push(value);
  }
  for (const value of remove.map(resolve)) {
    const at = next.indexOf(value);
    if (at < 0) throw new Error(`${environment} is not sealed to ${value}`);
    next.splice(at, 1);
  }
  if (!next.length) throw new Error(`${environment} keeps at least one recipient`);
  const regex = environmentRule(environment);
  const own = rules.findIndex((rule) => rule?.path_regex === regex);
  if (own >= 0) rules[own] = { ...rules[own], age: next.join(",") };
  else {
    const appWide = rules.findIndex((rule) => !rule?.path_regex || INITIALIZATION_PATH_RULES.includes(rule.path_regex));
    rules.splice(appWide < 0 ? rules.length : appWide, 0, { path_regex: regex, age: next.join(",") });
  }
  if (!execute) {
    stdout(`dry run: would set the ${environment} recipients of .sops.yaml to ${next.join(", ")} (now ${current.join(", ") || "none"}); add --execute\n`);
    return 0;
  }
  config.creation_rules = rules;
  fs.writeFileSync(
    configFile,
    `# Managed by starci app secret init and recipients: one rule per environment, public age recipients only.\n${stringifyYaml(config)}`,
  );
  stdout(
    `${environment}: ${next.join(", ")}; a member sealed before keeps its recipients until it is sealed again (starci app secret migrate --env ${environment} <member> --execute)\n`,
  );
  return 0;
}

/**
 * `starci app secret init`: writes the recipient policy's rules into the app's .sops.yaml (policyCreationRules: one rule per declared environment, dev
 * to the harness recipient, a deployed environment to its server key plus the server's backup, public halves only) and seals the placeholders of
 * declared members that no member file holds yet. It mints no age identity and writes nothing into the app's `.claude/secret.env`: every app shares
 * the harness SOPS_AGE_KEY for dev, and a deployed environment is opened only by its server (or the break-glass backup). An existing rule is never
 * rotated; `starci app check` (R451) reports one that breaks the policy.
 */
export function initializeSecrets(
  repoRoot: string,
  {
    env,
    platform,
    tools,
    stdout,
    host = null,
  }: {
    env: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform | undefined;
    tools?: SecretToolOverrides | undefined;
    stdout: (text: string) => void;
    host?: AgeHost | null | undefined;
  },
): number {
  const configFile = path.join(repoRoot, ".sops.yaml");
  const config = readInitializationConfig(configFile);
  const rules = config.creation_rules ?? [];
  if (
    rules.some((rule) => typeof rule?.age === "string" && rule.age.split(",").some((value) => !/^age1[a-z0-9]+$/.test(value.trim())))
  )
    throw new Error(
      ".sops.yaml must name valid public age recipients; initialization never prints private key material",
    );
  const made = policyCreationRules(repoRoot, rules);
  if (made.written.length) {
    config.creation_rules = made.rules;
    fs.writeFileSync(configFile, `${MANAGED_HEADER}${stringifyYaml(config)}`);
  }
  for (const environment of made.written) stdout(`${environment}: rule written for ${configuredRecipients(repoRoot, path.join(repoRoot, memberProbe(environment))).join(", ")}\n`);
  for (const environment of made.kept) stdout(`${environment}: existing rule kept (init never rotates a recipient; starci app check R451 judges it)\n`);
  for (const line of made.skipped) stdout(`no rule written for ${line}\n`);
  const ruled = (file: string): boolean => sopsFindsRule(repoRoot, file);
  const pending = declaredSealedMembers(repoRoot).filter((member) => ruled(path.join(repoRoot, memberProbe(member.env))));
  if (pending.length) {
    // Sealing needs public recipients only: no identity is selected or read for it.
    materializeDeclaredPlaceholders(repoRoot, {
      recipientsForFile: (file) => configuredRecipients(repoRoot, file),
      processEnv: env,
      sops: { seal: (request) => defaultSops(env, repoRoot, platform, tools, host).seal(request) },
      only: (member) => ruled(path.join(repoRoot, memberProbe(member.env))),
    });
  }
  stdout("secrets initialized; no private identity was created or written (dev opens with the harness SOPS_AGE_KEY)\n");
  return 0;
}

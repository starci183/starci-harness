// secret.mjs - app secret init|set|get|unset|rename|remove|materialize|list|verify: sealed custody and private KEY files.
// SOPS plaintext travels on stdin and stays in memory; normal CLI output contains names and local file paths only.
// set seals one or more keys in one sops write: typed at a masked prompt on a terminal, KEY=value lines on redirected stdin
// (the whole stdin for one key), or --generate (scripts/hfs/secret-prompt.mjs).
// Every verb runs at the app root or --cwd. Exit 0 done, 2 refusal; --reveal is the only plaintext stdout path.
// unset, rename and remove edit one sealed member and are dry runs until --execute (scripts/hfs/secret-edit.mjs).
// verify decrypts each member in memory and names only keys and violated shapes, never a value (R249).
// server-key makes the deploy server's own age identity on the server and seals the environment to it (stack/server-key.mjs).
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { invocationDir } from "../lib/roots.mjs";
import {
  type AgeHost,
  type SecretToolOverrides,
  environmentRecipients,
  initializeSecrets,
  ownerRecipient,
} from "./secret-init.mjs";
import { declareKeys, groupMap, migrateMember, printAudit, splitMember } from "./secret-standard.mjs";
import { envelopeOf, validateKey } from "./secret-document.mjs";
import { type SecretSops, defaultSops } from "./secret-sops.mjs";
import { fileOf, secretsDirectory, writeSecret } from "./secret-store.mjs";
import { getSecret, listSecrets, materializeSecrets } from "./secret-output.mjs";
import { SecretError, publicStorage, secretErrorMessage } from "./secret-errors.mjs";
import { editSecret, validateEditNames } from "./secret-edit.mjs";
import { verifySecrets } from "./rules/env-value-shape.mjs";
import { type Prompt, type StdinPort, setValues } from "./secret-prompt.mjs";
import { stackContext } from "../../../stack/context.mjs";
import { StackError } from "../../../stack/errors.mjs";
import { serverKey } from "../../../stack/server-key.mjs";

export { envelopeOf, formatOf, plaintextOf } from "./secret-document.mjs";
export { setSecretValues } from "./secret-store.mjs";

/** The actions of `starci app secret`, in usage order. */
export const SECRET_VERBS = Object.freeze(["init", "set", "get", "unset", "rename", "remove", "materialize", "list", "verify", "recipients", "migrate", "split", "audit", "server-key"]);
const VERBS = new Set(SECRET_VERBS);
const MOVE_VERBS = new Set(["migrate", "split"]);
/** The flags the parser reads: repeatable lists, single values and booleans (optionsFor refuses each outside the actions that take it). */
export const SECRET_FLAGS = Object.freeze({
  list: ["--add", "--remove", "--from-file", "--group"],
  value: ["--cwd", "--generate", "--to", "--group-file", "--backup", "--restore"],
  boolean: ["--to-file", "--reveal", "--execute", "--force-nonempty", "--into-existing", "--rotate"],
});
const LIST_FLAGS = SECRET_FLAGS.list;
const EDIT_VERBS = new Set(["unset", "rename", "remove"]);

/** The parsed operands and flags of one secret action; a flag is stored under its name without the leading dashes. */
interface SecretOptions {
  positional: string[];
  add?: string[];
  remove?: string[];
  "from-file"?: string[];
  group?: string[];
  cwd?: string;
  generate?: string;
  to?: string;
  "group-file"?: string;
  backup?: string;
  restore?: string;
  "to-file"?: boolean;
  reveal?: boolean;
  execute?: boolean;
  "force-nonempty"?: boolean;
  "into-existing"?: boolean;
  rotate?: boolean;
}

/** The transport the `server-key` verb runs through: stack context seams (`io`) and the verb's own dependencies (`deps`). */
export interface ServerKeyIo {
  io?: Record<string, unknown>;
  deps?: Record<string, unknown>;
}

/** The ports of `secretMain`; each defaults to the process, and a spec replaces them for isolated custody. */
export interface SecretMainPorts {
  stdout?: ((text: string) => unknown) | undefined;
  stderr?: ((text: string) => unknown) | undefined;
  stdin?: StdinPort | undefined;
  prompt?: Prompt | undefined;
  hostIdentity?: AgeHost | null | undefined;
  sops?: SecretSops | null | undefined;
  random?: ((bytes: number) => Buffer) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  tools?: SecretToolOverrides | undefined;
  serverKeyIo?: ServerKeyIo | undefined;
}

function valueOption(opts: SecretOptions, flag: string, value: string | undefined): void {
  const store = opts as unknown as Record<string, unknown>;
  if (value === undefined || value.startsWith("--"))
    throw new SecretError(`${flag} needs a value`);
  if (Object.hasOwn(opts, flag.slice(2)))
    throw new SecretError(`${flag} may be given only once`);
  store[flag.slice(2)] = value;
}

function parse(argv: string[]): SecretOptions {
  const opts: SecretOptions = { positional: [] };
  const store = opts as unknown as Record<string, unknown>;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.split(/=(.*)/su) as [string, string | undefined];
    if (LIST_FLAGS.includes(flag)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--")) throw new SecretError(`${flag} needs a value`);
      ((store[flag.slice(2)] ??= []) as string[]).push(value);
    } else if (SECRET_FLAGS.value.includes(flag)) {
      valueOption(opts, flag, inline ?? argv[++i]);
    } else if (SECRET_FLAGS.boolean.includes(flag)) {
      if (inline !== undefined && !["true", "false"].includes(inline))
        throw new SecretError(`${flag} expects true or false`);
      store[flag.slice(2)] = inline !== "false";
    } else if (arg.startsWith("--"))
      throw new SecretError(`unknown flag ${arg}`);
    else opts.positional.push(arg);
  }
  return opts;
}

/** The operands and flags of one secret action, as the usage of `starci app secret` prints them. */
export function secretUsage(verb: string): string {
  if (verb === "init") return "";
  if (verb === "set") return "<env> <slug> <KEY> [KEY ...] [--generate <bytes>] [--from-file KEY=path ...]";
  if (verb === "get") return "<env> <slug> [KEY] --to-file [--reveal]";
  if (verb === "unset") return "<env> <slug> <KEY> [--execute]";
  if (verb === "rename") return "<env> <slug> <OLD> <NEW> [--execute]";
  if (verb === "remove") return "<env> <slug> [--execute] [--force-nonempty]";
  if (verb === "recipients") return "<env> [--add <age1...|owner>] [--remove <age1...|owner>]";
  if (verb === "migrate") return "<env> <slug> [--to <slug>] [--into-existing] [--execute]";
  if (verb === "split") return "<env> <slug> [--group KEY=member ...] [--group-file <yaml>] [--into-existing] [--execute]";
  if (verb === "audit") return "[<env>]";
  if (verb === "server-key") return "<env> [--rotate | --backup github | --restore github] [--execute]";
  return "<env>";
}

function editOptionsFor(verb: string, opts: SecretOptions): void {
  if (opts.execute !== undefined && !EDIT_VERBS.has(verb) && !MOVE_VERBS.has(verb) && verb !== "server-key")
    throw new SecretError("--execute is only valid for unset, rename, remove, migrate, split and server-key");
  if ((opts.rotate !== undefined || opts.backup !== undefined || opts.restore !== undefined) && verb !== "server-key")
    throw new SecretError("--rotate, --backup and --restore are only valid for server-key");
  if (opts.to !== undefined && verb !== "migrate") throw new SecretError("--to is only valid for migrate");
  if ((opts.group || opts["group-file"] !== undefined) && verb !== "split") throw new SecretError("--group and --group-file are only valid for split");
  if (opts["into-existing"] !== undefined && !MOVE_VERBS.has(verb)) throw new SecretError("--into-existing is only valid for migrate and split");
  if ((opts.add || opts.remove) && verb !== "recipients") throw new SecretError("--add and --remove are only valid for recipients");
  if (opts["from-file"] && verb !== "set") throw new SecretError("--from-file is only valid for set");
  if (opts["force-nonempty"] !== undefined && verb !== "remove")
    throw new SecretError("--force-nonempty is only valid for remove");
}

function outputOptionsFor(verb: string, opts: SecretOptions): void {
  if (
    (opts["to-file"] !== undefined || opts.reveal !== undefined) &&
    verb !== "get"
  )
    throw new SecretError("--to-file and --reveal are only valid for get");
  if (verb === "get" && !opts["to-file"] && !opts.reveal)
    throw new SecretError("get requires --to-file or explicit --reveal");
}

function optionsFor(verb: string, opts: SecretOptions): void {
  const count = opts.positional.length;
  const bounds = ({
    init: [0, 0],
    list: [1, 1],
    materialize: [1, 1],
    verify: [1, 1],
    set: [3, Infinity],
    get: [2, 3],
    unset: [3, 3],
    rename: [4, 4],
    remove: [2, 2],
    recipients: [1, 1],
    migrate: [2, 2],
    split: [2, 2],
    audit: [0, 1],
    "server-key": [1, 1],
  } as Record<string, [number, number]>)[verb] as [number, number];
  if (count < bounds[0] || count > bounds[1])
    throw new SecretError(
      `usage: starci app secret ${verb} ${secretUsage(verb)}`,
    );
  if (opts.generate !== undefined && verb !== "set")
    throw new SecretError("--generate is only valid for set");
  outputOptionsFor(verb, opts);
  editOptionsFor(verb, opts);
  if (EDIT_VERBS.has(verb)) validateEditNames(verb, opts.positional.slice(2));
  if (verb === "set") {
    const keys = opts.positional.slice(2);
    for (const key of keys) validateKey(key);
    const twice = keys.find((key, index) => keys.indexOf(key) !== index);
    if (twice) throw new SecretError(`set names ${twice} twice`);
  }
  if (verb === "get" && opts.positional[2] !== undefined)
    validateKey(opts.positional[2]);
}

/** The `--from-file KEY=path` values of set: each a named key, read byte for byte by setValues. */
function fromFiles(entries: string[] | undefined, keys: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const at = entry.indexOf("=");
    const key = entry.slice(0, at);
    if (at < 1 || !entry.slice(at + 1)) throw new SecretError("--from-file takes KEY=path");
    if (!keys.includes(key)) throw new SecretError(`--from-file names ${key}, which this set does not`);
    if (Object.hasOwn(files, key)) throw new SecretError(`--from-file names ${key} twice`);
    files[key] = entry.slice(at + 1);
  }
  return files;
}

/** What `set` declared in the environment's stack `secrets:`, or the keys to declare by hand; nothing when all were declared. */
function declarationLine(environment: string, { declared, byHand }: { declared: string[]; byHand: string[] }): string {
  if (declared.length) return `declared ${declared.join(", ")} in environments.${environment}.secrets of application-stacks.yaml\n`;
  if (byHand.length) return `declare ${byHand.join(", ")} in environments.${environment}.secrets of application-stacks.yaml (this environment's shape is wired by hand)\n`;
  return "";
}

/** The app root of a sealed member: `<root>/.starcistacks/<env>/secrets/<slug>.enc`. */
const appRootOf = (file: string): string => path.resolve(path.dirname(file), "..", "..", "..");

/**
 * The success line of set: the member and its keys and, for a member this set created, the age identity a later set needs to
 * open it (the recipient it is sealed to, and where this machine holds that identity, or the fix when it holds none). Names
 * and paths only.
 */
function sealedLine(environment: string, slug: string, keys: string[], file: string, created: boolean, seam: SecretSops): string {
  const head = `sealed ${environment}/${slug} (${keys.join(", ")})`;
  if (!created) return `${head}\n`;
  let recipients: string[] = [];
  try { recipients = envelopeOf(fs.readFileSync(file, "utf8")).recipients; }
  catch { recipients = []; }
  const of = recipients.length ? ` of ${recipients.join(", ")}` : "";
  let held = "";
  if (seam.identity?.source) held = `; this machine holds it in ${seam.identity.source}`;
  else if (seam.identity)
    held = `; this machine holds none: add SOPS_AGE_KEY to ${path.join(appRootOf(file), ".claude", "secret.env")} before the next set`;
  return `${head}; a new member: adding keys to it later needs the age identity${of}${held}\n`;
}

/** `server-key`: the deploy server's identity through the stack transport (`serverKeyIo`: { io, deps } of the specs), lines out. */
async function serverKeyVerb(
  repoRoot: string,
  environment: string,
  opts: SecretOptions,
  {
    env,
    stdout,
    stderr,
    open,
    serverKeyIo,
  }: {
    env: NodeJS.ProcessEnv;
    stdout: (text: string) => unknown;
    stderr: (text: string) => unknown;
    open: () => SecretSops;
    serverKeyIo: ServerKeyIo;
  },
): Promise<number> {
  const ctx = stackContext({ cwd: repoRoot, env, stdout, stderr, openSops: open, ...serverKeyIo.io });
  try {
    const result = await serverKey(ctx, environment, {
      execute: opts.execute === true, rotate: opts.rotate === true, backup: opts.backup, restore: opts.restore,
    }, serverKeyIo.deps ?? {});
    for (const line of result.lines) stdout(`${line}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof StackError)) throw error;
    // reason: StackError is an unconverted import, so the narrowed error is read through its known public shape.
    const failure = error as { message: string; exit: number };
    stderr(`starci app secret: ${failure.message}\n`);
    return failure.exit;
  }
}

/**
 * All app secrets verbs; stdin, prompt, sops, random and tool ports permit isolated custody specs. `hostIdentity`
 * (`{ label, read }`) is the harness CLI's secret.env SOPS_AGE_KEY, the last place before keys.txt the age identity is looked for.
 */
export async function secretMain(
  argv: string[],
  {
    stdout = (s: string) => process.stdout.write(s),
    stderr = (s: string) => process.stderr.write(s),
    stdin,
    prompt,
    hostIdentity = null,
    sops = null,
    random = randomBytes,
    env = process.env,
    cwd = invocationDir(),
    platform = process.platform,
    tools,
    serverKeyIo = {},
  }: SecretMainPorts = {},
): Promise<number> {
  const [verb, ...rest] = argv as [string, ...string[]];
  try {
    if (!VERBS.has(verb))
      throw new SecretError(
        "usage: starci app secret init | set <env> <slug> <KEY> [KEY ...] | get <env> <slug> [KEY] --to-file | unset <env> <slug> <KEY> | rename <env> <slug> <OLD> <NEW> | remove <env> <slug> | materialize <env> | list <env> | verify <env> | recipients <env> | migrate <env> <slug> [--to <slug>] [--into-existing] | split <env> <slug> [--group KEY=member] [--group-file <yaml>] [--into-existing] | audit [<env>] | server-key <env> [--rotate | --backup github | --restore github] [--execute]",
      );
    const opts = parse(rest);
    optionsFor(verb, opts);
    const repoRoot = path.resolve(cwd, opts.cwd ?? ".");
    if (verb === "init")
      return publicStorage(() =>
        initializeSecrets(repoRoot, { env, platform, tools, stdout, host: hostIdentity }),
      );
    if (verb === "audit") return printAudit(repoRoot, opts.positional[0] ?? null, stdout);
    if (verb === "recipients")
      return publicStorage(() =>
        environmentRecipients(repoRoot, opts.positional[0] as string, {
          add: opts.add ?? [], remove: opts.remove ?? [], stdout,
          owner: () => ownerRecipient(repoRoot, env, { platform, tools, host: hostIdentity }),
        }),
      );
    const [environment, slug, key] = opts.positional as [string, string, string | undefined];
    if (verb === "server-key")
      return await serverKeyVerb(repoRoot, environment, opts, {
        env, stdout, stderr, serverKeyIo,
        open: () => sops ?? defaultSops(env, repoRoot, platform, tools, hostIdentity),
      });
    const directory = secretsDirectory(repoRoot, environment);
    if (verb === "list") return listSecrets(directory, stdout);
    const open = () => sops ?? defaultSops(env, repoRoot, platform, tools, hostIdentity);
    if (EDIT_VERBS.has(verb))
      return editSecret(verb, {
        directory, environment, slug, names: opts.positional.slice(2),
        execute: opts.execute === true, force: opts["force-nonempty"] === true, sops: open, stdout,
      });
    if (MOVE_VERBS.has(verb)) {
      const move = { directory, environment, member: slug, to: opts.to, intoExisting: opts["into-existing"] === true, execute: opts.execute === true, sops: open, stdout };
      if (verb === "migrate") return migrateMember(move);
      return splitMember({ ...move, groups: groupMap(opts.group, opts["group-file"] === undefined ? null : path.resolve(cwd, opts["group-file"])) });
    }
    const seam = open();
    if (verb === "verify")
      return verifySecrets({ repoRoot, directory, environment, sops: seam, stdout, typescript: undefined });
    const output = { repoRoot, environment, env, platform, stdout };
    if (verb === "materialize")
      return materializeSecrets(directory, seam, output);
    const file = fileOf(directory, slug);
    if (verb === "get") return getSecret(file, key, seam, opts, output, stderr);
    const keys = opts.positional.slice(2);
    const created = !fs.existsSync(file);
    // Adding a key decrypts the member, so its identity is checked before any value is asked for; replacing every key does not.
    if (!created && !envelopeOf(fs.readFileSync(file, "utf8")).keys.every((name) => keys.includes(name))) seam.requireIdentity?.(file);
    const values = await setValues(keys, { generate: opts.generate, stdin, prompt, random, fromFile: fromFiles(opts["from-file"], keys) });
    writeSecret({ file, values, age: [], sops: seam });
    stdout(sealedLine(environment, slug, keys, file, created, seam));
    stdout(declarationLine(environment, declareKeys(repoRoot, environment, slug, keys)));
    return 0;
  } catch (error) {
    const message = secretErrorMessage(error);
    stderr(`starci app secret: ${message}\n`);
    return 2;
  }
}

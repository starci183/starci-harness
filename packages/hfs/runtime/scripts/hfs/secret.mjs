// secret.mjs - app secret init|set|get|unset|rename|remove|materialize|list|verify: sealed custody and private KEY files.
// SOPS plaintext travels on stdin and stays in memory; normal CLI output contains names and local file paths only.
// set seals one or more keys in one sops write: typed at a masked prompt on a terminal, KEY=value lines on redirected stdin
// (the whole stdin for one key), or --generate (scripts/hfs/secret-prompt.mjs).
// Every verb runs at the app root or --cwd. Exit 0 done, 2 refusal; --reveal is the only plaintext stdout path.
// unset, rename and remove edit one sealed member and are dry runs until --execute (scripts/hfs/secret-edit.mjs).
// verify decrypts each member in memory and names only keys and violated shapes, never a value (R249).
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { invocationDir } from "../lib/roots.mjs";
import { initializeSecrets } from "./secret-init.mjs";
import { envelopeOf, validateKey } from "./secret-document.mjs";
import { defaultSops } from "./secret-sops.mjs";
import { fileOf, secretsDirectory, writeSecret } from "./secret-store.mjs";
import { getSecret, listSecrets, materializeSecrets } from "./secret-output.mjs";
import { SecretError, publicStorage, secretErrorMessage } from "./secret-errors.mjs";
import { editSecret, validateEditNames } from "./secret-edit.mjs";
import { verifySecrets } from "./rules/env-value-shape.mjs";
import { setValues } from "./secret-prompt.mjs";

export { envelopeOf, formatOf, plaintextOf } from "./secret-document.mjs";
export { setSecretValues } from "./secret-store.mjs";

const VERBS = new Set(["init", "list", "get", "set", "unset", "rename", "remove", "materialize", "verify"]);
const EDIT_VERBS = new Set(["unset", "rename", "remove"]);

function valueOption(opts, flag, value) {
  if (value === undefined || value.startsWith("--"))
    throw new SecretError(`${flag} needs a value`);
  if (Object.hasOwn(opts, flag.slice(2)))
    throw new SecretError(`${flag} may be given only once`);
  opts[flag.slice(2)] = value;
}

function parse(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.split(/=(.*)/su);
    if (["--cwd", "--generate"].includes(flag)) {
      valueOption(opts, flag, inline ?? argv[++i]);
    } else if (["--to-file", "--reveal", "--execute", "--force-nonempty"].includes(flag)) {
      if (inline !== undefined && !["true", "false"].includes(inline))
        throw new SecretError(`${flag} expects true or false`);
      opts[flag.slice(2)] = inline !== "false";
    } else if (arg.startsWith("--"))
      throw new SecretError(`unknown flag ${arg}`);
    else opts.positional.push(arg);
  }
  return opts;
}

function usageArguments(verb) {
  if (verb === "init") return "";
  if (verb === "set") return "<env> <slug> <KEY> [KEY ...] [--generate <bytes>]";
  if (verb === "get") return "<env> <slug> [KEY] --to-file [--reveal]";
  if (verb === "unset") return "<env> <slug> <KEY> [--execute]";
  if (verb === "rename") return "<env> <slug> <OLD> <NEW> [--execute]";
  if (verb === "remove") return "<env> <slug> [--execute] [--force-nonempty]";
  return "<env>";
}

function editOptionsFor(verb, opts) {
  if (opts.execute !== undefined && !EDIT_VERBS.has(verb))
    throw new SecretError("--execute is only valid for unset, rename and remove");
  if (opts["force-nonempty"] !== undefined && verb !== "remove")
    throw new SecretError("--force-nonempty is only valid for remove");
}

function outputOptionsFor(verb, opts) {
  if (
    (opts["to-file"] !== undefined || opts.reveal !== undefined) &&
    verb !== "get"
  )
    throw new SecretError("--to-file and --reveal are only valid for get");
  if (verb === "get" && !opts["to-file"] && !opts.reveal)
    throw new SecretError("get requires --to-file or explicit --reveal");
}

function optionsFor(verb, opts) {
  const count = opts.positional.length;
  const bounds = {
    init: [0, 0],
    list: [1, 1],
    materialize: [1, 1],
    verify: [1, 1],
    set: [3, Infinity],
    get: [2, 3],
    unset: [3, 3],
    rename: [4, 4],
    remove: [2, 2],
  }[verb];
  if (count < bounds[0] || count > bounds[1])
    throw new SecretError(
      `usage: starci app secret ${verb} ${usageArguments(verb)}`,
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

/** The app root of a sealed member: `<root>/.starcistacks/<env>/secrets/<slug>.enc`. */
const appRootOf = (file) => path.resolve(path.dirname(file), "..", "..", "..");

/**
 * The success line of set: the member and its keys and, for a member this set created, the age identity a later set needs to
 * open it (the recipient it is sealed to, and where this machine holds that identity, or the fix when it holds none). Names
 * and paths only.
 */
function sealedLine(environment, slug, keys, file, created, seam) {
  const head = `sealed ${environment}/${slug} (${keys.join(", ")})`;
  if (!created) return `${head}\n`;
  let recipients = [];
  try { recipients = envelopeOf(fs.readFileSync(file, "utf8")).recipients; }
  catch { recipients = []; }
  const of = recipients.length ? ` of ${recipients.join(", ")}` : "";
  let held = "";
  if (seam.identity?.source) held = `; this machine holds it in ${seam.identity.source}`;
  else if (seam.identity)
    held = `; this machine holds none: add SOPS_AGE_KEY to ${path.join(appRootOf(file), ".claude", "secret.env")} before the next set`;
  return `${head}; a new member: adding keys to it later needs the age identity${of}${held}\n`;
}

/**
 * All app secrets verbs; stdin, prompt, sops, random and tool ports permit isolated custody specs. `hostIdentity`
 * (`{ label, read }`) is the harness CLI's secret.env SOPS_AGE_KEY, the last place before keys.txt the age identity is looked for.
 */
export async function secretMain(
  argv,
  {
    stdout = (s) => process.stdout.write(s),
    stderr = (s) => process.stderr.write(s),
    stdin,
    prompt,
    hostIdentity = null,
    sops = null,
    random = randomBytes,
    env = process.env,
    cwd = invocationDir(),
    platform = process.platform,
    tools,
  } = {},
) {
  const [verb, ...rest] = argv;
  try {
    if (!VERBS.has(verb))
      throw new SecretError(
        "usage: starci app secret init | set <env> <slug> <KEY> [KEY ...] | get <env> <slug> [KEY] --to-file | unset <env> <slug> <KEY> | rename <env> <slug> <OLD> <NEW> | remove <env> <slug> | materialize <env> | list <env> | verify <env>",
      );
    const opts = parse(rest);
    optionsFor(verb, opts);
    const repoRoot = path.resolve(cwd, opts.cwd ?? ".");
    if (verb === "init")
      return publicStorage(() =>
        initializeSecrets(repoRoot, { env, platform, tools, stdout }),
      );
    const [environment, slug, key] = opts.positional;
    const directory = secretsDirectory(repoRoot, environment);
    if (verb === "list") return listSecrets(directory, stdout);
    const open = () => sops ?? defaultSops(env, repoRoot, platform, tools, hostIdentity);
    if (EDIT_VERBS.has(verb))
      return editSecret(verb, {
        directory, environment, slug, names: opts.positional.slice(2),
        execute: opts.execute === true, force: opts["force-nonempty"] === true, sops: open, stdout,
      });
    const seam = open();
    if (verb === "verify")
      return verifySecrets({ repoRoot, directory, environment, sops: seam, stdout });
    const output = { repoRoot, environment, env, platform, stdout };
    if (verb === "materialize")
      return materializeSecrets(directory, seam, output);
    const file = fileOf(directory, slug);
    if (verb === "get") return getSecret(file, key, seam, opts, output, stderr);
    const keys = opts.positional.slice(2);
    const created = !fs.existsSync(file);
    if (!created) seam.requireIdentity?.(file);
    const values = await setValues(keys, { generate: opts.generate, stdin, prompt, random });
    writeSecret({ file, values, age: [], sops: seam });
    stdout(sealedLine(environment, slug, keys, file, created, seam));
    return 0;
  } catch (error) {
    const message = secretErrorMessage(error);
    stderr(`starci app secret: ${message}\n`);
    return 2;
  }
}

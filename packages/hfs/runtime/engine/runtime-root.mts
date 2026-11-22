import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseYaml} from './yaml.mjs';

/**
 * Runtime root helper. The runtime reads this source tree directly. `skillRoot` is the
 * directory containing `package.json` (this module's parent) — the checkout, or the copy of it
 * an install placed on the host.
 *
 * Every workflow, op, schema, knowledge and model contract read at runtime is an authored YAML
 * file (or an authored JSON one where a document is stored that way). `readModuleJson` resolves a
 * path under `skillRoot` and parses the file by its extension.
 */
const moduleRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

/** The runtime root: this source tree (or an immutable sealed payload of it). */
export const skillRoot = moduleRoot;
/**
 * The StarCi Source root (the host containing .claude and .workspaces): STARCI_SOURCE_ROOT overrides it, else the directory
 * holding this runtime checkout. Parameterized over `env`, so a spec can inject a fixture Source.
 */
export const starciSourceRoot = (env: NodeJS.ProcessEnv = process.env): string => (env.STARCI_SOURCE_ROOT ? path.resolve(env.STARCI_SOURCE_ROOT) : path.dirname(skillRoot));

/** Overrides the per-host state base wholesale (debug probes, spec trees); the one seam starciLocalRoot reads. */
export const LOCAL_ROOT_ENV = 'STARCI_LOCAL_ROOT';
/** The host-data directory of a runtime root. Git-ignored and never packed; the example fixtures under examples/.runtimes are a separate, public exception. */
export const RUNTIME_STATE_DIR = '.runtime';
/**
 * <root>/.runtime, the state base of a runtime root that is a checkout (the harness repository, or a copy of it placed on the host).
 * An installed or locally sourced copy keeps none (see installedStateBase).
 */
export const runtimeStateDir = (root: string = skillRoot): string => path.join(root, RUNTIME_STATE_DIR);
/** True when `root` is a copy an install placed below a node_modules folder, not a checkout. */
export const installedRoot = (root: string = skillRoot): boolean => path.resolve(root).split(/[\\/]/).includes('node_modules');
/**
 * The per-user state base of an installed copy: XDG_STATE_HOME, else ~/.local/state, then starci-harness/state, on every platform. It
 * lies outside every package and every product repository, so `npm ci` and a package copy never delete a running stack's data, and every
 * installed copy on the host shares one machine.sqlite and one stack/<project>/<env> per environment. Never under %LOCALAPPDATA% on
 * Windows: an MSIX-packaged app (the Claude desktop app and every agent it starts) writes each new file there into its own
 * Packages/<package>/LocalCache, so the processes it starts and the ones outside it (a terminal, the lander, Docker) would each see a
 * different state base (formerStateBase).
 */
export const installedStateBase = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'starci-harness', 'state');
/**
 * The state base an installed copy used before on Windows, %LOCALAPPDATA%/starci-harness/state, which adoptLegacyState moves into
 * installedStateBase; null off Windows, without LOCALAPPDATA, or when it is the current base.
 */
export const formerStateBase = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null => {
  const local = env['LOCALAPPDATA'];
  if (platform !== 'win32' || !local) return null;
  const former = path.join(local, 'starci-harness', 'state');
  return path.resolve(former) === path.resolve(installedStateBase(env)) ? null : former;
};
/**
 * The per-host state base, the one owner of every host-state location: machine.sqlite, projects/<ledger_id>/runtime.sqlite, archive/,
 * artifacts/ (the blob store), guards/, host-lock/, stack/<project>/<env>/ and the other process state sit under it. LOCAL_ROOT_ENV
 * replaces it wholesale; else a checkout keeps it in <runtime root>/.runtime and an installed copy in installedStateBase.
 */
export const starciLocalRoot = (env: NodeJS.ProcessEnv = process.env, root: string = skillRoot): string => {
  if (env[LOCAL_ROOT_ENV]) return path.resolve(env[LOCAL_ROOT_ENV]);
  return installedRoot(root) ? installedStateBase(env) : runtimeStateDir(root);
};

/** The refusal of a legacy state base a running process still holds (a stack's bind mounts, an open log). */
export class LegacyStateHeld extends Error {
  readonly code = 'HFS_STATE_LEGACY_HELD';
  readonly legacy: string;
  constructor(legacy: string, cause: unknown) {
    super(`${legacy} holds the state of a running stack and cannot move to the state base yet; run \`starci app stack down --env <env>\` for each running environment, then any \`starci app\` verb moves it`, { cause });
    this.legacy = legacy;
  }
}

/**
 * What adopting a legacy state base moved: the top-level entries `to` lacked and now holds, and the paths (relative, `/`-separated) whose
 * file differed from the one `to` already held, each kept under `to/legacy-<stamp>/<path>`.
 */
export interface StateAdoption {
  readonly from: string;
  readonly to: string;
  readonly moved: readonly string[];
  readonly kept: readonly string[];
}

const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);
const isHeld = (error: unknown): boolean => HELD.has(String((error as NodeJS.ErrnoException | null)?.code));

/** Gives `to` and everything below it the mode, owner and group of the matching entry of `from` (a copy keeps neither on its own). */
function keepOwnership(from: string, to: string): void {
  const source = fs.lstatSync(from);
  const target = fs.lstatSync(to);
  if (!source.isSymbolicLink()) fs.chmodSync(to, source.mode & 0o7777);
  if (source.uid !== target.uid || source.gid !== target.gid) fs.lchownSync(to, source.uid, source.gid);
  if (source.isDirectory()) for (const name of fs.readdirSync(from)) keepOwnership(path.join(from, name), path.join(to, name));
}

/** Moves one entry by rename, which keeps its owner and mode; across volumes (EXDEV) it is copied, its ownership restored, then removed. */
function moveEntry(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'EXDEV') throw error;
  }
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  keepOwnership(from, to);
  fs.rmSync(from, { recursive: true, force: true });
}

/** True when two regular files hold the same bytes. */
function sameFile(a: string, b: string): boolean {
  const left = fs.lstatSync(a);
  const right = fs.lstatSync(b);
  return left.isFile() && right.isFile() && left.size === right.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

/**
 * Merges the folder `from` into `to`, then removes `from`: an entry `to` lacks is moved (moveEntry); a folder both hold is merged the same
 * way; a file both hold with the same bytes is dropped; any other entry `to` holds stays as it is, and the one of `from` is moved to the same
 * relative path under `aside` (made only then). Answers the relative paths kept aside.
 */
function mergeInto(from: string, to: string, aside: string, relative = ''): string[] {
  const kept: string[] = [];
  for (const name of fs.readdirSync(from).sort()) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    const at = relative === '' ? name : `${relative}/${name}`;
    if (!fs.existsSync(target)) {
      fs.mkdirSync(to, { recursive: true });
      moveEntry(source, target);
    } else if (fs.lstatSync(source).isDirectory() && fs.lstatSync(target).isDirectory()) {
      kept.push(...mergeInto(source, target, aside, at));
    } else if (sameFile(source, target)) {
      fs.rmSync(source, { force: true });
    } else {
      const parked = path.join(aside, ...at.split('/'));
      fs.mkdirSync(path.dirname(parked), { recursive: true });
      moveEntry(source, parked);
      kept.push(at);
    }
  }
  fs.rmSync(from, { recursive: true, force: true });
  return kept;
}

/** Merges the legacy base `from` (its entries read from `source`) into `to`; null when it holds nothing. */
function adoptBase(from: string, source: string, to: string, aside: string): StateAdoption | null {
  const names = fs.readdirSync(source).sort();
  if (names.length === 0) {
    fs.rmSync(source, { recursive: true, force: true });
    return null;
  }
  const moved = names.filter((name) => !fs.existsSync(path.join(to, name)));
  return { from, to, moved, kept: mergeInto(source, to, aside) };
}

/**
 * Moves the state an installed copy kept in a legacy base out to the state base (installedStateBase), merged with what the base already
 * holds (mergeInto): a file present with the same bytes is dropped and only a differing one is kept under legacy-<stamp>/, so adopting the
 * same data again keeps nothing aside. Each entry moves with its owner and mode (a bind folder a container user owns stays that user's).
 * Two legacy bases are adopted, in this order:
 * - the former Windows base %LOCALAPPDATA%/starci-harness/state (formerStateBase), entry by entry: a rename out of AppData made inside an
 *   MSIX-packaged app carries the package's private copy of each file out with it, so the files the app's processes wrote there and the
 *   ones the host's wrote end up in one base;
 * - the state the copy kept inside itself (<copy>/.runtime), first renamed to <copy>/.runtime.adopting, so an interrupted adoption resumes.
 * A rename a running stack's open files refuse throws LegacyStateHeld. Empty when there is nothing to adopt: a checkout, LOCAL_ROOT_ENV
 * set, or no legacy folder.
 */
export function adoptLegacyState(env: NodeJS.ProcessEnv = process.env, root: string = skillRoot, now: () => Date = () => new Date(), platform: NodeJS.Platform = process.platform): StateAdoption[] {
  if (env[LOCAL_ROOT_ENV] || !installedRoot(root)) return [];
  const to = installedStateBase(env);
  const aside = path.join(to, `legacy-${now().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`);
  const adopted: StateAdoption[] = [];
  const former = formerStateBase(env, platform);
  if (former !== null && fs.existsSync(former)) {
    // No parking rename inside AppData (a packaged app's rename there may stay in its private view): each entry's own rename is the held probe.
    let done: StateAdoption | null;
    try { done = adoptBase(former, former, to, aside); } catch (error) { if (isHeld(error)) throw new LegacyStateHeld(former, error); throw error; }
    if (done) adopted.push(done);
  }
  const from = runtimeStateDir(root);
  const parked = `${from}.adopting`;
  if (!fs.existsSync(parked)) {
    if (!fs.existsSync(from)) return adopted;
    try { fs.renameSync(from, parked); } catch (error) { if (isHeld(error)) throw new LegacyStateHeld(from, error); throw error; }
  }
  const done = adoptBase(from, parked, to, aside);
  if (done) adopted.push(done);
  return adopted;
}

/**
 * Read a runtime contract document. `parts` are path segments under `skillRoot`
 * (e.g. readModuleJson('modules', 'models', 'kinds.yaml')).
 */
// reason: a parsed YAML/JSON contract document read from disk (parsed-input boundary); callers index into it by contract shape.
export function readModuleJson(...parts: string[]): any {
  const rel = parts.join('/');
  const file = path.join(skillRoot, rel);
  if (!(file.startsWith(skillRoot) && fs.existsSync(file) && fs.statSync(file).isFile()))
    throw new Error(`Required contract not found for ${rel} under ${skillRoot}`);
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return parseYaml(text);
  return JSON.parse(text);
}

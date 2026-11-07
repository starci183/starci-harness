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
 * The per-user state base of an installed copy: LOCALAPPDATA (Windows), else XDG_STATE_HOME, else ~/.local/state, then
 * starci-harness/state. It lies outside every package and every product repository, so `npm ci` and a package copy never delete a
 * running stack's data, and every installed copy on the host shares one machine.sqlite and one stack/<project>/<env> per environment.
 */
export const installedStateBase = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(env['LOCALAPPDATA'] || env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'starci-harness', 'state');
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
    super(`${legacy} holds the state of a running stack and cannot move out of the package yet; run \`starci app stack down --env <env>\` for each running environment, then any \`starci app\` verb moves it`, { cause });
    this.legacy = legacy;
  }
}

/** What adopting a legacy state base moved: the entries now under `to`, and the ones `to` already held, kept under `to/legacy-<stamp>/`. */
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

/**
 * Moves the state an installed copy kept inside itself (<copy>/.runtime, before installedStateBase) out to the state base, once: the
 * folder is first renamed to <copy>/.runtime.adopting (a rename a running stack's open files refuse, LegacyStateHeld), then each entry
 * is moved with its owner and mode (a bind folder a container user owns stays that user's) and the folder removed. An entry the state base already holds is kept beside it under legacy-<stamp>/, never overwritten. An
 * interrupted adoption resumes from .runtime.adopting. Null when there is nothing to adopt: a checkout, LOCAL_ROOT_ENV set, or no
 * legacy folder.
 */
export function adoptLegacyState(env: NodeJS.ProcessEnv = process.env, root: string = skillRoot, now: () => Date = () => new Date()): StateAdoption | null {
  if (env[LOCAL_ROOT_ENV] || !installedRoot(root)) return null;
  const from = runtimeStateDir(root);
  const parked = `${from}.adopting`;
  if (!fs.existsSync(parked)) {
    if (!fs.existsSync(from)) return null;
    try { fs.renameSync(from, parked); } catch (error) { if (isHeld(error)) throw new LegacyStateHeld(from, error); throw error; }
  }
  const to = installedStateBase(env);
  const aside = path.join(to, `legacy-${now().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`);
  const moved: string[] = [];
  const kept: string[] = [];
  for (const name of fs.readdirSync(parked).sort()) {
    const taken = fs.existsSync(path.join(to, name));
    fs.mkdirSync(taken ? aside : to, { recursive: true });
    moveEntry(path.join(parked, name), path.join(taken ? aside : to, name));
    (taken ? kept : moved).push(name);
  }
  fs.rmSync(parked, { recursive: true, force: true });
  return { from, to, moved, kept };
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

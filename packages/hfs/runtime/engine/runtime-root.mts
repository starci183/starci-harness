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
 * Packages/<package>/LocalCache, so the processes it starts and the ones outside it (a terminal, a lane, Docker) would each see a
 * different state base.
 */
export const installedStateBase = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'starci-harness', 'state');
/**
 * The per-host state base, the one owner of every host-state location: machine.sqlite, projects/<ledger_id>/runtime.sqlite, archive/,
 * artifacts/ (the blob store), guards/, host-lock/, stack/<project>/<env>/ and the other process state sit under it. LOCAL_ROOT_ENV
 * replaces it wholesale; else a checkout keeps it in <runtime root>/.runtime and an installed copy in installedStateBase.
 */
export const starciLocalRoot = (env: NodeJS.ProcessEnv = process.env, root: string = skillRoot): string => {
  if (env[LOCAL_ROOT_ENV]) return path.resolve(env[LOCAL_ROOT_ENV]);
  return installedRoot(root) ? installedStateBase(env) : runtimeStateDir(root);
};

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

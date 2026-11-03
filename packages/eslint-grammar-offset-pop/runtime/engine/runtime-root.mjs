import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml.mjs';
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
export const starciSourceRoot = (env = process.env) => (env.STARCI_SOURCE_ROOT ? path.resolve(env.STARCI_SOURCE_ROOT) : path.dirname(skillRoot));
/** Overrides the per-host state base wholesale (debug probes, spec trees); the one seam starciLocalRoot reads. */
export const LOCAL_ROOT_ENV = 'STARCI_LOCAL_ROOT';
/** The host-data directory of a runtime root. Git-ignored and never packed; the example fixtures under examples/.runtimes are a separate, public exception. */
export const RUNTIME_STATE_DIR = '.runtime';
/**
 * <root>/.runtime, the state base of a runtime root that is a checkout (the harness repository, or a copy of it placed on the host).
 * An installed or locally sourced copy keeps none (see installedStateBase).
 */
export const runtimeStateDir = (root = skillRoot) => path.join(root, RUNTIME_STATE_DIR);
/** True when `root` is a copy an install or `starci deps source --local` placed below a node_modules folder, not a checkout. */
export const installedRoot = (root = skillRoot) => path.resolve(root).split(/[\\/]/).includes('node_modules');
/**
 * The per-user state base of an installed copy: LOCALAPPDATA (Windows), else XDG_STATE_HOME, else ~/.local/state, then
 * starci-harness/state. It lies outside every package and every product repository, so `npm ci` and a package copy never delete a
 * running stack's data, and every installed copy on the host shares one machine.sqlite and one stack/<project>/<env> per environment.
 */
export const installedStateBase = (env = process.env) => path.join(env['LOCALAPPDATA'] || env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'starci-harness', 'state');
/**
 * The per-host state base, the one owner of every host-state location: machine.sqlite, projects/<ledger_id>/runtime.sqlite, archive/,
 * artifacts/ (the blob store), guards/, host-lock/, stack/<project>/<env>/ and the other process state sit under it. LOCAL_ROOT_ENV
 * replaces it wholesale; else a checkout keeps it in <runtime root>/.runtime and an installed copy in installedStateBase.
 */
export const starciLocalRoot = (env = process.env, root = skillRoot) => {
    if (env[LOCAL_ROOT_ENV])
        return path.resolve(env[LOCAL_ROOT_ENV]);
    return installedRoot(root) ? installedStateBase(env) : runtimeStateDir(root);
};
/** The refusal of a legacy state base a running process still holds (a stack's bind mounts, an open log). */
export class LegacyStateHeld extends Error {
    code = 'HFS_STATE_LEGACY_HELD';
    legacy;
    constructor(legacy, cause) {
        super(`${legacy} holds the state of a running stack and cannot move out of the package yet; run \`starci app stack down --env <env>\` for each running environment, then any \`starci app\` verb moves it`, { cause });
        this.legacy = legacy;
    }
}
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);
const isHeld = (error) => HELD.has(String(error?.code));
/**
 * Moves the state an installed copy kept inside itself (<copy>/.runtime, before installedStateBase) out to the state base, once: the
 * folder is first renamed to <copy>/.runtime.adopting (a rename a running stack's open files refuse, LegacyStateHeld), then copied
 * entry by entry and removed. An entry the state base already holds is kept beside it under legacy-<stamp>/, never overwritten. An
 * interrupted adoption resumes from .runtime.adopting. Null when there is nothing to adopt: a checkout, LOCAL_ROOT_ENV set, or no
 * legacy folder.
 */
export function adoptLegacyState(env = process.env, root = skillRoot, now = () => new Date()) {
    if (env[LOCAL_ROOT_ENV] || !installedRoot(root))
        return null;
    const from = runtimeStateDir(root);
    const parked = `${from}.adopting`;
    if (!fs.existsSync(parked)) {
        if (!fs.existsSync(from))
            return null;
        try {
            fs.renameSync(from, parked);
        }
        catch (error) {
            if (isHeld(error))
                throw new LegacyStateHeld(from, error);
            throw error;
        }
    }
    const to = installedStateBase(env);
    const aside = path.join(to, `legacy-${now().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`);
    const moved = [];
    const kept = [];
    for (const name of fs.readdirSync(parked).sort()) {
        const taken = fs.existsSync(path.join(to, name));
        fs.cpSync(path.join(parked, name), path.join(taken ? aside : to, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
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
export function readModuleJson(...parts) {
    const rel = parts.join('/');
    const file = path.join(skillRoot, rel);
    if (!(file.startsWith(skillRoot) && fs.existsSync(file) && fs.statSync(file).isFile()))
        throw new Error(`Required contract not found for ${rel} under ${skillRoot}`);
    const text = fs.readFileSync(file, 'utf8');
    if (/\.ya?ml$/i.test(file))
        return parseYaml(text);
    return JSON.parse(text);
}

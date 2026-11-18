// nested-lock.mts - the lockfile of a managed sub-package. `starci app sync` renders the package.json of a managed sub-package (gallery/package.json
// carries @starci/gallery and vite); a lockfile beside it that was committed before the render no longer matches it, and `npm ci` in that folder
// then refuses (the dev stack's gallery never starts). Sync resolves the lockfile again with npm after it writes the package.json, and the managed-file
// check names the mismatch with the command that fixes it. Only a sub-package that already has a package-lock.json is judged: the folder the app
// installs with `npm install` creates its own.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** The npm step that resolves a lockfile from its package.json without node_modules or lifecycle scripts. */
export const NESTED_LOCK_STEP = 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** One sub-package whose lockfile no longer matches its package.json: the folder and the dependency names that differ. */
export interface NestedLockDrift { dir: string; lock: string; names: string[] }
export type NestedLockResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

const readJson = (file: string): any => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const declaredOf = (manifest: any, field: string): Record<string, string> => (manifest && typeof manifest[field] === 'object' && manifest[field] !== null ? manifest[field] : {});

/** The folders of the sub-packages among the managed target paths (a package.json below the app root). */
export function nestedPackageDirs(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(file => file.endsWith('/package.json')).map(file => path.posix.dirname(file)))].sort();
}

/** The dependency names whose declared range in `manifest` is not the one the lockfile records for the package itself. */
export function lockDifference(manifest: unknown, lock: unknown): string[] {
  const root = (lock as { packages?: Record<string, unknown> } | null)?.packages?.[''];
  if (root === undefined || typeof root !== 'object' || root === null) return ['lockfileVersion'];
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const declared = declaredOf(manifest, field);
    const locked = declaredOf(root, field);
    for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) if (declared[name] !== locked[name]) names.add(name);
  }
  return [...names].sort();
}

/**
 * The sub-packages of the managed `paths` whose package-lock.json differs from package.json. `contents` gives the package.json a render is about
 * to write (sync without --execute); the one on disk is read otherwise.
 */
export function nestedLockDrift(root: string, paths: readonly string[], contents: ReadonlyMap<string, string> = new Map()): NestedLockDrift[] {
  const drift: NestedLockDrift[] = [];
  for (const dir of nestedPackageDirs(paths)) {
    const lock = `${dir}/package-lock.json`;
    if (!fs.existsSync(path.join(root, lock))) continue;
    const text = contents.get(`${dir}/package.json`);
    const manifest = text === undefined ? readJson(path.join(root, dir, 'package.json')) : JSON.parse(text);
    if (manifest === null) continue;
    const names = lockDifference(manifest, readJson(path.join(root, lock)));
    if (names.length) drift.push({ dir, lock, names });
  }
  return drift;
}

/** The command that fixes the lockfile of `dir`, named in the findings. */
export const nestedLockFix = (dir: string): string => `cd ${dir} && ${NESTED_LOCK_STEP}`;

/** Resolves the lockfile of `dir` with npm (through the shell: npm is npm.cmd on Windows); the command is the fixed literal NESTED_LOCK_STEP. */
export function npmResolveLock(dir: string): NestedLockResult {
  const run = spawnSync(NESTED_LOCK_STEP, { cwd: dir, encoding: 'utf8', shell: true, windowsHide: true, timeout: 600_000 });
  if (run.status === 0) return { ok: true };
  const said = `${run.stderr ?? ''}\n${run.stdout ?? ''}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { ok: false, detail: `exit ${run.status ?? 'none'}: ${run.error ? run.error.message : (said.find(line => /^npm (?:error|ERR!)/i.test(line)) ?? said[0] ?? 'no output')}` };
}

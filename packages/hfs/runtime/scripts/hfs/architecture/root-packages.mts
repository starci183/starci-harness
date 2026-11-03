// root-packages.mjs - the workspace packages of an app ROOT (packages/agent-sdk, packages/module-<name>, the managed packages/modules).
// They lie outside both side folders and belong to no side; both sides import them by package name, through their package entry points
// (the `exports` of the manifest), so the import graph reads them as first-party packages and the back-end canon never reads them as
// a third-party library. The app root's one package.json lists them in `workspaces`; the patterns that start with a side folder
// (`fe/apps/*`) are that side's own workspaces and are not read here.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile as readJson } from '../../lib/json.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { isInside } from '../../lib/walk.mjs';
import { slash } from '../../lib/path-key.mjs';

/**
 * A workspace package of the app root: a first-party package that both sides import through its package entry points and never past
 * them. `root` is the real path of its folder, `relative` the folder from the app root, `exports` the `exports` of its manifest.
 */
export interface RootPackage {
  root: string;
  relative: string;
  name: string;
  exports: unknown;
  manifest: Record<string, unknown>;
  workspace: true;
  app: false;
}

/** The slots whose directories at the app root are first-party packages of the app (agent SDK, module packages, the managed registry). */
export const ROOT_PACKAGE_SLOTS: ReadonlySet<string> = new Set(['app.packages', 'app.module-registry']);

const SIDE_PREFIX = /^(?:be|fe)\//;

/** A workspace pattern this reader expands (a literal path, or `*` as a whole segment); the others are judged by the workspace rules. */
const expandablePattern = (written: string): boolean => !path.isAbsolute(written) && written.split('/').every(segment => segment !== '..' && (!segment.includes('*') || segment === '*'));

function expandSegment(base: string, segment: string): string[] {
  if (segment !== '*') return [path.join(base, segment)];
  if (!fs.existsSync(base) || !fs.lstatSync(base).isDirectory()) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => byCodeUnit(a.name, b.name)).map(item => path.join(base, item.name));
}

/** A package folder with a regular package.json (a link is not one). */
export function packageDirectory(absolute: string): boolean {
  try {
    if (!fs.lstatSync(absolute).isDirectory()) return false;
    const manifest = fs.lstatSync(path.join(absolute, 'package.json'));
    return manifest.isFile() && !manifest.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The folders the `workspaces` of the app root's package.json name that no side owns, as absolute paths in code-unit order. */
export function rootWorkspaceDirectories(packageRoot: string): string[] {
  const manifest: { workspaces?: unknown[] | { packages?: unknown[] } } | null = readJson(path.join(packageRoot, 'package.json'));
  const declared = manifest?.workspaces;
  const patterns = Array.isArray(declared) ? declared : declared?.packages;
  const found = new Set<string>();
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    if (typeof pattern !== 'string' || !pattern.trim()) continue;
    const written = slash(pattern.trim()).replace(/^\.\//, '');
    if (SIDE_PREFIX.test(written) || !expandablePattern(written)) continue;
    let bases = [packageRoot];
    for (const segment of written.split('/')) bases = bases.flatMap(base => expandSegment(base, segment));
    for (const base of bases) found.add(path.resolve(base));
  }
  return [...found].sort(byCodeUnit);
}

/**
 * The record of one package folder of the app root, or null when it is no named package inside the app root.
 * `canonical` is the file-identity function of the caller (the real path), so a record agrees with the files the graph reads.
 */
export function rootPackageRecord(packageRoot: string, directory: string, canonical: (file: string) => string): RootPackage | null {
  if (!packageDirectory(directory) || !isInside(packageRoot, directory)) return null;
  const manifest: Record<string, unknown> | null = readJson(path.join(directory, 'package.json'));
  const name = manifest?.['name'];
  if (manifest === null || typeof name !== 'string' || !name) return null;
  return { root: canonical(directory), relative: slash(path.relative(packageRoot, directory)), name, exports: manifest['exports'], manifest, workspace: true, app: false };
}

/** The names of the workspace packages of the app root: what the back-end canon must not read as third-party libraries. */
export function rootPackageNames(packageRoot: string): Set<string> {
  const names = new Set<string>();
  for (const directory of rootWorkspaceDirectories(packageRoot)) {
    const record = rootPackageRecord(packageRoot, directory, (file) => file);
    if (record !== null) names.add(record.name);
  }
  return names;
}

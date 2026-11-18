// nivoos-side.mts - the nivoos packages a project declares (contexts/project/business-repo.md PROJECT-BUSINESS-1, R436): hfs.json `sides.nivoos` holds
//   "nivoos": { "packages": [ { "name": "nivo-web", "entry": "src/nivo-web.package.ts", "out": "seed" } ] }
// one entry per business package authored with the nivoos SDK (agents, workflows, cells, steps, brain, accounts and the seed document they build).
// Each package is a root workspace package at `packages/<name>/` (slot app.nivoos-package): its source is judged by the SDK authoring lint
// profile (@starci/eslint-canon-be, `lintProfile: nivoos`) and the package itself by `nivoos package check` (cache/nivoos-package-check.mts).
// `nivoos` is a declaration side of the packages folder, not a folder of its own: a project that declares it also has the root packages side.
// Pure and dependency-free: the declaration shape, the defaults and the test of "this manifest imports the SDK".
import { isPlainObject } from '../../engine/plain-object.mjs';

/** The key of `sides` that declares the nivoos packages of a business repository. */
export const NIVOOS_SIDE = 'nivoos';
/** The slot of a declared nivoos package folder (`packages/<package>/`). */
export const NIVOOS_PACKAGE_SLOT = 'app.nivoos-package';
/** The lint profile the slot hands the canon: the SDK authoring profile of @starci/eslint-canon-be. */
export const NIVOOS_LINT_PROFILE = 'nivoos';
/** The entry of a package when its declaration names none: `src/<name>.package.ts`, the file `nivoos package build` takes. */
export const defaultEntry = (name: string): string => `src/${name}.package.ts`;
/** The folder a package's seed document is built into when its declaration names none. */
export const DEFAULT_OUT = 'seed';
/** What a package name, entry and out folder look like: kebab-case name, a package-relative path (forward slashes, no `..`). */
const NAME = /^[a-z][a-z0-9-]*$/u;
const RELATIVE = /^(?!\/)(?!.*\.\.)(?!.*\\)[A-Za-z0-9._/-]+$/u;
/**
 * A dependency name that is the nivoos SDK, the signal that a root package is authored with it: the SDK as linked from a sibling checkout
 * (`@nivoos-lite/nivoos-sdk`) or as published (`@nivoos/sdk`, `@nivoos/nivoos-sdk`), and the author CLI `nivoos`.
 */
export const NIVOOS_SDK_DEPENDENCY = /^(?:@nivoos(?:-lite)?\/(?:nivoos-)?sdk|@starci\/nivoos-(?:sdk|cli)|nivoos)$/u;

/** One nivoos package a project declares, with the defaults applied. */
export interface NivoosPackage { readonly name: string; readonly entry: string; readonly out: string }

/** The problems of the value of `sides.nivoos`, in the words of the declaration: an object holding a non-empty unique list `packages`. */
export function nivoosSideProblems(value: unknown): string[] {
  const at = 'sides.nivoos';
  if (!isPlainObject(value)) return [`${at} must be an object { "packages": [ { "name": "<package folder>" } ] }`];
  const bad = Object.keys(value).filter((key) => key !== 'packages').map((key) => `${at} has unknown key ${key}`);
  const list: unknown = (value as Record<string, unknown>)['packages'];
  if (!Array.isArray(list) || list.length === 0) return [...bad, `${at}.packages must be a non-empty list of { name, entry?, out? }, one per nivoos package at packages/<name>/`];
  const seen = new Set<string>();
  list.forEach((entry: unknown, at_) => {
    const where = `${at}.packages[${String(at_)}]`;
    if (!isPlainObject(entry)) { bad.push(`${where} must be an object { "name": "<package folder>" }`); return; }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!['name', 'entry', 'out'].includes(key)) bad.push(`${where} has unknown key ${key}`);
    const { name, entry: file, out } = record;
    if (typeof name !== 'string' || !NAME.test(name)) bad.push(`${where}.name must be the kebab-case folder name of the package at packages/<name>/`);
    else if (seen.has(name)) bad.push(`${where}.name ${name} is declared twice`);
    else seen.add(name);
    if (file !== undefined && (typeof file !== 'string' || !file.startsWith('src/') || !/\.ts$/u.test(file) || !RELATIVE.test(file))) bad.push(`${where}.entry must be a package-relative .ts path below src/ (default src/<name>.package.ts)`);
    if (out !== undefined && (typeof out !== 'string' || !RELATIVE.test(out))) bad.push(`${where}.out must be a package-relative folder (default ${DEFAULT_OUT})`);
  });
  return bad;
}

/** The nivoos packages a parsed hfs.json `sides` declares, defaults applied and sorted by name; none when it declares none or the declaration is malformed (the shape check reports that). */
export function nivoosPackagesOf(sides: unknown): NivoosPackage[] {
  if (!isPlainObject(sides) || !Object.hasOwn(sides, NIVOOS_SIDE) || nivoosSideProblems((sides as Record<string, unknown>)[NIVOOS_SIDE]).length > 0) return [];
  const list = (sides as Record<string, { packages: Array<{ name: string; entry?: string; out?: string }> }>)[NIVOOS_SIDE]?.packages ?? [];
  return list.map((entry) => ({ name: entry.name, entry: entry.entry ?? defaultEntry(entry.name), out: entry.out ?? DEFAULT_OUT })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Whether a parsed `package.json` depends on the nivoos SDK or its author CLI (in any dependency block). */
export function dependsOnNivoosSdk(manifest: unknown): boolean {
  if (!isPlainObject(manifest)) return false;
  const record = manifest as Record<string, unknown>;
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((block) => isPlainObject(record[block]) && Object.keys(record[block] as object).some((name) => NIVOOS_SDK_DEPENDENCY.test(name)));
}

// package-slots.mts - the slots a project declares for the tree of one of its root workspace packages (PROJECT-LINT-3, R382), in the project's
// extension manifest (`ext/manifest.json`, scripts/lib/project-ext.mts), under `packages`, by the package's app-relative folder:
//   "packages": { "packages/<name>": {
//     "closed": true,                                          (default) every file below src/ belongs to a slot
//     "slots": [
//       { "id": "block", "path": "src/blocks/<id>/",           a folder slot: one instance per value of its placeholders
//         "requires": ["schema.ts", "renderer.tsx", "<id>.spec.ts"],
//         "allows": ["*.ts", "*.tsx"] },                       (optional) what else an instance may hold
//       { "id": "views", "path": "src/views/**",               a glob slot
//         "lint": "fe",                                        (optional) the canon that judges it: be (the default) or fe
//         "coverage": { "none": "front-end views, proven by the front end's own gates (SHARED-TEST-1)" } },
//       { "id": "barrel", "path": "src/index.ts" } ] } }
// A package has no manifest of its own: the project declares it. `packages/<name>/slots.yaml` (`schema: starci/package-slots@1`, the same keys in
// YAML) is still read for a package the project's manifest does not declare, with a warning (HFS_PACKAGE_SLOTS_MOVED), and goes with the next minor.
// hfs enforces the slots as it enforces the be and fe slots: an instance lacking a required file, a file an instance does not allow and a file of no
// slot are findings, and a declaration it cannot read is one too. Coverage follows the slots: every file of a package is measured at 100 per file in
// the back end's unit run (BE-TEST-13), but its barrels and type files and the slots that opt out with `coverage: { none: <reason> }`, a reason
// required. A package no declaration names keeps the harness's default scope (PACKAGE_UNMEASURED of coverage-scope.mts).
import { parseYaml } from '../../engine/yaml.mjs';
import { globExpression } from '../lib/glob.mjs';

export const PACKAGE_SLOTS_SCHEMA = 'starci/package-slots@1';
export const PACKAGE_SLOTS_FILE = 'slots.yaml';
export const PACKAGE_SLOTS_INVALID = 'HFS_PACKAGE_SLOTS_INVALID';
export const PACKAGE_SLOT_MISSING = 'HFS_PACKAGE_SLOT_MISSING';
export const PACKAGE_SLOT_DISALLOWED = 'HFS_PACKAGE_SLOT_DISALLOWED';
export const PACKAGE_SLOT_UNPLACED = 'HFS_PACKAGE_SLOT_UNPLACED';
export const PACKAGE_SLOTS_MOVED = 'HFS_PACKAGE_SLOTS_MOVED';
/** The files of a package measured by no slot whatever its manifest says: the barrels and the type-only files, as in the back end. */
export const PACKAGE_ALWAYS_UNMEASURED = Object.freeze(['src/**/index.ts', 'src/**/*.types.ts', 'src/**/*-types.ts']);

/** One slot of a package manifest, read. */
export interface PackageSlot { id: string; path: string; requires: string[]; allows: string[] | null; coverageNone: string | null; lint: 'be' | 'fe' }
/** A package manifest read: its slots and whether every file of src/ must belong to one, or the problems that make it unreadable. */
export type PackageSlots = { slots: PackageSlot[]; closed: boolean; problems: string[] };

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const SLOT_KEYS = new Set(['id', 'path', 'requires', 'allows', 'coverage', 'lint']);
const PLACEHOLDER = /<([a-z][a-z0-9-]*)>/gu;
const isFolderSlot = (slot: Pick<PackageSlot, 'path'>): boolean => slot.path.endsWith('/') && !slot.path.includes('*');
const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '') ? (value as string[]) : null);

/** The slots.yaml text of a package (the read path that goes with the next minor), read and judged. */
export function readPackageSlots(text: string): PackageSlots {
  let doc: unknown;
  try { doc = parseYaml(text); } catch (error) { return { slots: [], closed: true, problems: [`is not YAML (${String((error as Error | undefined)?.message ?? error).split('\n')[0]})`] }; }
  if (!plain(doc) || doc['schema'] !== PACKAGE_SLOTS_SCHEMA) return { slots: [], closed: true, problems: [`is not a ${PACKAGE_SLOTS_SCHEMA} manifest`] };
  const declared = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'schema'));
  return judgePackageSlots(declared);
}

/** One package's declaration (`{ closed?, slots }`, as the project's manifest holds it under `packages`), judged. */
export function judgePackageSlots(doc: unknown): PackageSlots {
  const problems: string[] = [];
  if (!plain(doc)) return { slots: [], closed: true, problems: ['is not an object { closed, slots }'] };
  const extra = Object.keys(doc).filter((key) => !['closed', 'slots'].includes(key));
  if (extra.length > 0) problems.push(`has unknown key ${extra.join(', ')} (closed, slots)`);
  if (doc['closed'] !== undefined && typeof doc['closed'] !== 'boolean') problems.push('closed is true or false');
  const entries = Array.isArray(doc['slots']) ? doc['slots'] : [];
  if (entries.length === 0) problems.push('declares no slot');
  const slots: PackageSlot[] = [];
  const ids = new Set<string>();
  entries.forEach((entry, at) => {
    if (!plain(entry)) { problems.push(`slot ${String(at)} is not an object`); return; }
    const id = typeof entry['id'] === 'string' ? entry['id'] : '';
    const where = id === '' ? `slot ${String(at)}` : `slot ${id}`;
    const unknown = Object.keys(entry).filter((key) => !SLOT_KEYS.has(key));
    if (unknown.length > 0) problems.push(`${where} has unknown key ${unknown.join(', ')}`);
    if (!/^[a-z][a-z0-9-]*$/u.test(id)) problems.push(`${where}: id is a kebab-case name`);
    else if (ids.has(id)) problems.push(`${where}: the id is declared twice`);
    ids.add(id);
    const path = typeof entry['path'] === 'string' ? entry['path'] : '';
    if (!path.startsWith('src/') || path.includes('..') || path.includes('\\')) problems.push(`${where}: path is a package-relative path below src/ (src/blocks/<id>/, src/lib/**, src/index.ts)`);
    const requires = entry['requires'] === undefined ? [] : strings(entry['requires']);
    const allows = entry['allows'] === undefined ? null : strings(entry['allows']);
    if (requires === null) problems.push(`${where}: requires is a list of file names`);
    if (entry['allows'] !== undefined && allows === null) problems.push(`${where}: allows is a list of globs`);
    if ((requires?.length ?? 0) > 0 && !path.endsWith('/')) problems.push(`${where}: only a folder slot (a path ending in /) requires files`);
    let coverageNone: string | null = null;
    const coverage = entry['coverage'];
    if (coverage !== undefined && coverage !== 'measured') {
      if (!plain(coverage) || Object.keys(coverage).join() !== 'none' || typeof coverage['none'] !== 'string' || coverage['none'].trim().length < 12) problems.push(`${where}: coverage is measured (the default) or { none: "<why this slot is not measured>" }, with its reason`);
      else coverageNone = coverage['none'].trim();
    }
    const lint = entry['lint'] ?? 'be';
    if (lint !== 'be' && lint !== 'fe') problems.push(`${where}: lint is be (the default) or fe, the canon that judges the slot's files`);
    slots.push({ id, path, requires: requires ?? [], allows, coverageNone, lint: lint === 'fe' ? 'fe' : 'be' });
  });
  return { slots, closed: doc['closed'] !== false, problems };
}

/** The anchored expression of a slot path: a placeholder is one segment, a folder slot covers what lies below it. */
function slotExpression(slot: Pick<PackageSlot, 'path'>): RegExp {
  if (!isFolderSlot(slot)) return globExpression(slot.path.replace(PLACEHOLDER, '*'));
  const source = slot.path.split(PLACEHOLDER).map((part, at) => (at % 2 === 1 ? `(?<${part.replace(/-/gu, '_')}>[^/]+)` : part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))).join('');
  return new RegExp(`^${source}(?<rest>.+)$`, 'u');
}

/** The globs (package-relative) a manifest leaves unmeasured: the barrels and type files, and every slot that opts out. */
export function unmeasuredGlobs(manifest: PackageSlots): string[] {
  return [...PACKAGE_ALWAYS_UNMEASURED, ...manifest.slots.filter((slot) => slot.coverageNone !== null).map((slot) => (isFolderSlot(slot) ? `${slot.path.replace(PLACEHOLDER, '*')}**` : slot.path.replace(PLACEHOLDER, '*')))];
}

/** The globs (package-relative) of the slots a declaration hands to the front-end canon (`lint: fe`). */
export function frontEndGlobs(manifest: PackageSlots): string[] {
  return manifest.slots.filter((slot) => slot.lint === 'fe').map((slot) => (isFolderSlot(slot) ? `${slot.path.replace(PLACEHOLDER, '*')}**` : slot.path.replace(PLACEHOLDER, '*')));
}

/** The findings of one package (`folder`, app-relative) under its declaration at `at` (the file that holds it), over the package's tracked files (package-relative). */
export function packageSlotProblems(folder: string, manifest: PackageSlots, files: readonly string[], at = `${folder}/${PACKAGE_SLOTS_FILE}`): { code: string; path: string; message: string }[] {
  if (manifest.problems.length > 0) return manifest.problems.map((problem) => ({ code: PACKAGE_SLOTS_INVALID, path: at, message: `${at} ${problem} (R382, PROJECT-LINT-3)` }));
  const out: { code: string; path: string; message: string }[] = [];
  const compiled = manifest.slots.map((slot) => ({ slot, expression: slotExpression(slot) }));
  const instances = new Map<string, { slot: PackageSlot; root: string; values: Record<string, string>; files: string[] }>();
  for (const file of files.filter((entry) => entry.startsWith('src/'))) {
    const owner = compiled.find(({ expression }) => expression.test(file));
    if (owner === undefined) {
      if (manifest.closed) out.push({ code: PACKAGE_SLOT_UNPLACED, path: `${folder}/${file}`, message: `${folder}/${file} belongs to no slot of ${at}; place it in a declared slot or declare the slot (R382)` });
      continue;
    }
    if (!isFolderSlot(owner.slot)) continue;
    const groups = { ...(owner.expression.exec(file)?.groups ?? {}) };
    const rest = groups['rest'] as string;
    delete groups['rest'];
    const root = file.slice(0, file.length - rest.length);
    const instance = instances.get(root) ?? { slot: owner.slot, root, values: groups as Record<string, string>, files: [] };
    instance.files.push(rest);
    instances.set(root, instance);
  }
  for (const { slot, root, values, files: held } of instances.values()) {
    const fill = (name: string): string => name.replace(PLACEHOLDER, (_whole, key: string) => values[key.replace(/-/gu, '_')] ?? `<${key}>`);
    for (const required of slot.requires.map(fill)) {
      if (!held.includes(required)) out.push({ code: PACKAGE_SLOT_MISSING, path: `${folder}/${root}${required}`, message: `${folder}/${root} is a ${slot.id} of ${at} and lacks ${required} (requires ${slot.requires.join(', ')}) (R382)` });
    }
    if (slot.allows === null) continue;
    const allowed = [...slot.requires.map(fill), ...slot.allows.map(fill)].map((glob) => globExpression(glob));
    for (const file of held) if (!allowed.some((expression) => expression.test(file))) out.push({ code: PACKAGE_SLOT_DISALLOWED, path: `${folder}/${root}${file}`, message: `${folder}/${root}${file} is no file a ${slot.id} of ${at} holds (requires ${slot.requires.join(', ') || 'nothing'}, allows ${slot.allows.join(', ')}) (R382)` });
  }
  return out;
}

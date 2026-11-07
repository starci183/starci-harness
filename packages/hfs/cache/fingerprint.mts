// fingerprint.mts - the fingerprint of the app check cache, judged per family. A part is anything a step reads that is not an app source, and each part names
// the families that read it (`familiesOfPart`): a part that differs makes only those families full, so a bump of `@starci/hfs` re-runs the hfs-run checks and
// never ESLint, and a bump of a library no toolchain is made of re-runs nothing by fingerprint (the lint family's import graph re-judges the files that import
// it). Parts are portable (equal on every host for one commit): the cache format, the CLI and @starci/hfs that run, every installed @starci package by version
// and recorded integrity, each family's toolchain as the lockfile resolved it, and the configuration files by normalised content. A run whose CLI or any
// @starci package is linked or copied from a local folder, or resolved from a registry on this machine, has no portable fingerprint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { CACHE_FORMAT_VERSION, FAMILIES, type FamilyId, type FingerprintPart } from './types.mjs';

/** The tracked files (by base name) that are parts by content. `package-lock.json` is not one: each family reads its own toolchain from it (`lock:<family>`). */
const CONFIG_NAME = /^(hfs\.json|package\.json|tsconfig[^/]*\.json|eslint\.config\.mjs|stylelint\.config\.mjs|jest\.config\.[cm]?[jt]s|jest\.config\.json|\.prettierrc[^/]*|prettier\.config\.[cm]?[jt]s|\.prettierignore|\.editorconfig|\.gitignore|\.gitattributes|turbo\.json|sonar-project\.properties|codecov\.yml)$/;

/** The families the code of `@starci/hfs` (and the CLI that runs it) computes: a new hfs re-runs these and no other. */
const HFS_RUN: readonly FamilyId[] = ['hfs', 'secrets', 'wiring', 'db'];

/**
 * Each family's toolchain as the lockfile resolves it: the installed packages whose version can change that family's results. The types and test families
 * read every installed package a program or a spec can load (a dependency's type surface or behaviour reaches their results and neither keys its records by
 * the packages it loads), which is every install but the tools of the other families that nothing they load depends on (`TOOL_ONLY`, `reachablePackages`).
 */
const LOCK_TOOLCHAIN: Readonly<Record<'lint' | 'format' | 'types' | 'test', RegExp | null>> = {
  lint: /^(?:eslint|eslint-.+|@eslint\/.+|@eslint-community\/.+|typescript|typescript-eslint|@typescript-eslint\/.+|@stylistic\/.+|stylelint|stylelint-.+|postcss|postcss-.+|globals|jiti|@next\/eslint-plugin-next)$/u,
  format: /^(?:prettier|prettier-plugin-.+|@prettier\/.+)$/u,
  types: null,
  test: null,
};

/**
 * The installed packages that are the tools of another family or of the harness itself: the ESLint and stylelint toolchains and their @starci canons, Prettier and its
 * configuration, `@starci/hfs` and the CLI. A program (`tsc`) or a spec (Jest) loads one of them only when something it loads depends on it, so the types and test
 * families leave the ones no manifest and no resolved dependency reaches out of `lock:types` and `lock:test`, and a bump of such a tool re-runs the families that read it
 * (`pkg:` and `lock:<family>` parts) and no other. `typescript` is no tool of this set: a type check and a transform read it.
 */
const TOOL_ONLY = /^(?:starci-harness|@starci\/(?:hfs|eslint-.+|stylelint-canon|prettier-config)|eslint|eslint-.+|@eslint\/.+|@eslint-community\/.+|typescript-eslint|@typescript-eslint\/.+|@stylistic\/.+|stylelint|stylelint-.+|prettier|prettier-plugin-.+|@prettier\/.+)$/u;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** The @starci packages a family is made of, by name; any other @starci package is a library like any other. */
const STARCI_FAMILIES: Readonly<Record<string, readonly FamilyId[]>> = {
  hfs: HFS_RUN,
  'eslint-canon-be': ['lint', 'sonar'],
  'eslint-canon-fe': ['lint', 'sonar'],
  'eslint-grammar-core': ['lint', 'sonar'],
  'eslint-grammar-offset-pop': ['lint', 'sonar'],
  'stylelint-canon': ['lint', 'sonar'],
  'prettier-config': ['format'],
  tsconfig: ['types', 'lint', 'test', 'sonar'],
  'jest-preset': ['test', 'sonar'],
  'test-world': ['test', 'sonar'],
};

/** The families a configuration file is read by, by base name. */
function familiesOfConfig(base: string): readonly FamilyId[] {
  if (base === 'hfs.json') return [...HFS_RUN, 'lint', 'sonar'];
  if (/^tsconfig/u.test(base)) return ['types', 'lint', 'test', 'sonar'];
  if (base === 'eslint.config.mjs' || base === 'stylelint.config.mjs') return ['lint', 'sonar'];
  if (/^jest\.config/u.test(base)) return ['test', 'sonar'];
  if (/^(?:\.prettier|prettier\.config)/u.test(base) || base === '.editorconfig') return ['format'];
  if (base === 'sonar-project.properties' || base === 'codecov.yml') return [...HFS_RUN, 'sonar'];
  return HFS_RUN;
}

/**
 * The families that read a part. `cache-format` is read by every family; `file:<path>/package.json` (its whole content) by the hfs-run families and
 * `shape:<path>/package.json` (its content with every dependency version blanked: workspaces, type, exports, dependency names) by the others, so a version
 * bump of a dependency reaches them only through its `lock:<family>` part.
 */
export function familiesOfPart(name: string): readonly FamilyId[] {
  if (name === 'cache-format') return FAMILIES;
  if (name === 'cli' || name === 'hfs') return HFS_RUN;
  if (name.startsWith('pkg:@starci/')) return STARCI_FAMILIES[name.slice('pkg:@starci/'.length)] ?? [];
  if (name.startsWith('lock:')) {
    const family = name.slice('lock:'.length);
    return family === 'lint' || family === 'test' ? [family, 'sonar'] : (FAMILIES as readonly string[]).includes(family) ? [family as FamilyId] : [];
  }
  if (name.startsWith('shape:')) return ['lint', 'types', 'test', 'format', 'sonar'];
  if (name.startsWith('file:')) return familiesOfConfig(path.posix.basename(name.slice('file:'.length)));
  return FAMILIES;
}

/** The fingerprint of a run: its parts, and whether it is portable (and if not, why). */
export interface Fingerprint {
  readonly parts: readonly FingerprintPart[];
  readonly portable: boolean;
  readonly localReasons: readonly string[];
}

export interface FingerprintInput {
  readonly root: string;
  readonly tracked: readonly string[];
  /** The version of the CLI that runs this package in-process, when it gave one. */
  readonly cliVersion?: string | undefined;
  /** Where @starci/hfs runs from; defaults to this package. */
  readonly hfsDir?: string | undefined;
}

type LockEntry = { version?: string; integrity?: string; link?: boolean; resolved?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };

const sorted = (parts: FingerprintPart[]): FingerprintPart[] => [...parts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The `packages` of the app's `package-lock.json`, keyed by install path (`node_modules/x`, `fe/node_modules/@s/y`). */
export function lockEntries(root: string): Record<string, LockEntry> {
  const packages = readJson(path.join(root, 'package-lock.json'))?.['packages'];
  return packages !== null && typeof packages === 'object' ? (packages as Record<string, LockEntry>) : {};
}

/** The installed package name of a lock path (`fe/node_modules/@s/y/node_modules/z` is `z`), or null for a workspace entry. */
export function lockPackageName(key: string): string | null {
  const at = key.lastIndexOf('node_modules/');
  return at < 0 ? null : key.slice(at + 'node_modules/'.length);
}

/** Whether a lockfile `resolved` URL names this machine: a registry CI and production cannot reach. */
function resolvedOnThisMachine(resolved: string | undefined): boolean {
  if (resolved === undefined) return false;
  try {
    const host = new URL(resolved).hostname.replace(/^\[|\]$/gu, '');
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
  } catch {
    return false;
  }
}

/** Why an installed `@starci` package has no portable fingerprint (linked, copied, or resolved from a registry on this machine), or null when it is a published install. */
export function localReasonOf(name: string, entry: LockEntry | undefined, linked: boolean): string | null {
  if (resolvedOnThisMachine(entry?.resolved)) return `@starci/${name} is installed from a registry on this machine (starci deps install-local)`;
  if (linked || entry?.integrity === undefined) return `@starci/${name} is linked or copied from a local folder (no recorded integrity)`;
  return null;
}

/** One digest per installed package name: every install of it, by path, version and integrity. */
export function packageDigests(entries: Readonly<Record<string, LockEntry>>): Map<string, string> {
  const installs = new Map<string, string[]>();
  for (const key of Object.keys(entries).sort()) {
    const name = lockPackageName(key);
    if (name === null) continue;
    const entry = entries[key] as LockEntry;
    installs.set(name, [...(installs.get(name) ?? []), `${key}\0${entry.version ?? ''}\0${entry.integrity ?? entry.resolved ?? ''}`]);
  }
  return new Map([...installs].map(([name, lines]) => [name, hashText(lines.join('\n'))]));
}

/** `package.json` with every dependency version blanked: what a family other than the hfs-run ones reads of a manifest. */
function manifestShape(file: string): string {
  const manifest = readJson(file);
  if (manifest === undefined) return 'absent';
  const blank = (value: unknown): unknown => (value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ''])) : value);
  const shape = Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, /^(?:dependencies|devDependencies|peerDependencies|optionalDependencies|version)$/u.test(key) ? blank(manifest[key]) : manifest[key]]));
  return hashText(JSON.stringify(shape));
}

/**
 * The names of the installed packages a program or a spec can load: the dependencies every tracked manifest declares and what their resolved installs depend on, in the lockfile.
 * The root manifest is the harness's own: a tool it declares is not a root of its own (the apps declare them there and nothing else loads them), while a tool a workspace
 * declares is. A manifest that cannot be read, or a lockfile without installs, gives null: nothing is left out.
 */
export function reachablePackages(root: string, tracked: readonly string[], entries: Readonly<Record<string, LockEntry>>): Set<string> | null {
  const byName = new Map<string, string[]>();
  for (const key of Object.keys(entries)) {
    const name = lockPackageName(key);
    if (name !== null) byName.set(name, [...(byName.get(name) ?? []), key]);
  }
  if (byName.size === 0) return null;
  const reached = new Set<string>();
  const queue: string[] = [];
  const reach = (name: string): void => { if (!reached.has(name)) { reached.add(name); queue.push(name); } };
  const declared = (manifest: Record<string, unknown> | undefined): string[] => DEPENDENCY_FIELDS.flatMap((field) => {
    const value = manifest?.[field];
    return value !== null && typeof value === 'object' ? Object.keys(value) : [];
  });
  for (const file of tracked) {
    if (path.posix.basename(file) !== 'package.json' || file.startsWith('node_modules/') || file.includes('/node_modules/')) continue;
    const manifest = readJson(path.join(root, file));
    if (manifest === undefined) return null;
    for (const name of declared(manifest)) if (file !== 'package.json' || !TOOL_ONLY.test(name)) reach(name);
  }
  const dependenciesOf = (key: string): string[] => {
    const entry = entries[key];
    if (entry === undefined) return [];
    const own = DEPENDENCY_FIELDS.filter((field) => field !== 'devDependencies').flatMap((field) => {
      const value = entry[field];
      return value !== null && typeof value === 'object' ? Object.keys(value) : [];
    });
    return entry.link === true && typeof entry.resolved === 'string' && entry.resolved !== key ? [...own, ...dependenciesOf(entry.resolved)] : own;
  };
  while (queue.length > 0) for (const key of byName.get(queue.pop() as string) ?? []) for (const name of dependenciesOf(key)) reach(name);
  return reached;
}

function installedStarci(root: string): string[] {
  try {
    return fs.readdirSync(path.join(root, 'node_modules', '@starci'));
  } catch {
    return [];
  }
}

/** Whether the directory sits in an install (a `node_modules` segment of its real path) rather than a local checkout. */
function installedUnderNodeModules(dir: string): boolean {
  let real = dir;
  try { real = fs.realpathSync(dir); } catch { /* an unreadable directory is judged by its given path */ }
  return real.split(/[\\/]/).includes('node_modules');
}

/** The fingerprint of the app at `root`. */
export function computeFingerprint({ root, tracked, cliVersion, hfsDir = fileURLToPath(new URL('..', import.meta.url)) }: FingerprintInput): Fingerprint {
  const parts: FingerprintPart[] = [];
  const localReasons: string[] = [];
  const add = (name: string, value: string): void => void parts.push({ name, sha256: hashText(value) });
  add('cache-format', String(CACHE_FORMAT_VERSION));
  add('cli', cliVersion ?? 'none');
  const hfsVersion = String(readJson(path.join(hfsDir, 'package.json'))?.['version'] ?? 'unknown');
  add('hfs', hfsVersion);
  if (!installedUnderNodeModules(hfsDir)) localReasons.push(`@starci/hfs runs from a local folder (${path.basename(path.resolve(hfsDir))})`);
  const lock = lockEntries(root);
  for (const name of installedStarci(root).sort()) {
    const dir = path.join(root, 'node_modules', '@starci', name);
    const version = String(readJson(path.join(dir, 'package.json'))?.['version'] ?? 'unknown');
    const entry = lock[`node_modules/@starci/${name}`];
    let linked = entry?.link === true;
    try { linked = linked || fs.lstatSync(dir).isSymbolicLink(); } catch { /* absent: not installed */ }
    const reason = localReasonOf(name, entry, linked);
    if (reason !== null) localReasons.push(reason);
    add(`pkg:@starci/${name}`, `${version}\0${entry?.integrity ?? 'local'}`);
  }
  const digests = packageDigests(lock);
  const reached = reachablePackages(root, tracked, lock);
  for (const [family, toolchain] of Object.entries(LOCK_TOOLCHAIN)) {
    const lines = [...digests].filter(([name]) => (toolchain === null ? reached === null || !TOOL_ONLY.test(name) || reached.has(name) : toolchain.test(name))).map(([name, digest]) => `${name}\0${digest}`);
    add(`lock:${family}`, lines.join('\n'));
  }
  for (const file of tracked) {
    const base = path.posix.basename(file);
    if (!CONFIG_NAME.test(base) || file.startsWith('node_modules/')) continue;
    const absolute = path.join(root, file);
    parts.push({ name: `file:${file}`, sha256: hashFile(absolute) ?? 'absent' });
    if (base === 'package.json') parts.push({ name: `shape:${file}`, sha256: manifestShape(absolute) });
  }
  return { parts: sorted(parts), portable: localReasons.length === 0, localReasons };
}

/** `fingerprint.jsonl`: one line per part. */
export function serializeFingerprint(parts: readonly FingerprintPart[]): string {
  const lines = sorted([...parts]).map((part) => JSON.stringify({ name: part.name, sha256: part.sha256 }));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** The parts of a `fingerprint.jsonl`; a line that is not a part is dropped. */
export function parseFingerprint(text: string): FingerprintPart[] {
  const parts: FingerprintPart[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    try {
      const value = JSON.parse(line) as { name?: unknown; sha256?: unknown };
      if (typeof value.name === 'string' && typeof value.sha256 === 'string') parts.push({ name: value.name, sha256: value.sha256 });
    } catch { /* a damaged line is a part that cannot match */ }
  }
  return sorted(parts);
}

/**
 * The part names that differ between the cache's fingerprint and this run's: changed, added, removed, and a name held twice with
 * two digests (a union merge of two branches), which never matches.
 */
export function fingerprintDifferences(cached: readonly FingerprintPart[], current: readonly FingerprintPart[]): string[] {
  const differing = new Set<string>();
  const byName = new Map<string, Set<string>>();
  for (const part of cached) byName.set(part.name, (byName.get(part.name) ?? new Set()).add(part.sha256));
  for (const part of current) {
    const held = byName.get(part.name);
    if (held === undefined || held.size !== 1 || !held.has(part.sha256)) differing.add(part.name);
  }
  const names = new Set(current.map((part) => part.name));
  for (const name of byName.keys()) if (!names.has(name)) differing.add(name);
  return [...differing].sort();
}

/** The differing parts each family reads: a family absent from the map has a matching fingerprint. */
export function differencesByFamily(differences: readonly string[]): Map<FamilyId, string[]> {
  const byFamily = new Map<FamilyId, string[]>();
  for (const name of differences) for (const family of familiesOfPart(name)) byFamily.set(family, [...(byFamily.get(family) ?? []), name]);
  return byFamily;
}

/** The family whose records a cache folder holds (`check/<family>`, `lint/<side>`, `test-coverage`, the Sonar and Codecov baselines). */
export function familyOfFolder(folder: string): FamilyId | null {
  const [head, second] = folder.split('/');
  if (head === 'check') return (FAMILIES as readonly string[]).includes(second ?? '') ? (second as FamilyId) : null;
  if (head === 'lint') return 'lint';
  if (head === 'test-coverage') return 'test';
  if (head === 'sonar-baseline' || head === 'codecov-baseline') return 'sonar';
  return null;
}

/** One digest of all parts, for the run log. */
export function fingerprintDigest(parts: readonly FingerprintPart[]): string {
  return combineHashes(Object.fromEntries(parts.map((part) => [part.name, part.sha256])));
}

// fingerprint.mts - the one fingerprint check, lint and coverage share. A part is anything a step reads that is not an app source; any part
// that differs makes the whole run full. Parts are portable (equal on every host for one commit): the cache format, the CLI and
// @starci/hfs that run, every installed @starci package by version and recorded integrity, the lockfile and the configuration files by
// normalised content. A run whose CLI or any @starci package is linked or copied from a local folder has no portable fingerprint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { CACHE_FORMAT_VERSION, type FingerprintPart } from './types.mjs';

/** The tracked files (by base name or exact path) that are parts by content. */
const CONFIG_NAME = /^(hfs\.json|package\.json|tsconfig[^/]*\.json|eslint\.config\.mjs|stylelint\.config\.mjs|jest\.config\.[cm]?[jt]s|jest\.config\.json|\.prettierrc[^/]*|prettier\.config\.[cm]?[jt]s|\.prettierignore|\.editorconfig|\.gitignore|\.gitattributes|turbo\.json|sonar-project\.properties|codecov\.yml|package-lock\.json)$/;

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

const sorted = (parts: FingerprintPart[]): FingerprintPart[] => [...parts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function lockEntries(root: string): Record<string, { integrity?: string; link?: boolean; resolved?: string }> {
  const packages = readJson(path.join(root, 'package-lock.json'))?.['packages'];
  return packages !== null && typeof packages === 'object' ? (packages as Record<string, { integrity?: string; link?: boolean; resolved?: string }>) : {};
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
    if (linked || entry?.integrity === undefined) localReasons.push(`@starci/${name} is linked or copied from a local folder (no recorded integrity)`);
    add(`pkg:@starci/${name}`, `${version}\0${entry?.integrity ?? 'local'}`);
  }
  for (const file of tracked) {
    if (!CONFIG_NAME.test(path.posix.basename(file)) || file.startsWith('node_modules/')) continue;
    const sha = hashFile(path.join(root, file));
    parts.push({ name: `file:${file}`, sha256: sha ?? 'absent' });
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

/** One digest of all parts, for the run log. */
export function fingerprintDigest(parts: readonly FingerprintPart[]): string {
  return combineHashes(Object.fromEntries(parts.map((part) => [part.name, part.sha256])));
}

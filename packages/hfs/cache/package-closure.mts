// package-closure.mts - what a tool read to produce one cached result, beyond the files its own key already holds: the installed packages it loaded and the
// app files outside that key (contexts/project/check-cache.md "Which step reuses what"). A record that carries its reads is reused only while each package has the
// installs the lockfile resolved when it ran and each file its hash, so a package bump re-runs the results that loaded the package and no other. A tool that
// reports what it loaded (Jest's runtime, `tsc --listFiles`, the boot proof's module cache) gives the reads; one that resolves from the lockfile (a CI build,
// the database step) takes the lockfile closure of the manifests it builds from.
import fs from 'node:fs';
import path from 'node:path';
import { lockEntries, lockPackageName, packageDigests } from './fingerprint.mjs';
import { combineHashes, hashFile } from './hash.mjs';
import type { CheckSession, JsonValue } from './types.mjs';

/** What a result read: installed packages by install path (`node_modules/x`, `be/node_modules/@s/y`) and app files, app-relative posix, sorted. */
export interface ToolReads {
  readonly packages: readonly string[];
  readonly files: readonly string[];
}

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
const posix = (file: string): string => file.split(path.sep).join('/');

/** The install path of the package a path lies in (its last `node_modules/<name>` or `node_modules/@scope/name`), or null for a path outside `node_modules`. */
export function installOf(relative: string): string | null {
  const parts = relative.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return null;
  return parts.slice(0, at + ((parts[at + 1] ?? '').startsWith('@') ? 3 : 2)).join('/');
}

/**
 * The reads of a tool from the absolute paths it reported: each path under `node_modules` stands for its package's install, any other path inside the app for
 * itself unless `covered` (the files the result's own key already holds). A path outside the app is the harness's own code or a linked package, which the
 * fingerprint covers (a linked `@starci` package has no portable fingerprint).
 */
export function readsOfPaths(root: string, paths: Iterable<string>, covered: (file: string) => boolean = () => false): ToolReads {
  const packages = new Set<string>();
  const files = new Set<string>();
  for (const absolute of paths) {
    const relative = posix(path.relative(root, path.resolve(root, absolute)));
    if (relative === '' || relative.startsWith('../') || path.isAbsolute(relative)) continue;
    const install = installOf(relative);
    if (install !== null) packages.add(install);
    else if (!covered(relative)) files.add(relative);
  }
  return { packages: [...packages].sort(), files: [...files].sort() };
}

/** The reads a record carries in `data.reads`, or null when it carries none (a record no reads were taken for is never reused). */
export function readsOfData(data: JsonValue | undefined): ToolReads | null {
  const reads = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as { readonly [key: string]: JsonValue })['reads'] : undefined;
  if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) return null;
  const { packages, files } = reads as { readonly [key: string]: JsonValue };
  const list = (value: JsonValue | undefined): string[] | null => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null);
  const p = list(packages);
  const f = list(files);
  return p === null || f === null ? null : { packages: p, files: f };
}

/** How the reads of a record are judged now: the lockfile digest of each installed package name and the hash of each app file. */
export interface ReadsContext {
  /** The digest of every install of the package `name` as the lockfile resolves it; an unlocked install stands for the version its manifest on disk names. */
  packageDigest(install: string): string;
  hashOf(file: string): string;
}

/** The reads context of the app at `root`: the lockfile it holds now, and the content index (then the work tree) for files. */
export function readsContext(root: string, hashOf: (file: string) => string | undefined): ReadsContext {
  const digests = packageDigests(lockEntries(root));
  const onDisk = (install: string): string => {
    try {
      return `unlocked:${String((JSON.parse(fs.readFileSync(path.join(root, install, 'package.json'), 'utf8')) as { version?: unknown }).version ?? 'none')}`;
    } catch {
      return 'absent';
    }
  };
  return {
    packageDigest: (install) => digests.get(lockPackageName(install) ?? install) ?? onDisk(install),
    hashOf: (file) => hashOf(file) ?? hashFile(path.join(root, file)) ?? 'absent',
  };
}

/** The reads context of a session: its root's lockfile and its content index. */
export function sessionReadsContext(session: CheckSession): ReadsContext {
  return readsContext(session.root, (file) => session.index.hashOf(file));
}

/** The key of a result: the key of what it read by its own key (`base`), every package of its reads by its lockfile digest and every file by its hash. */
export function keyWithReads(base: string, reads: ToolReads, context: ReadsContext): string {
  const parts: Record<string, string> = { '#base': base };
  for (const install of reads.packages) parts[`package:${install}`] = context.packageDigest(install);
  for (const file of reads.files) parts[`file:${file}`] = context.hashOf(file);
  return combineHashes(parts);
}

/** `reads` as the JSON a record stores. */
export const readsJson = (reads: ToolReads): JsonValue => ({ packages: [...reads.packages], files: [...reads.files] });

/**
 * The installs a build resolves from `manifests` (app-relative `package.json` paths): every dependency, dev dependency included, each manifest declares, and
 * what their installs depend on, transitively, as the lockfile records them; a linked workspace install follows its target's entry. Install paths, sorted.
 */
export function lockClosure(root: string, manifests: readonly string[]): string[] {
  const names: string[] = [];
  for (const file of manifests) {
    let manifest: Record<string, unknown> = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Record<string, unknown>; } catch { /* a manifest that cannot be read declares nothing */ }
    for (const field of [...DEPENDENCY_FIELDS, 'devDependencies'] as const) {
      const value = manifest[field];
      if (value !== null && typeof value === 'object') names.push(...Object.keys(value));
    }
  }
  return lockClosureOf(root, names);
}

/** The installs of the packages `names` and of what they depend on, transitively, as the lockfile records them (a linked workspace follows its target). Install paths, sorted. */
export function lockClosureOf(root: string, names: readonly string[]): string[] {
  const entries = lockEntries(root);
  const byName = new Map<string, string[]>();
  for (const key of Object.keys(entries)) {
    const name = lockPackageName(key);
    if (name !== null) byName.set(name, [...(byName.get(name) ?? []), key]);
  }
  const reached = new Set<string>();
  const installs = new Set<string>();
  const queue: string[] = [];
  const reach = (name: string): void => { if (!reached.has(name)) { reached.add(name); queue.push(name); } };
  for (const name of names) reach(name);
  const dependenciesOf = (key: string, seen: Set<string> = new Set()): string[] => {
    const entry = entries[key];
    if (entry === undefined || seen.has(key)) return [];
    seen.add(key);
    const own = DEPENDENCY_FIELDS.flatMap((field) => {
      const value = entry[field];
      return value !== null && typeof value === 'object' ? Object.keys(value) : [];
    });
    return entry.link === true && typeof entry.resolved === 'string' ? [...own, ...dependenciesOf(entry.resolved, seen)] : own;
  };
  while (queue.length > 0) {
    for (const key of byName.get(queue.pop() as string) ?? []) {
      installs.add(key);
      for (const name of dependenciesOf(key)) reach(name);
    }
  }
  return [...installs].sort();
}

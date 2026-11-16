// data-copies.mts - R400: data lives in seed copies, never in code (contexts/project/stacks.md PROJECT-STACKS-13). One judgement, two gates:
//   - the hfs check of `starci app check`, at the root of an app (a code project): dataBoundaryFindings over the tracked tree;
//   - the commit hook's hygiene guard (`starci app check --staged`, sync/hygiene.mts) over any repository: a COPY REPOSITORY is judged by
//     dataCopyFindings, any other repository by dataInCodeFindings.
// A copy repository is a repository whose root holds no hfs.json and whose root manifest.json carries `schema: "starci/data-manifest@1"`:
// the manifest the driver wrote is the declaration, so no second file states it. A code project (hfs.json) is never one, whatever it tracks.
//   in a code project:
//   HFS_DATA_IN_CODE         a tracked copy manifest, a tracked file of the data/ blobs/ index/ tree next to one, or a sops binary-mode
//                            envelope (`*.sops.json` with a `data` member): copy documents live in the copy repository only;
//   HFS_DATA_DEPENDENCY      package.json (dependencies of every kind, workspaces), .gitmodules, tsconfig/jsconfig name a repository that
//                            ends -seed-standard or -seed-backup-<env>;
//   in a copy repository:
//   HFS_DATA_UNSEALED        a seed-backup's file under data/ blobs/ index/ is no `*.sops.json` sops envelope;
//   HFS_DATA_STANDARD_SEALED a seed-standard holds a sops envelope or an `*.sops.json` / `*.enc.yaml` file, or its manifest says sealing;
//   HFS_DATA_MANIFEST_DRIFT  the manifest's `files` keys and the tracked data files disagree (sealed names carry `.sops.json` when the
//                            sealing is sops-age), or its purpose and its format name (`<name>-seed-standard@N`,
//                            `<name>-seed-backup-<env>@N`) disagree;
//   HFS_DATA_FILE_SIZE       a data file, or a file of raw/ (what people author in a standard with an adapter, R434), over 4 MiB;
//   HFS_DATA_CAP             the data files and raw/ together over 500 MiB: the data set has outgrown git and needs the s3 driver.
// raw/ is judged like the data files for sealing (a standard holds no sealed file anywhere), for size and for the manifest, whose files index
// names data files only; data-adapter.mts (R434) judges that the outputs are the adapter's.
// Findings name files, fields and counts, never a value; keys of a document are read, no value beyond them.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { isSopsEnvelope } from '../../lib/sops-envelope.mjs';
import { found } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

// The limits below are owned by `@starci/seed` src/words.ts (GIT_CAP_BYTES, GIT_SHARD_BYTES); @starci/hfs does not depend on
// @starci/seed, so the numbers are copied, and a spec pins them to the law (4 MiB per file, 500 MiB per snapshot).
/** The whole snapshot one git copy may hold: 500 MiB. */
export const GIT_CAP_BYTES = 524_288_000;
/** The largest data file of a git copy: 4 MiB. */
export const GIT_SHARD_BYTES = 4_194_304;

/** The schema of a copy repository's root manifest. */
export const DATA_MANIFEST_SCHEMA = 'starci/data-manifest@1';
/** The manifest at a copy repository's root. */
export const DATA_MANIFEST = 'manifest.json';
/** The folder a seed-standard keeps its authored material in, beside an adapter/ (R434): sized and capped like the data files, never listed by the manifest. */
export const RAW_TREE = 'raw/';
/** The trees of a copy repository that hold data files. */
export const DATA_TREES = ['data/', 'blobs/', 'index/'] as const;
/** The suffix of a sealed data file (sops binary mode). */
export const SEALED_SUFFIX = '.sops.json';
/** A copy repository's format: `<name>-seed-standard@N` (group 1 set) or `<name>-seed-backup-<env>@N` (group 2 the environment). */
const FORMAT = /^[a-z0-9][a-z0-9._-]*?(?:-seed-(standard)|-seed-backup-([a-z0-9][a-z0-9-]*))@[1-9]\d*$/u;
/** A repository named by a dependency: ends -seed-standard or -seed-backup-<env> as a whole name. */
const COPY_NAME = /(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9._-]*-seed-(?:standard|backup-[a-z0-9][a-z0-9-]*)(?![A-Za-z0-9_-])/u;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies', 'workspaces'];
/** A tracked JSON is read whole up to this size for the manifest judgement. */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const parse = (text: string | null): Parsed => {
  if (text === null) return undefined;
  try { return JSON.parse(text.replace(/^﻿/u, '')); } catch { return undefined; }
};

/** The manifest object when `doc` is a copy manifest (schema starci/data-manifest@1), else null. */
export const copyManifestOf = (doc: Parsed): Record<string, Parsed> | null => (plain(doc) && doc.schema === DATA_MANIFEST_SCHEMA ? doc as Record<string, Parsed> : null);

/** The purpose a format name states (`seed-standard`, `seed-backup`) and the environment of a backup's name; null when it is neither. */
export function formatPurpose(format: unknown): { purpose: 'seed-standard' | 'seed-backup'; environment: string | null } | null {
  const match = typeof format === 'string' ? FORMAT.exec(format) : null;
  if (match === null) return null;
  return match[1] ? { purpose: 'seed-standard', environment: null } : { purpose: 'seed-backup', environment: match[2] as string };
}

/** The manifest a copy repository's root declares, from the texts of its root manifest.json and hfs.json (null: absent); null when it is no copy repository. */
export const copyRepositoryDeclared = (manifestText: string | null, hfsText: string | null): Record<string, Parsed> | null => (hfsText === null ? copyManifestOf(parse(manifestText)) : null);

const isDataFile = (file: string): boolean => DATA_TREES.some((tree) => file.startsWith(tree));
/** A file the size limits count: a data file, or a file of raw/. */
const isSizedFile = (file: string): boolean => isDataFile(file) || file.startsWith(RAW_TREE);

/** What a parsed document of a copy is when it is tracked in a code project: a manifest, or a sops binary-mode envelope (`data` member); null for any other document. */
function copyDocumentKind(file: string, doc: Parsed, text: string): string | null {
  if (copyManifestOf(doc) !== null) return 'data manifest';
  if (file.endsWith(SEALED_SUFFIX) && plain(doc) && Object.hasOwn(doc, 'data') && Object.hasOwn(doc, 'sops') && isSopsEnvelope(text)) return 'sealed copy file';
  return null;
}

/** HFS_DATA_IN_CODE for one file of a code project, from its text (null: unreadable, judged as nothing). */
export function dataInCodeFindings(file: string, text: string | null): Finding[] {
  if (!file.endsWith('.json') || text === null) return [];
  const kind = copyDocumentKind(file, parse(text), text);
  return kind === null ? [] : [found('HFS_DATA_IN_CODE', file, `${file} is a ${kind} of a seed copy; data lives in git only in a copy repository (<name>-seed-standard, <name>-seed-backup-<env>): move it there and remove it from this project (PROJECT-STACKS-13)`, { kind })];
}

/** HFS_DATA_IN_CODE for the data/ blobs/ index/ trees next to a tracked manifest: `manifests` are the tracked manifest paths, `all` the tracked tree. One finding per tree. */
export function dataTreeInCodeFindings(manifests: readonly string[], all: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const manifest of manifests) {
    const base = path.posix.dirname(manifest) === '.' ? '' : `${path.posix.dirname(manifest)}/`;
    for (const tree of DATA_TREES) {
      const held = all.filter((file) => file.startsWith(`${base}${tree}`));
      if (held.length) findings.push(found('HFS_DATA_IN_CODE', `${base}${tree}`, `${base}${tree} holds ${String(held.length)} copy file(s) next to the data manifest ${manifest}; data lives in git only in a copy repository: move the tree there and remove it from this project (PROJECT-STACKS-13)`, { kind: 'copy tree', files: held.length }));
    }
  }
  return findings;
}

/** True for the files through which a code project could depend on another repository: package.json, .gitmodules, tsconfig/jsconfig. */
export const isDependencyFile = (file: string): boolean => /(?:^|\/)(?:package\.json|\.gitmodules|[tj]sconfig(?:\.[^/]*)?\.json)$/u.test(file);

/** HFS_DATA_DEPENDENCY for one dependency file of a code project. */
export function dataDependencyFindings(file: string, text: string | null): Finding[] {
  if (text === null || !isDependencyFile(file) || !text.includes('-seed-')) return [];
  const at = (where: string, repository: string) => [found('HFS_DATA_DEPENDENCY', file, `${file} names the copy repository ${repository} in ${where}; a code project never depends on a seed copy (no dependency, submodule, workspace or path into one): its data enters through the bring-up's seed step or an explicit sync (PROJECT-STACKS-13)`, { repository })];
  if (!file.endsWith('package.json')) {
    const name = COPY_NAME.exec(text)?.[0];
    return name === undefined ? [] : at(file.endsWith('.gitmodules') ? 'a submodule' : 'a path', name);
  }
  const doc = parse(text);
  if (!plain(doc)) return [];
  for (const field of DEPENDENCY_FIELDS) {
    const name = doc[field] === undefined ? undefined : COPY_NAME.exec(JSON.stringify(doc[field]))?.[0];
    if (name !== undefined) return at(field, name);
  }
  return [];
}

/** The text of a tracked JSON or .gitmodules file, whole up to 8 MiB; null when it is absent or larger. */
function jsonTextOf(repoRoot: string, file: string): string | null {
  try {
    const target = path.join(repoRoot, file);
    return fs.statSync(target).size > MAX_JSON_BYTES ? null : fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

/** Findings of R400 at the app root of an app (a code project): copy documents and trees, dependencies on a copy repository. */
export function dataBoundaryFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const findings: Finding[] = [];
  const manifests: string[] = [];
  for (const file of all) {
    if (!file.endsWith('.json') && !file.endsWith('.gitmodules')) continue;
    const text = jsonTextOf(repoRoot, file);
    if (file.endsWith('.json') && copyManifestOf(parse(text)) !== null) manifests.push(file);
    findings.push(...dataInCodeFindings(file, text), ...dataDependencyFindings(file, text));
  }
  return [...findings, ...dataTreeInCodeFindings(manifests, all)];
}

/** The reads a copy repository's judgement makes: the tracked paths, a file's text (null: absent, binary or too large) and its byte size (null: unknown). */
export interface CopyReader { files: readonly string[]; read: (file: string) => string | null; sizeOf: (file: string) => number | null }

const drift = (message: string, file = DATA_MANIFEST): Finding => found('HFS_DATA_MANIFEST_DRIFT', file, `${message} (PROJECT-STACKS-13)`);

/** HFS_DATA_MANIFEST_DRIFT: the purpose against the format name and the sealing, the `files` keys against the tracked data files. */
function driftFindings(manifest: Record<string, Parsed>, files: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const named = formatPurpose(manifest.format);
  if (named === null) out.push(drift(`${DATA_MANIFEST} format ${JSON.stringify(manifest.format ?? null)} is neither <name>-seed-standard@<major> nor <name>-seed-backup-<env>@<major>`));
  else if (manifest.purpose !== named.purpose) out.push(drift(`${DATA_MANIFEST} purpose ${JSON.stringify(manifest.purpose ?? null)} disagrees with its format name ${String(manifest.format)}, which states ${named.purpose}`));
  else if (named.environment !== null && plain(manifest.source) && typeof manifest.source.environment === 'string' && manifest.source.environment !== named.environment)
    out.push(drift(`${DATA_MANIFEST} format ${String(manifest.format)} names the environment ${named.environment}, but source.environment is ${manifest.source.environment}`));
  if (manifest.purpose === 'seed-backup' && manifest.sealing !== 'sops-age') out.push(drift(`${DATA_MANIFEST} sealing is ${JSON.stringify(manifest.sealing ?? null)}; a seed-backup is always sops-age`));
  if (!plain(manifest.files)) return [...out, drift(`${DATA_MANIFEST} has no files index (an object keyed by the plain data file name)`)];
  const suffix = manifest.sealing === 'sops-age' ? SEALED_SUFFIX : '';
  for (const key of Object.keys(manifest.files)) if (!isDataFile(key)) out.push(drift(`${DATA_MANIFEST} lists ${key}, which is no data file: its files index names files of data/, blobs/ and index/ only (raw/ is authored material, never an output)`));
  const expected = new Set(Object.keys(manifest.files).filter(isDataFile).map((key) => `${key}${suffix}`));
  const tracked = new Set(files.filter(isDataFile));
  for (const name of expected) if (!tracked.has(name)) out.push(drift(`${DATA_MANIFEST} lists ${name}, which is not tracked`));
  for (const name of tracked) if (!expected.has(name)) out.push(drift(`${name} is tracked but ${DATA_MANIFEST} does not list it`, name));
  return out;
}

/** True for a file that is a sops envelope by name (`*.sops.json`, `*.enc.yaml`). */
const sealedByName = (file: string): boolean => file.endsWith(SEALED_SUFFIX) || file.endsWith('.enc.yaml');
const MAYBE_ENVELOPE = /\.(?:json|ya?ml|env)$/u;

/**
 * Findings of R400 in a copy repository whose manifest is `manifestText`: sealing by purpose (HFS_DATA_UNSEALED, HFS_DATA_STANDARD_SEALED),
 * the manifest against the tracked data files (HFS_DATA_MANIFEST_DRIFT), the size of a file (HFS_DATA_FILE_SIZE) and of the whole snapshot
 * (HFS_DATA_CAP).
 */
export function dataCopyFindings({ manifestText, files, read, sizeOf }: { manifestText: string | null } & CopyReader): Finding[] {
  const manifest = copyManifestOf(parse(manifestText));
  if (manifest === null) return [found('HFS_DATA_MANIFEST_DRIFT', DATA_MANIFEST, `${DATA_MANIFEST} is no copy manifest: it carries schema "${DATA_MANIFEST_SCHEMA}" (PROJECT-STACKS-13)`)];
  const findings = driftFindings(manifest, files);
  const dataFiles = files.filter(isDataFile);
  if (manifest.purpose === 'seed-backup') {
    for (const file of dataFiles) {
      const text = read(file);
      if (!file.endsWith(SEALED_SUFFIX) || text === null || !isSopsEnvelope(text))
        findings.push(found('HFS_DATA_UNSEALED', file, `${file} is not sealed: every file under data/, blobs/ and index/ of a seed-backup is a ${SEALED_SUFFIX} sops envelope (binary mode, age) to the environment's recipients; seal it with the driver before the commit (PROJECT-STACKS-13)`));
    }
  } else if (manifest.purpose === 'seed-standard') {
    if (manifest.sealing !== undefined && manifest.sealing !== 'none') findings.push(found('HFS_DATA_STANDARD_SEALED', DATA_MANIFEST, `${DATA_MANIFEST} says sealing ${JSON.stringify(manifest.sealing)}; a seed-standard is plain and holds no secret (PROJECT-STACKS-13)`));
    for (const file of files) {
      if (sealedByName(file) || (MAYBE_ENVELOPE.test(file) && file !== DATA_MANIFEST && isSopsEnvelope(read(file))))
        findings.push(found('HFS_DATA_STANDARD_SEALED', file, `${file} is sealed; a seed-standard is plain, readable and diffable, and holds no secret: a credential stays in the project's stack custody (PROJECT-STACKS-13)`));
    }
  }
  let total = 0;
  for (const file of files.filter(isSizedFile)) {
    const size = sizeOf(file) ?? 0;
    total += size;
    if (size > GIT_SHARD_BYTES) findings.push(found('HFS_DATA_FILE_SIZE', file, `${file} is ${String(size)} bytes; no data file or raw/ file of a git copy exceeds ${String(GIT_SHARD_BYTES)} bytes (4 MiB): write it in smaller shards or chunks, or split the authored file (PROJECT-STACKS-13)`, { bytes: size }));
  }
  if (total > GIT_CAP_BYTES) findings.push(found('HFS_DATA_CAP', DATA_MANIFEST, `the data files and raw/ of this copy hold ${String(total)} bytes, over the ${String(GIT_CAP_BYTES)} bytes (500 MiB) a git copy may hold: the data set has outgrown git, declare the s3 driver for it (PROJECT-STACKS-13, PROJECT-STACKS-14)`, { bytes: total }));
  return findings;
}

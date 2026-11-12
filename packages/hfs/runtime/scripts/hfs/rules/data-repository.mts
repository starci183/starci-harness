// data-repository.mts - R400: a project's business data lives in git only in its data repository, `<project>-data`, sealed with sops
// (contexts/project/stacks.md PROJECT-STACKS-13). One judgement, two gates:
//   - the hfs check of `starci app check`, at the root of an app (a code project): dataBoundaryFindings over the tracked tree;
//   - the commit hook's hygiene guard (`starci app check --staged`, sync/hygiene.mts) over the staged files of any repository: a data
//     repository is judged by dataRepositoryFindings, any other repository by dataInCodeFindings.
// A repository is a data repository when its root holds no hfs.json and its root manifest.json names the data format, `format:
// "<name>-data@<major>"` with a `files` list: the manifest the restore reads is the declaration, so no second file states it. A code
// project (hfs.json) is never one, whatever it tracks.
//   HFS_DATA_IN_CODE         a code project tracks a document of the data format: a data manifest, a record file in plaintext (top level
//                            `schema: "<name>-data/<entity>@<major>"` and `items: [...]`) or a sealed record file (a sops block and `items`);
//   HFS_DATA_DEPENDENCY      a code project depends on its data repository's content: package.json (dependencies of every kind,
//                            workspaces), .gitmodules, or a tsconfig/jsconfig names `<project>-data`;
//   STACKS_DATA_REPOSITORY   application-stacks.yaml `data` names another repository than `<project>-data`, or does not say it is private;
//   HFS_DATA_UNSEALED        a file under data/ of a data repository is no sops envelope (binary, not JSON, no sops block, a plaintext value);
//   HFS_DATA_MANIFEST_DRIFT  the data manifest and data/ disagree: a file listed but not tracked or tracked but not listed, a count that is
//                            not the sealed file's number of items, a sha256 that is no digest, a schema id outside the format.
// The sha256 of an entry is over the canonical plaintext, so only the data repository's own verify (with the identity) can match it; the
// harness proves its shape. A finding names files, fields and counts, never a value.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { isSopsEnvelope } from '../../lib/sops-envelope.mjs';
import { found } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

/** The suffix of a data repository's name: the repository of project `<project>` is `<project>-data`. */
export const DATA_REPOSITORY_SUFFIX = '-data';
/** The data repository of project `project`. */
export const dataRepositoryOf = (project: string): string => `${project}${DATA_REPOSITORY_SUFFIX}`;
/** The manifest at a data repository's root. */
export const DATA_MANIFEST = 'manifest.json';
/** The folder of a data repository that holds its sealed record files. */
export const DATA_FOLDER = 'data/';
/** A data format id, `<name>-data@<major>`; group 1 is the repository name. */
const FORMAT = /^([a-z0-9][a-z0-9._-]*-data)@[1-9]\d*$/u;
/** A record file's schema id, `<name>-data/<entity>@<major>`. */
const SCHEMA_ID = /^[a-z0-9][a-z0-9._-]*-data\/[a-z0-9][a-z0-9._-]*@[1-9]\d*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
/** A tracked JSON is read whole up to this size for the record-file judgement (a record dump outgrows the 1 MiB budget of rules/read.mts). */
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const STACK_FILE = '.starcistacks/application-stacks.yaml';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies', 'workspaces'];

const parse = (text: string | null): Parsed => {
  if (text === null) return undefined;
  try { return JSON.parse(text.replace(/^﻿/u, '')); } catch { return undefined; }
};

/** The repository a data manifest names (its `format`), or null when `doc` is no data manifest. */
export const dataManifestRepository = (doc: Parsed): string | null => (plain(doc) && typeof doc.format === 'string' && Array.isArray(doc.files) ? FORMAT.exec(doc.format)?.[1] ?? null : null);

/** What a parsed JSON document of the data format is: its manifest, a record file in plaintext or sealed; null for any other document. */
export function dataDocumentKind(doc: Parsed): 'data manifest' | 'plaintext record file' | 'sealed record file' | null {
  if (!plain(doc)) return null;
  if (dataManifestRepository(doc) !== null) return 'data manifest';
  if (!Array.isArray(doc.items)) return null;
  if (typeof doc.schema === 'string' && SCHEMA_ID.test(doc.schema)) return 'plaintext record file';
  return plain(doc.sops) && typeof doc.sops.mac === 'string' ? 'sealed record file' : null;
}

/** HFS_DATA_IN_CODE for one file of a code project, from its text (null: unreadable, judged as nothing). */
export function dataInCodeFindings(file: string, text: string | null): Finding[] {
  if (!file.endsWith('.json') || text === null) return [];
  const kind = dataDocumentKind(parse(text));
  return kind === null ? [] : [found('HFS_DATA_IN_CODE', file, `${file} is a ${kind} of a data repository; business data lives in git only in the private <project>-data repository, sealed with sops: move it there and remove it from this project (PROJECT-STACKS-13)`, { kind })];
}

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** True when `text` names `repository` as a whole name (a path segment, a package name, a git URL), not as part of a longer one. */
const names = (text: string, repository: string): boolean => new RegExp(`(?<![A-Za-z0-9._-])${escaped(repository)}(?![A-Za-z0-9_-])`, 'u').test(text);

/** True for the files through which a code project could depend on another repository: package.json, .gitmodules, tsconfig/jsconfig. */
export const isDependencyFile = (file: string): boolean => /(?:^|\/)(?:package\.json|\.gitmodules|[tj]sconfig(?:\.[^/]*)?\.json)$/u.test(file);

/** HFS_DATA_DEPENDENCY for one dependency file of a code project whose data repository is `repository`. */
export function dataDependencyFindings(file: string, text: string | null, repository: string): Finding[] {
  if (text === null || !isDependencyFile(file) || !text.includes(repository)) return [];
  const at = (where: string) => [found('HFS_DATA_DEPENDENCY', file, `${file} names the data repository ${repository} in ${where}; a code project never depends on its data repository's content (no dependency, submodule, workspace or path into it): its data enters through the app's own import of a restored snapshot (PROJECT-STACKS-13)`, { repository })];
  if (!file.endsWith('package.json')) return names(text, repository) ? at(file.endsWith('.gitmodules') ? 'a submodule' : 'a path') : [];
  const doc = parse(text);
  if (!plain(doc)) return [];
  const field = DEPENDENCY_FIELDS.find((key) => doc[key] !== undefined && names(JSON.stringify(doc[key]), repository));
  return field === undefined ? [] : at(field);
}

/** STACKS_DATA_REPOSITORY over a parsed stack declaration of project `project`. Pure. */
export function stackDataFindings(project: string, doc: Parsed): Finding[] {
  if (!plain(doc) || doc.data === undefined) return [];
  const expected = dataRepositoryOf(project);
  const data = plain(doc.data) ? doc.data : {};
  const off = [
    ...(data.repository === expected ? [] : [`repository must be ${expected} (the project's name with ${DATA_REPOSITORY_SUFFIX})`]),
    ...(data.private === true ? [] : ['private must be true (a data repository is never public)']),
  ];
  return off.length ? [found('STACKS_DATA_REPOSITORY', STACK_FILE, `the stack declaration's data block is wrong: ${off.join('; ')} (PROJECT-STACKS-13)`, { repository: expected })] : [];
}

/** The text of a tracked JSON or .gitmodules file, whole up to 64 MiB; null when it is absent or larger. */
function jsonTextOf(repoRoot: string, file: string): string | null {
  try {
    const target = path.join(repoRoot, file);
    return fs.statSync(target).size > MAX_JSON_BYTES ? null : fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

/** Findings of R400 at the app root of an app (a code project): record dumps, dependencies on the data repository, the stack's data block. */
export function dataBoundaryFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false || typeof repo.project !== 'string') return [];
  const repository = dataRepositoryOf(repo.project);
  const findings: Finding[] = [];
  for (const file of all) {
    if (!file.endsWith('.json') && !file.endsWith('.gitmodules')) continue;
    const text = jsonTextOf(repoRoot, file);
    findings.push(...dataInCodeFindings(file, text), ...dataDependencyFindings(file, text, repository));
  }
  const stack = findStackDeclaration(repoRoot);
  return [...findings, ...(stack.doc ? stackDataFindings(repo.project, stack.doc) : [])];
}

/** The repository name a data repository's root declares, from the texts of its root manifest.json and hfs.json (null: absent); null when it is no data repository. */
export const dataRepositoryDeclared = (manifestText: string | null, hfsText: string | null): string | null => (hfsText === null ? dataManifestRepository(parse(manifestText)) : null);

/** The findings of one entry of the manifest's `files`, against the tracked data files and their sealed documents. */
function entryFindings(entry: Parsed, index: number, repository: string, sealed: ReadonlyMap<string, Parsed>): Finding[] {
  const at = `files[${index}]`;
  const drift = (message: string) => found('HFS_DATA_MANIFEST_DRIFT', DATA_MANIFEST, `${DATA_MANIFEST} ${at}: ${message} (PROJECT-STACKS-13)`);
  if (!plain(entry) || typeof entry.path !== 'string' || !entry.path.startsWith(DATA_FOLDER)) return [drift(`path must name a file under ${DATA_FOLDER}`)];
  if (!sealed.has(entry.path)) return [drift(`lists ${entry.path}, which is not tracked`)];
  const out: Finding[] = [];
  const items = sealed.get(entry.path)?.items;
  if (!Number.isInteger(entry.items) || entry.items < 0) out.push(drift(`items must be the file's count of items`));
  else if (Array.isArray(items) && items.length !== entry.items) out.push(drift(`says ${String(entry.items)} items for ${entry.path}, which holds ${items.length}`));
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) out.push(drift(`sha256 of ${entry.path} must be the hex sha256 of its canonical plaintext`));
  if (typeof entry.schema !== 'string' || !entry.schema.startsWith(`${repository}/`) || !SCHEMA_ID.test(entry.schema)) out.push(drift(`schema of ${entry.path} must be a schema id of the format, ${repository}/<entity>@<major>`));
  return out;
}

/**
 * Findings of R400 in a data repository: every tracked file under data/ is a sops envelope (HFS_DATA_UNSEALED), and the manifest lists
 * exactly those files with each count equal to the sealed file's items (HFS_DATA_MANIFEST_DRIFT). `files` are the tracked (or indexed)
 * paths; `read` gives a file's text (null: absent, binary or too large).
 */
export function dataRepositoryFindings({ manifestText, files, read }: { manifestText: string | null; files: readonly string[]; read: (file: string) => string | null }): Finding[] {
  const manifest = parse(manifestText);
  const repository = dataManifestRepository(manifest);
  if (repository === null) return [found('HFS_DATA_MANIFEST_DRIFT', DATA_MANIFEST, `${DATA_MANIFEST} is no data manifest: it carries format "<name>-data@<major>" and a files list (PROJECT-STACKS-13)`)];
  const findings: Finding[] = [];
  const sealed = new Map<string, Parsed>();
  for (const file of files.filter((name) => name.startsWith(DATA_FOLDER))) {
    const text = read(file);
    if (text === null) findings.push(found('HFS_DATA_UNSEALED', file, `${file} is binary, unreadable or too large; ${DATA_FOLDER} holds sealed JSON record files only (PROJECT-STACKS-13)`));
    else if (!isSopsEnvelope(text)) findings.push(found('HFS_DATA_UNSEALED', file, `${file} is not sealed: every file under ${DATA_FOLDER} is a sops envelope (a sops block with its mac, every value ENC[...]); seal it with the repository's own tools before the commit (PROJECT-STACKS-13)`));
    sealed.set(file, parse(text));
  }
  const listed = new Set<string>();
  (manifest.files as Parsed[]).forEach((entry, index) => {
    if (plain(entry) && typeof entry.path === 'string') {
      if (listed.has(entry.path)) findings.push(found('HFS_DATA_MANIFEST_DRIFT', DATA_MANIFEST, `${DATA_MANIFEST} files[${String(index)}]: lists ${entry.path} twice (PROJECT-STACKS-13)`));
      listed.add(entry.path);
    }
    findings.push(...entryFindings(entry, index, repository, sealed));
  });
  for (const file of sealed.keys()) if (!listed.has(file)) findings.push(found('HFS_DATA_MANIFEST_DRIFT', file, `${file} is tracked but ${DATA_MANIFEST} does not list it (PROJECT-STACKS-13)`));
  return findings;
}

// stack-seeds-config.mjs - reads and judges a seed level's manifest (`seeds.yaml`, schema starci/seeds@1), the declaration of the data an app
// seeds (contexts/project/stacks.md PROJECT-STACKS-12). A level is `.starcistacks/seeds/` (shared, every environment, first) or
// `.starcistacks/<env>/seeds/` (that environment only); each holds the manifest and the folders `sql/`, `data/` and `files/`. One entry is
// `{ id, kind, path, target, mode, after?, schema?, reason?, probe? }`: a `sql` entry is idempotent DML the harness runs on the database `target`
// names, a `data` entry is a document (or a folder of them) an app command (`target`, an argv list) loads after it validates against the JSON
// schema `schema` names, a `test-account` entry is the one data entry of an environment's level that declares a test account (with its
// `reason`), a `files` entry is assets for the bucket `target` names. How an entry learns that its target drifted is its `mode`: `once` never
// runs again, `upsert` runs again when its content hash changes or when its `probe` (an app command, an argv list) exits non-zero, and
// `always` runs on every stack up for an idempotent, cheap command. A document names a secret as `{ "secret": "seeds-<name>" }`, a sealed
// member of the environment (`.starcistacks/<env>/secrets/seeds-<name>.enc.yaml`) the seed step opens in memory, never a value. The same
// normaliser serves `starci app check` (R375) and the seed step of the stack verbs, so a manifest the check passes is one the step applies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml } from '../../engine/yaml.mjs';
import { closedFields, collector, patternField } from './stack-config-kit.mjs';
import type { StackProblem } from './stack-config-kit.mjs';

export const SEEDS_SCHEMA = 'starci/seeds@1';
/** The folder name of a seed level, at `.starcistacks/` and under each environment. */
export const SEEDS_DIR = 'seeds';
/** The manifest of a level. */
export const SEEDS_MANIFEST = 'seeds.yaml';
/** The kinds of entry; each lives in the folder `kindFolder` names. */
export const SEED_KINDS = Object.freeze(['sql', 'data', 'test-account', 'files'] as const);
/** The folders of a level. */
export const SEED_FOLDERS = Object.freeze(['sql', 'data', 'files'] as const);
/** `once`: applied a single time; `upsert`: applied again when its content hash changes or its probe finds drift; `always`: applied on every run. */
export const SEED_MODES = Object.freeze(['once', 'upsert', 'always'] as const);
/** The placeholder that keeps an empty seed folder tracked. */
export const SEEDS_KEEP = '.gitkeep';

/** The kind of one entry. */
export type SeedKind = (typeof SEED_KINDS)[number];
/** The mode of one entry. */
export type SeedMode = (typeof SEED_MODES)[number];
/**
 * One entry of a level's manifest, normalised; `target` is the database (`sql`), the app command argv (`data`, `test-account`) or the bucket
 * (`files`); `probe` is the argv of the app command that exits non-zero when the target drifted from the entry (an `upsert` entry only).
 */
export interface SeedEntry {
  id: string; kind: SeedKind; path: string; target: string | string[]; mode: SeedMode; after: string[]; schema: string | null; reason: string | null; probe: string[] | null;
}
/** One document of a data or test-account entry, level-relative, parsed or with the reason it does not parse. */
export type SeedDocument = { path: string; doc: unknown; error?: undefined } | { path: string; error: string; doc?: undefined };
/** A level as the check and the seed step see it: its app-relative folder, its entries in apply order and its problems. */
export interface SeedLevel { dir: string; env: string | null; entries: SeedEntry[]; problems: StackProblem[] }

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const NAME = /^[a-z][a-z0-9_-]{0,62}$/u;
const ENTRY_FIELDS = ['id', 'kind', 'path', 'target', 'mode', 'after', 'schema', 'reason', 'probe'];
const DOCUMENT = /\.(?:json|ya?ml)$/u;
/** The name of a sealed member a seed document may reference. */
export const SEED_SECRET_MEMBER = /^seeds-[a-z0-9][a-z0-9-]{0,62}$/u;

/** The folder of a level a kind's paths live in: a test account is data. */
export const kindFolder = (kind: SeedKind): (typeof SEED_FOLDERS)[number] => (kind === 'test-account' ? 'data' : kind);
/** True for an entry the app command loads as documents: `data` and `test-account`. */
export const isDocumentEntry = (entry: Pick<SeedEntry, 'kind'>): boolean => entry.kind === 'data' || entry.kind === 'test-account';
/** The sealed member file of `member` in the environment `env`, app-relative. */
export const seedMemberFile = (env: string, member: string): string => `.starcistacks/${env}/secrets/${member}.enc.yaml`;

/** The app-relative folder of a level: the shared one when `env` is null. */
export const seedLevelDir = (env: string | null): string => (env === null ? `.starcistacks/${SEEDS_DIR}` : `.starcistacks/${env}/${SEEDS_DIR}`);

const isFile = (target: string): boolean => fs.statSync(target, { throwIfNoEntry: false })?.isFile() === true;
const isFolder = (target: string): boolean => fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() === true;

/** Every file under `folder` (absolute) as a path relative to `base`, posix and sorted, the placeholders aside; a missing folder holds none. */
export function filesBelow(base: string, folder: string): string[] {
  if (!isFolder(folder)) return [];
  return fs.readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== SEEDS_KEEP)
    .map((entry) => path.relative(base, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

/** The level-relative files an entry covers: its path when it is a file, every file below it when it is a folder. */
export function entryFiles(levelRoot: string, entry: Pick<SeedEntry, 'path'>): string[] {
  const target = path.join(levelRoot, entry.path);
  return isFile(target) ? [entry.path] : filesBelow(levelRoot, target);
}

/** The content hash of an entry: its kind, target, mode, probe and every file it covers, by path and bytes. */
export function entryDigest(levelRoot: string, entry: SeedEntry): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify([entry.kind, entry.target, entry.mode, entry.probe]));
  for (const file of entryFiles(levelRoot, entry)) hash.update('\0').update(file).update('\0').update(fs.readFileSync(path.join(levelRoot, file)));
  return hash.digest('hex');
}

/** An argv list of an app command, `what` naming its purpose in the problem; a shell line, an empty list or a blank word is a problem. */
function argvOf(c: ReturnType<typeof collector>, at: string, value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item === '')) c.problem(at, `must be the argv list of the app command that ${what} (never a shell line)`);
  return Array.isArray(value) ? value.map(String) : [];
}

/** The probe of an entry: an argv list on an `upsert` entry the step can run, null when the entry declares none. */
function probeOf(c: ReturnType<typeof collector>, at: string, kind: SeedKind, mode: SeedMode | undefined, value: unknown): string[] | null {
  if (value === undefined) return null;
  if (kind === 'files') c.problem(at, 'is no field of a files entry: the harness uploads no file it could probe');
  else if (mode !== 'upsert') c.problem(at, 'is a field of an upsert entry only: a once entry never runs again and an always entry runs every time');
  return argvOf(c, at, value, 'exits non-zero when the target drifted');
}

function targetOf(c: ReturnType<typeof collector>, at: string, kind: SeedKind, value: unknown): string | string[] {
  if (kind === 'data' || kind === 'test-account') return argvOf(c, at, value, 'loads the data');
  patternField(c, at, value, NAME);
  return String(value ?? '');
}

function entryOf(c: ReturnType<typeof collector>, at: string, value: unknown, levelRoot: string, ids: Set<string>): SeedEntry | null {
  if (!closedFields(c, at, value, ENTRY_FIELDS, 'seed entry')) return null;
  const raw = value as Record<string, unknown>;
  if (patternField(c, `${at}.id`, raw.id, ID) && ids.has(String(raw.id))) c.problem(`${at}.id`, `${String(raw.id)} is declared twice`);
  ids.add(String(raw.id));
  const kind = SEED_KINDS.find((item) => item === raw.kind);
  if (kind === undefined) { c.problem(`${at}.kind`, `must be one of ${SEED_KINDS.join(', ')}`); return null; }
  const file = typeof raw.path === 'string' ? raw.path : '';
  const folder = kindFolder(kind);
  if (!file.startsWith(`${folder}/`) || path.posix.normalize(file) !== file || file.includes('\\')) c.problem(`${at}.path`, `must be a path under ${folder}/ of the level`);
  else if (!fs.existsSync(path.join(levelRoot, file))) c.problem(`${at}.path`, `${file} does not exist in the level`);
  const mode = SEED_MODES.find((item) => item === raw.mode);
  if (mode === undefined) c.problem(`${at}.mode`, `must be one of ${SEED_MODES.join(', ')}`);
  else if (mode === 'always' && kind === 'files') c.problem(`${at}.mode`, 'always is no mode of a files entry: the harness only validates its files');
  const after = raw.after === undefined ? [] : raw.after;
  if (!Array.isArray(after) || after.some((item) => typeof item !== 'string')) c.problem(`${at}.after`, 'must be a list of entry ids');
  const documents = isDocumentEntry({ kind });
  if (documents && (typeof raw.schema !== 'string' || raw.schema === '')) c.problem(`${at}.schema`, 'must name the JSON schema the app declares for the data, app-root relative');
  if (!documents && raw.schema !== undefined) c.problem(`${at}.schema`, 'is a field of a data or test-account entry only');
  if (kind === 'test-account' && (typeof raw.reason !== 'string' || raw.reason.trim() === '')) c.problem(`${at}.reason`, 'must say why this environment holds a test account');
  if (kind !== 'test-account' && raw.reason !== undefined) c.problem(`${at}.reason`, 'is a field of a test-account entry only');
  return {
    id: String(raw.id), kind, path: file, target: targetOf(c, `${at}.target`, kind, raw.target), mode: mode ?? 'upsert',
    after: Array.isArray(after) ? after.map(String) : [], schema: documents && typeof raw.schema === 'string' ? raw.schema : null,
    reason: kind === 'test-account' && typeof raw.reason === 'string' ? raw.reason : null, probe: probeOf(c, `${at}.probe`, kind, mode, raw.probe),
  };
}

/** The entries in apply order: manifest order, each after the entries it names; an unknown id or a cycle is a problem. */
function applyOrder(c: ReturnType<typeof collector>, entries: SeedEntry[], shared: ReadonlySet<string>): SeedEntry[] {
  const own = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) for (const id of entry.after) if (!own.has(id) && !shared.has(id)) c.problem(`entries.${entry.id}.after`, `${id} is no entry of this level or the shared level`);
  const done = new Set<string>();
  const order: SeedEntry[] = [];
  let pending = entries;
  while (pending.length > 0) {
    const ready = pending.filter((entry) => entry.after.every((id) => !own.has(id) || done.has(id)));
    if (ready.length === 0) { c.problem('entries', `the after lists of ${pending.map((entry) => entry.id).join(', ')} form a cycle`); return [...order, ...pending]; }
    for (const entry of ready) { order.push(entry); done.add(entry.id); }
    pending = pending.filter((entry) => !done.has(entry.id));
  }
  return order;
}

/**
 * Normalises the parsed manifest of the level at `levelRoot`; `shared` holds the ids of the shared level an environment's entries may follow,
 * and is null for the shared level itself, which declares no test account (an environment's level declares at most one).
 */
export function normalizeSeeds(doc: unknown, levelRoot: string, shared: ReadonlySet<string> | null = new Set()): { entries: SeedEntry[]; problems: StackProblem[] } {
  const c = collector();
  if (!closedFields(c, 'manifest', doc, ['schema', 'entries'], 'seeds')) return { entries: [], problems: c.problems };
  const raw = doc as Record<string, unknown>;
  if (raw.schema !== SEEDS_SCHEMA) c.problem('schema', `must be ${SEEDS_SCHEMA}`);
  const list = raw.entries ?? [];
  if (!Array.isArray(list)) { c.problem('entries', 'must be a list'); return { entries: [], problems: c.problems }; }
  const ids = new Set<string>();
  const entries = list.flatMap((value, index) => entryOf(c, `entries[${index}]`, value, levelRoot, ids) ?? []);
  const accounts = entries.filter((entry) => entry.kind === 'test-account').map((entry) => entry.id);
  if (shared === null && accounts.length > 0) c.problem('entries', `${accounts.join(', ')}: the shared level declares no test account; it belongs to the one environment that holds it`);
  if (accounts.length > 1) c.problem('entries', `${accounts.join(', ')}: a level declares at most one test account`);
  return { entries: applyOrder(c, entries, shared ?? new Set()), problems: c.problems };
}

/** Reads and judges the level of `env` (null: the shared level) at `repoRoot`; a level without a manifest has no entries. */
export function readSeedLevel(repoRoot: string, env: string | null, shared: ReadonlySet<string> = new Set()): SeedLevel {
  const dir = seedLevelDir(env);
  const file = path.join(repoRoot, dir, SEEDS_MANIFEST);
  if (!isFile(file)) return { dir, env, entries: [], problems: [] };
  let doc: unknown;
  try { doc = parseYaml(fs.readFileSync(file, 'utf8')); } catch (error) {
    return { dir, env, entries: [], problems: [{ at: 'manifest', message: `does not parse: ${String(error).split('\n')[0]}` }] };
  }
  return { dir, env, ...normalizeSeeds(doc ?? {}, path.join(repoRoot, dir), env === null ? null : shared) };
}

/** The documents of a data or test-account entry: every JSON or YAML file it covers, parsed. */
export function seedDocuments(levelRoot: string, entry: Pick<SeedEntry, 'path'>): SeedDocument[] {
  return entryFiles(levelRoot, entry).filter((file) => DOCUMENT.test(file)).map((file) => {
    const text = fs.readFileSync(path.join(levelRoot, file), 'utf8');
    try { return { path: file, doc: file.endsWith('.json') ? JSON.parse(text) : parseYaml(text) }; } catch (error) {
      return { path: file, error: String(error).split('\n')[0] ?? '' };
    }
  });
}

/** The member a value references when it is a secret reference (`{ "secret": "<member>" }` and nothing else), else null. */
export function secretReference(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const member = (value as Record<string, unknown>).secret;
  return keys.length === 1 && typeof member === 'string' ? member : null;
}

/** Every member the secret references of a document name, in document order, once each. */
export function secretReferences(doc: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    const member = secretReference(value);
    if (member !== null) { if (!found.includes(member)) found.push(member); return; }
    if (value !== null && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  };
  visit(doc);
  return found;
}

/** A copy of `doc` with every secret reference replaced by what `resolve` answers for its member. */
export function resolveSecrets(doc: unknown, resolve: (member: string) => unknown): unknown {
  const member = secretReference(doc);
  if (member !== null) return resolve(member);
  if (Array.isArray(doc)) return doc.map((item) => resolveSecrets(item, resolve));
  if (doc !== null && typeof doc === 'object') return Object.fromEntries(Object.entries(doc).map(([key, item]) => [key, resolveSecrets(item, resolve)]));
  return doc;
}

/** An entry to declare in a manifest: `after` and `schema` as the manifest spells them, left out when empty. */
export type SeedEntryInput = Pick<SeedEntry, 'id' | 'kind' | 'path' | 'target' | 'mode'> & { after?: string[]; schema?: string };

/**
 * Declares `entries` in the manifest of the level of `env` (null: the shared level), creating the manifest when the level has none; an id the
 * manifest already holds is kept as it is. Answers the ids it added (none are written when `write` is false).
 */
export function addSeedEntries(repoRoot: string, env: string | null, entries: SeedEntryInput[], write = true): string[] {
  const file = path.join(repoRoot, seedLevelDir(env), SEEDS_MANIFEST);
  const doc = (isFile(file) ? parseYaml(fs.readFileSync(file, 'utf8')) : null) as { schema?: unknown; entries?: unknown } | null;
  const held = Array.isArray(doc?.entries) ? (doc.entries as Array<Record<string, unknown>>) : [];
  const added = entries.filter((entry) => !held.some((item) => item.id === entry.id));
  if (added.length > 0 && write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stringifyYaml({ schema: SEEDS_SCHEMA, ...doc, entries: [...held, ...added] }));
  }
  return added.map((entry) => entry.id);
}

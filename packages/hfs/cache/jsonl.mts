// jsonl.mts - the on-disk format of the cache: JSON Lines, one self-contained record per line, sorted by (path, step), keys sorted
// inside each record, LF endings, a final newline, nothing that varies between runs. Two runs over one tree write identical bytes.
import type { CacheRecord, Finding, JsonValue } from './types.mjs';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compare)) if (source[key] !== undefined) out[key] = sortKeys(source[key]);
    return out;
  }
  return value;
}

/** `value` as JSON with every object's keys sorted and undefined members dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Findings sorted by line, column, rule, message. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.line - b.line || a.column - b.column || compare(a.rule, b.rule) || compare(a.message, b.message));
}

/** Records sorted by path, then step. */
export function sortRecords(records: readonly CacheRecord[]): CacheRecord[] {
  return [...records].sort((a, b) => compare(a.path, b.path) || compare(a.step, b.step));
}

/** The canonical line a lazy record was read from or made of (`lazyRecord`), written back as it is. */
const RAW_LINE = Symbol('starci.cache.rawLine');

/** The canonical line of one record: a lazy record's own line, else its canonical JSON with its findings sorted. */
export function recordLine(record: CacheRecord): string {
  const raw = (record as { [RAW_LINE]?: string })[RAW_LINE];
  return raw ?? canonicalJson({ ...record, findings: sortFindings(record.findings) });
}

/**
 * A record that keeps its canonical line and parses its `data` only when it is read, and again on every read (memory plan, streaming): a family whose
 * records are large (the per-spec coverage, hundreds of MB in a large app) holds each as one line of text instead of its parsed tree, which is about
 * seven times larger, and a record the run reuses is written back as the line it was. `line` must be the canonical line of `parsed`.
 */
export function lazyRecord(line: string, parsed: CacheRecord): CacheRecord {
  const record = { path: parsed.path, step: parsed.step, hash: parsed.hash, findings: parsed.findings };
  Object.defineProperty(record, RAW_LINE, { value: line, enumerable: false });
  if (parsed.data !== undefined) Object.defineProperty(record, 'data', { enumerable: true, get: (): JsonValue | undefined => (JSON.parse(line) as CacheRecord).data });
  return record;
}

/** `record` as a lazy one: its canonical line kept, its data dropped until it is read. */
export const toLazyRecord = (record: CacheRecord): CacheRecord => lazyRecord(recordLine(record), record);

/** The file text of `records`: sorted, one canonical line each, LF, a final newline; the empty set is the empty text. */
export function serializeRecords(records: readonly CacheRecord[]): string {
  const lines = sortRecords(records).map(recordLine);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function isRecord(value: unknown): value is CacheRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['path'] === 'string' && typeof v['step'] === 'string' && typeof v['hash'] === 'string' && Array.isArray(v['findings']);
}

/** What a file held: the records it parsed and how many lines were not one (a half-merged or hand-damaged line). */
export interface ParsedRecords {
  readonly records: CacheRecord[];
  readonly invalid: number;
}

/** Parses a record file. CRLF is tolerated; a line that is not a record is counted and skipped, never thrown on. */
export function parseRecords(text: string, options: { readonly lazy?: boolean } = {}): ParsedRecords {
  const records: CacheRecord[] = [];
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      // A lazy record keeps its line only when the line is canonical, so writing it back is what serializing it would write.
      if (isRecord(parsed)) records.push(options.lazy === true && recordLine(parsed) === line ? lazyRecord(line, parsed) : parsed);
      else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { records, invalid };
}

/**
 * The records a union merge may have doubled, reduced to one per (path, step): the one whose hash matches the tree
 * (`currentHash(path)`); the rest are dropped. A key whose matching records differ keeps none (two branches disagreeing is a
 * mismatch, so the step judges again).
 */
export function reconcile(records: readonly CacheRecord[], currentHash: (path: string) => string | undefined): CacheRecord[] {
  const byKey = new Map<string, CacheRecord[]>();
  for (const record of records) {
    if (currentHash(record.path) !== record.hash) continue;
    const key = `${record.path}\0${record.step}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }
  const out: CacheRecord[] = [];
  for (const group of byKey.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const text = canonicalJson(first);
    if (group.every((record) => canonicalJson(record) === text)) out.push(first);
  }
  return sortRecords(out);
}

/**
 * The area a record belongs to: the first `depth` folders of its path (`modules/billing` for `modules/billing/a/b.ts`), or
 * `root` for a file with no folder. A change rewrites only the area files it touched.
 */
export function areaOf(path: string, depth = 2): string {
  const folders = path.split('/').slice(0, -1).slice(0, depth);
  return folders.length === 0 ? 'root' : folders.join('/');
}

/**
 * The most bytes one record file holds: well under the 100 MB a git host refuses (GitHub GH001) and the size an upload times out on, so a
 * whole app's coverage records split into files a push carries. The push gate refuses a file over its own limit (freshness.mts).
 */
export const RECORD_FILE_MAX_BYTES = 32 * 1024 * 1024;

/** The bytes a record takes in its file: its canonical line and the newline, measured once per record, never by joining a whole file. */
const recordBytes = new WeakMap<CacheRecord, number>();
const lineBytes = (record: CacheRecord): number => {
  const known = recordBytes.get(record);
  if (known !== undefined) return known;
  const bytes = Buffer.byteLength(canonicalJson({ ...record, findings: sortFindings(record.findings) })) + 1;
  recordBytes.set(record, bytes);
  return bytes;
};
const byteLength = (records: readonly CacheRecord[]): number => records.reduce((sum, record) => sum + lineBytes(record), 0);

/** A stable bucket of a path, 0..buckets-1 (FNV-1a), so a record stays in its file while the set around it changes size only a little. */
function bucketOf(path: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index += 1) hash = Math.imul(hash ^ path.charCodeAt(index), 0x01000193) >>> 0;
  return hash % buckets;
}

/** One group split until each file is under `maxBytes`: one folder deeper while that divides it, else into hash buckets `<area>/~<n>.jsonl`. */
function bounded(area: string, records: CacheRecord[], depth: number, maxBytes: number): Array<[string, CacheRecord[]]> {
  const size = byteLength(records);
  if (size <= maxBytes || records.length < 2) return [[`${area}.jsonl`, records]];
  const deeper = new Map<string, CacheRecord[]>();
  for (const record of records) {
    const name = areaOf(record.path, depth + 1);
    deeper.set(name, [...(deeper.get(name) ?? []), record]);
  }
  if (deeper.size > 1) return [...deeper].flatMap(([name, group]) => bounded(name, group, depth + 1, maxBytes));
  // One folder below holds them all: descend into it while the paths go deeper.
  const [only] = deeper.keys();
  if (only !== undefined && only !== area) return bounded(only, records, depth + 1, maxBytes);
  // Buckets double until each holds under the budget (a single record over it keeps a file of its own).
  for (let buckets = Math.ceil(size / maxBytes) + 1; ; buckets *= 2) {
    const split = new Map<number, CacheRecord[]>();
    for (const record of records) {
      const bucket = bucketOf(record.path, buckets);
      split.set(bucket, [...(split.get(bucket) ?? []), record]);
    }
    if (buckets >= records.length || [...split.values()].every((group) => group.length < 2 || byteLength(group) <= maxBytes)) {
      return [...split].map(([bucket, group]): [string, CacheRecord[]] => [`${area}/~${String(bucket)}.jsonl`, group]);
    }
  }
}

/**
 * Records grouped by area file name (`<area>.jsonl`), groups and files sorted. An area whose file would pass `maxBytes` is split one
 * folder deeper, and a single folder that still does into hash buckets; a reader reads every `.jsonl` under the folder, so the layout is free.
 */
export function groupByArea(records: readonly CacheRecord[], depth = 2, maxBytes = RECORD_FILE_MAX_BYTES): Map<string, CacheRecord[]> {
  const groups = new Map<string, CacheRecord[]>();
  for (const record of records) {
    const area = areaOf(record.path, depth);
    groups.set(area, [...(groups.get(area) ?? []), record]);
  }
  const files = new Map<string, CacheRecord[]>();
  for (const [area, group] of groups) for (const [file, part] of bounded(area, group, depth, maxBytes)) files.set(file, sortRecords(part));
  return new Map([...files].sort(([a], [b]) => compare(a, b)));
}

/** True when `value` survives JSON unchanged: a guard for record payloads. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

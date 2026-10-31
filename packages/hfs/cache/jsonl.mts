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

/** The file text of `records`: sorted, one canonical line each, LF, a final newline; the empty set is the empty text. */
export function serializeRecords(records: readonly CacheRecord[]): string {
  const lines = sortRecords(records).map((record) => canonicalJson({ ...record, findings: sortFindings(record.findings) }));
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
export function parseRecords(text: string): ParsedRecords {
  const records: CacheRecord[] = [];
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
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

/** Records grouped by area file name (`<area>.jsonl`), groups and files sorted. */
export function groupByArea(records: readonly CacheRecord[], depth = 2): Map<string, CacheRecord[]> {
  const groups = new Map<string, CacheRecord[]>();
  for (const record of records) {
    const file = `${areaOf(record.path, depth)}.jsonl`;
    groups.set(file, [...(groups.get(file) ?? []), record]);
  }
  for (const [file, group] of groups) groups.set(file, sortRecords(group));
  return new Map([...groups].sort(([a], [b]) => compare(a, b)));
}

/** True when `value` survives JSON unchanged: a guard for record payloads. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

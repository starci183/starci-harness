// records.mts - the working set of one folder during a run: the records the family inherited, replaced key by key as its steps judge, then
// handed back to the session in one `replace`. A step that throws puts nothing, so it keeps (or loses) no record of that step.
import { compare } from './order.mjs';
import { combineHashes } from './hash.mjs';
import type { CacheRecord, CheckSession, ContentIndex, Finding, JsonValue } from './types.mjs';

const keyOf = (path: string, step: string): string => `${path}\0${step}`;

export class RecordSet {
  private readonly records = new Map<string, CacheRecord>();

  constructor(initial: readonly CacheRecord[] = []) {
    for (const record of initial) this.records.set(keyOf(record.path, record.step), record);
  }

  /** The record of (path, step) whose hash is `hash`, else undefined: a record of other content is no answer. */
  matching(path: string, step: string, hash: string): CacheRecord | undefined {
    const record = this.records.get(keyOf(path, step));
    return record?.hash === hash ? record : undefined;
  }

  put(record: CacheRecord): void {
    this.records.set(keyOf(record.path, record.step), record);
  }

  /** Drops every record of `step` whose path is not in `keep`: a deleted path drops every record it owns. */
  retain(step: string, keep: ReadonlySet<string>): void {
    for (const [key, record] of this.records) if (record.step === step && !keep.has(record.path)) this.records.delete(key);
  }

  /** Every finding the records of `step` hold. */
  findings(step: string): Finding[] {
    return [...this.records.values()].filter((record) => record.step === step).flatMap((record) => record.findings);
  }

  toArray(): CacheRecord[] {
    return [...this.records.values()].sort((a, b) => compare(a.path, b.path) || compare(a.step, b.step));
  }
}

/** The key of an input set: the sha256 of its members and their hashes, `absent` for a member the work tree no longer holds. */
export function keyOfPaths(index: ContentIndex, paths: readonly string[], extra: Readonly<Record<string, string>> = {}): string {
  const parts: Record<string, string> = { ...extra };
  for (const file of paths) parts[`path:${file}`] = index.hashOf(file) ?? 'absent';
  return combineHashes(parts);
}

/**
 * One scoped step: reuses the recorded `data` when the family runs diff and the record's key is `key`; else computes, and stores unless the
 * step's inputs (`inputs`, tracked paths) were edited during the run or `store(value)` says the result must not be kept (a timeout is never
 * stored). `compact` is the record's findings, for the new / known / fixed comparison.
 */
export async function scopedStep<T extends JsonValue>(
  session: CheckSession,
  records: RecordSet,
  step: { readonly path: string; readonly step: string; readonly key: string; readonly reuse: boolean; readonly inputs: readonly string[]; compute(): T | Promise<T>; compact(value: T): Finding[]; store?(value: T): boolean },
): Promise<{ value: T; reused: boolean }> {
  const held = step.reuse ? records.matching(step.path, step.step, step.key) : undefined;
  if (held?.data !== undefined) return { value: held.data as T, reused: true };
  const value = await step.compute();
  if ((step.store?.(value) ?? true) && session.unchanged(step.inputs)) records.put({ path: step.path, step: step.step, hash: step.key, findings: step.compact(value), data: value });
  return { value, reused: false };
}

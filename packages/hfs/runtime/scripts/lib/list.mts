// list.mjs — the array-or-empty coercion half the scripts re-declared by hand.
// `v` when it already is an array, else []. Scalars are NOT wrapped: a caller that wants
// `[v]` for a lone value writes its own coercion (see contract-version's list).
export const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? v : []);

/** `v` as an array: itself when already one, [] for null/undefined, else [v]. */
export const asList = <T = unknown,>(v: unknown): T[] => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v as T];
};

/** The object entries of `v` (a non-array reads as []). */
export const objectList = <T extends object = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? v : []).filter((item): item is T => item && typeof item === 'object');

/** Every entry of `v` a non-empty string (`blank: false` also rejects all-whitespace entries). */
export const stringList = (v: unknown, { blank = true }: { blank?: boolean } = {}): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0 && (blank || s.trim().length > 0));

/** A non-empty list of distinct values, all accepted by the supplied predicate. */
export const nonemptyUniqueList = <T = unknown,>(values: unknown, accepts: (entry: T) => boolean): values is T[] => Array.isArray(values) && values.length > 0
  && values.every((entry) => accepts(entry)) && new Set(values).size === values.length;

/** The items of a `sep`-separated list: trimmed, empties dropped; `dedupe` keeps first occurrences only. */
export const splitList = (v: unknown, { sep = ',', dedupe = false }: { sep?: string | RegExp; dedupe?: boolean } = {}): string[] => {
  const items = String(v ?? '').split(sep).map((s) => s.trim()).filter(Boolean);
  return dedupe ? [...new Set(items)] : items;
};

// The comparator of a bare `sort()` (UTF-16 code-unit order) is owned by the engine, which cannot import scripts/lib.
export { byCodeUnit } from '../../engine/by-code-unit.mjs';

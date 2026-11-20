// catalog-reach.mts - which screens a change to an i18n catalog (`apps/<app>/src/modules/i18n/messages/<locale>.json`, slot fe.modules.i18n) can change. The UI audit reach follows an
// imported catalog whole, so one edited line marked every screen. A catalog change counts for a screen only when a source the screen reaches reads a key that changed (changed, added or
// removed), by the rules the i18n canon already holds to (architecture/i18n-keys.mts, FE_I18N_KEYS): a string literal or template of the source that equals a tail of the key's dotted path,
// or a translator of the key's namespace called with a key that is not spelled out (a template, a variable). Whatever cannot be read this way (a catalog that does not parse, a source that does not
// parse) counts: the reach prefers a screen too many to one missed.
import type TypeScript from 'typescript';
import { i18nUsageOf, leavesOf, tailMatches, type PatternSegment } from '../runtime/scripts/hfs/architecture/i18n-keys.mjs';
import type { TypeScriptApi } from '../runtime/scripts/hfs/architecture/config.mjs';

type Ts = typeof TypeScript;

/** The keys of a catalog that differ between two texts, or `all` when they cannot be compared. */
export interface CatalogDiff { all: boolean; keys: ReadonlySet<string> }

const valuesOf = (text: string): Map<string, string> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    const map = new Map<string, string>();
    const walk = (value: unknown, prefix: string): void => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) for (const [key, child] of Object.entries(value)) walk(child, prefix === '' ? key : `${prefix}.${key}`);
      else map.set(prefix, JSON.stringify(value));
    };
    walk(parsed, '');
    // a leaf is named by its dotted path; the catalog's own leaves are the canon's (leavesOf)
    for (const leaf of leavesOf(parsed).filter(Boolean)) if (!map.has(leaf)) return null;
    return map;
  } catch { return null; }
};

/** The leaves added, removed or changed from `base` to `head` (null: the catalog did not exist, every key of it is new). */
export function catalogDiff(base: string | null, head: string | null): CatalogDiff {
  if (head === null) return { all: true, keys: new Set() };
  const after = valuesOf(head);
  const before = base === null ? new Map<string, string>() : valuesOf(base);
  if (after === null || before === null) return { all: true, keys: new Set() };
  const keys = new Set<string>();
  for (const [key, value] of after) if (before.get(key) !== value) keys.add(key);
  for (const key of before.keys()) if (!after.has(key)) keys.add(key);
  return { all: false, keys };
}

/** What a source reads of the catalogs. */
export interface Usage { patterns: PatternSegment[][]; dynamic: string[]; exact: string[]; translated: boolean; whole: boolean }

/** The usage of one source (`whole`: it does not parse, so it may read anything). */
export function usageOf(ts: Ts, file: string, text: string): Usage {
  try {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const problems = (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
    if (problems !== undefined && problems.length > 0) return { patterns: [], dynamic: [], exact: [], translated: false, whole: true };
    return { ...i18nUsageOf(ts as unknown as TypeScriptApi, source as never), whole: false };
  } catch { return { patterns: [], dynamic: [], exact: [], translated: false, whole: true }; }
}

/** True when a source with this usage reads a key of `diff`: a pattern that ends the key's path, or a dynamic read in a namespace the key sits under. */
export function readsChanged(usage: Usage, diff: CatalogDiff): boolean {
  if (diff.all || usage.whole) return true;
  for (const key of diff.keys) {
    const segments = key.split('.');
    // a source with a translator reads exactly the full keys of its calls (a key that is a namespace above the changed one reads it as an object); one without reads by the loose patterns
    if (usage.translated ? usage.exact.some((read) => key === read || key.startsWith(`${read}.`)) : usage.patterns.some((pattern) => tailMatches(pattern, segments))) return true;
    if (usage.dynamic.some((namespace) => namespace === '' || key === namespace || key.startsWith(`${namespace}.`))) return true;
  }
  return false;
}

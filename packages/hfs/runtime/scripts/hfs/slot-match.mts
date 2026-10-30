// slot-match.mjs - the slot path patterns of the HFS manifest compiled to regular expressions, and the matching of a path against them:
// the variants that match it, the most specific one, and the nearest slot of an unknown path. Pure; slot-classify.mjs asks it.
import path from 'node:path';
import { braceVariants } from '../lib/glob.mjs';
import { captureNames } from '../lib/i18n.mjs';
import type { Slot } from './manifest-shape.mjs';

/** The values the variables of a slot path took in a matched path. */
export type Bindings = Record<string, string>;

/** One brace-free slot path pattern compiled. */
export interface Variant {
  slot: Slot;
  pattern: string;
  dir: boolean;
  segments: string[];
  names: string[];
  score: number;
  wildcards: number;
  regex: RegExp;
  segmentRegexes: Array<RegExp | null>;
}

/** The match of a path against one variant: its slot, the instance root and the bound variables. */
export interface Match {
  variant: Variant;
  slot: Slot;
  root: string;
  bindings: Bindings;
}

/** The slot nearest to a path no slot owns, and how far the path agreed with it. */
export interface NearestSlot {
  slot: string;
  pattern: string;
  matchedDepth: number;
  matchedPrefix: string;
  expectedNext: string | null;
}

/** What matchVariants needs of a scope: its compiled variants and the kind of each declared app. */
export interface MatchScope {
  variants: Variant[];
  appKind: Map<string, string>;
}

interface Candidate {
  variant: Variant;
  depth: number;
  shape: number;
  distance: number;
}

const VAR = /<([A-Za-z][A-Za-z0-9-]*)>/g;
export const varsOf = (text: string): string[] => captureNames(text, VAR);
const hasWildcard = (segment: string): boolean => /[*?]/.test(segment);

/** `text` with the `<name>` variables filled from `bindings` (an unbound one stays as written). */
export function fillVars(text: string, bindings: Bindings): string {
  const bound = (whole: string, name: string) => bindings[name] ?? whole;
  return `${text}`.replace(VAR, bound);
}

/** Weight of one pattern segment: literal 4, literal mixed with a variable 3, a bare variable 2, a wildcard 1, `**` 0. */
function segmentWeight(segment: string): number {
  if (segment === '**') return 0;
  if (hasWildcard(segment)) return 1;
  if (/^<[^>]+>$/.test(segment)) return 2;
  if (segment.includes('<')) return 3;
  return 4;
}

/** The RegExp source of one pattern segment (no separators); variables capture, and are listed in `names`. */
function segmentSource(segment: string, names: string[]): string {
  let source = '', variableEnd = -1;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i] as string;
    if (i <= variableEnd) continue;
    if (c === '<') {
      variableEnd = segment.indexOf('>', i);
      names.push(segment.slice(i + 1, variableEnd));
      source += '([^/]+?)';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return source;
}

/** One brace-free pattern compiled: `dir` patterns (trailing /) own everything below their root. */
export function compileVariant(slot: Slot, pattern: string): Variant {
  const dir = pattern.endsWith('/');
  const body = dir ? pattern.slice(0, -1) : pattern;
  const segments = body.split('/');
  const names: string[] = [];
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') source += last ? '.*' : '(?:.*/)?';
    else source += segmentSource(segment, names) + (last ? '' : '/');
  });
  return {
    slot,
    pattern,
    dir,
    segments,
    names,
    score: segments.reduce((sum, s) => sum + segmentWeight(s), 0),
    wildcards: segments.filter(hasWildcard).length,
    regex: new RegExp(`^(${source})${dir ? '(?:/.*)?' : ''}$`),
    segmentRegexes: segments.map((s) => (s === '**' ? null : new RegExp(`^${segmentSource(s, [])}$`))),
  };
}

export const variantsOf = (slot: Slot): Variant[] => braceVariants(slot.path).map((pattern: string) => compileVariant(slot, pattern));

const levenshtein = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const held = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = held;
    }
  }
  return row[b.length] as number;
};

/** The match of `p` against one variant: its slot, root and bindings, or null (not matching, filtered out, or an app-kind slot of another kind). */
function matchVariant(variant: Variant, p: string, only: ((slot: Slot) => boolean) | undefined, appKind: Map<string, string>): Match | null {
  if (only && !only(variant.slot)) return null;
  const m = variant.regex.exec(p);
  if (!m) return null;
  const bindings: Bindings = {};
  variant.names.forEach((name, i) => { bindings[name] = m[i + 2] as string; });
  if (variant.slot.appKind !== undefined && appKind.get(bindings.app as string) !== variant.slot.appKind) return null;
  const root = variant.dir ? (m[1] as string) : path.posix.dirname(m[1] as string);
  return { variant, slot: variant.slot, root: root === '.' ? '' : root, bindings };
}

/** Every variant matching `p`, with its root and bindings, minus app-kind slots of another kind, the most specific first. */
export function matchVariants({ variants, appKind }: MatchScope, p: string, only?: (slot: Slot) => boolean): Match[] {
  const found: Match[] = [];
  for (const variant of variants) {
    const hit = matchVariant(variant, p, only, appKind);
    if (hit) found.push(hit);
  }
  return found.sort((a, b) => b.variant.score - a.variant.score || a.variant.wildcards - b.variant.wildcards);
}

/** The single most specific match of a sorted list: {hit, ambiguous}; two slots of equal specificity are ambiguous. */
export function bestMatch(found: Match[]): { hit: Match | null; ambiguous: string[] } {
  if (!found.length) return { hit: null, ambiguous: [] };
  const first = found[0] as Match;
  const top = found.filter((f) => f.variant.score === first.variant.score && f.variant.wildcards === first.variant.wildcards);
  const distinct = [...new Set(top.map((f) => f.slot.id))];
  return distinct.length > 1 ? { hit: null, ambiguous: distinct } : { hit: top[0] as Match, ambiguous: [] };
}

/** How many leading segments of `parts` a variant accepts. */
function acceptedDepth(variant: Variant, parts: string[]): number {
  let depth = 0;
  while (depth < parts.length && depth < variant.segments.length) {
    const rx = variant.segmentRegexes[depth] as RegExp | null;
    if (rx === null || !rx.test(parts[depth] as string)) break;
    depth += 1;
  }
  return depth;
}

/** Whether `cand` is nearer to the path than `winner`: deeper, then closer in shape, then in spelling, then more specific. */
function nearerCandidate(cand: Candidate, winner: Candidate | null): boolean {
  if (!winner) return true;
  if (cand.depth !== winner.depth) return cand.depth > winner.depth;
  if (cand.shape !== winner.shape) return cand.shape < winner.shape;
  if (cand.distance !== winner.distance) return cand.distance < winner.distance;
  return cand.variant.score > winner.variant.score;
}

/** The leading segments of `p` a variant accepts, and how far it got; how the nearest slot of an unknown path is found. */
export function nearestSlot(variants: Variant[], p: string): NearestSlot | null {
  const parts = p.split('/');
  let winner: Candidate | null = null;
  for (const variant of variants) {
    const depth = acceptedDepth(variant, parts);
    const expected = variant.segments[depth] ?? '';
    const distance = levenshtein(parts[depth] ?? '', expected.replace(VAR, ''));
    const cand: Candidate = { variant, depth, shape: Math.abs(variant.segments.length - parts.length), distance };
    if (nearerCandidate(cand, winner)) winner = cand;
  }
  if (!winner) return null;
  return {
    slot: winner.variant.slot.id,
    pattern: winner.variant.pattern,
    matchedDepth: winner.depth,
    matchedPrefix: parts.slice(0, winner.depth).join('/'),
    expectedNext: winner.variant.segments[winner.depth] ?? null,
  };
}

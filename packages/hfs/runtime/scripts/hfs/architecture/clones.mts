/**
 * HFS check 7, R21 duplicate code (knowledge/hfs/slots.yaml ruleParams.<profile>.duplicateBlock = {lines: N, tokens: T},
 * the one definition of the threshold): a token-normalised block of at least N source lines and T tokens that appears
 * twice in the production program - in two owners, in two files of one owner, or twice in one file - is code copied
 * instead of shared.
 *
 * Normalisation: every production file is flattened into its syntax-node sequence (the compiler's parsed tree, walked in
 * source order; comments and whitespace do not exist in it), identifiers become one ID kind, string, template, numeric,
 * bigint and regex literals become one LIT kind, keywords and operators keep their own kind. Leading import and
 * export-from statements are dropped (imports repeat legitimately). A window is the run of tokens on N consecutive
 * physical lines starting at a line start whose last token reaches line N; windows are hashed with a rolling polynomial
 * hash (O(total tokens)), equal windows of two different owners are verified token by token, and overlapping hits on the
 * same file pair and offset merge into one maximal block. A block whose lines are mostly type declarations
 * (fewer than N/2 lines outside interface and type alias declarations) or of fewer than N/3 distinct line shapes
 * (a decorated DTO field list repeating one shape) is ignored.
 *
 * Two kinds of file are uniform by design and are not compared, both found through the slot resolver: the entry main.ts of
 * an app (slot appKind + its required main.ts) and the transport doors of a feature (a *.controller.ts, *.resolver.ts,
 * *.gateway.ts, *.consumer.ts, *.processor.ts or *.cli.ts of a slot that a protocol app composes). This is not a loophole: logic
 * cannot live in either. A door body is dispatch only (eslint transport-is-thin, R88), and main.ts cannot share a
 * helper because NestFactory is allowed only in main.ts (BE_ENTRYPOINT_ONLY_IN_APPS), so what repeats there is the
 * canonical shape of section 5 of BE-CONVENTION. A door or main.ts that grows logic is refused by those enforcers, not
 * excused here; every other file of the same slots (mappers, dto, app.module.ts) stays compared.
 * Canon scaffold subtrees (job fences, read/mapping methods, queue producers/definitions, CQRS wiring and data
 * props of imported JSX frames) are also dropped through their imported shape markers. Each exclusion ends a
 * token segment, so a window cannot join unrelated code across omitted scaffold lines. Custom bodies stay compared.
 */
import type { ExportDeclaration, JsxText, Node, SourceFile, Statement, SyntaxKind as Kind } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { RuleParams } from '../slots.mjs';
import type { ArchitectureViolation, CheckContext, CheckInput, GraphFile } from './hfs-graph.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { canonCloneNodes } from './canon-clones.mjs';

export const CLONE_RULE_IDS = ['HFS_DUPLICATE_CODE'];

const MAX_VIOLATIONS = 200;
const DOOR_ROLES = new Set(['controller', 'resolver', 'gateway', 'consumer', 'processor', 'cli']);
const APP_ENTRY = 'main.ts';
const ID = -1;
const LIT = -2;

/** The compiler API's SyntaxKind enum object. */
type Kinds = TypeScriptApi['SyntaxKind'];

/** The slot resolver of scripts/hfs/slots.mjs. */
type Resolver = ArchitectureConfig['hfs'];

/** The token streams of one file: normalised kind, physical line, in-type flag and exclusion segment per token. */
export interface TokenizedFile {
  kinds: Int32Array;
  lines: Int32Array;
  types: Uint8Array;
  segments: Int32Array;
}

/** One production file entered into the comparison: its path, owner unit and token streams. */
interface CloneEntry extends TokenizedFile {
  rel: string;
  unit: string;
}

/** A token window: file index, first token, one past the last token. */
type Window = [fileIndex: number, start: number, end: number];

/** The hash bases and their power tables. */
interface Hashing {
  pow1: Int32Array;
  pow2: Int32Array;
  B1: number;
  B2: number;
}

/** Windows of equal hash. */
type Buckets = Map<string, Window[]>;

/** Verified equal windows grouped by file pair and offset: `${a}|${b}|${diagonal}` -> [start, end] runs of the first file. */
type Hits = Map<string, [number, number][]>;

/** One maximal duplicated block between two files. */
interface CloneBlock {
  a: CloneEntry;
  b: CloneEntry;
  line: number;
  endLine: number;
  lines: number;
  twin: { path: string; line: number; endLine: number };
}

/** The mutable state one file's token walk fills. */
interface TokenWalk {
  ts: TypeScriptApi;
  sourceFile: SourceFile;
  kinds: number[];
  lines: number[];
  types: number[];
  segments: number[];
  segment: number;
  excluded: Set<Node> | null;
  lineStarts: readonly number[];
  literalKinds: Set<Kind>;
}

/** The check context, which a legacy caller may carry as `loaded.ts`. */
interface CloneContext extends CheckContext {
  loaded: { ts: TypeScriptApi };
}

const entryAt = (entries: CloneEntry[], index: number): CloneEntry => entries[index] as CloneEntry;

const literalKindSet = (SyntaxKind: Kinds): Set<Kind> => new Set<Kind>([SyntaxKind.StringLiteral, SyntaxKind.NumericLiteral, SyntaxKind.BigIntLiteral, SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail, SyntaxKind.JsxText]);

function lineOfPosition(lineStarts: readonly number[], position: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] as number) <= position) low = mid; else high = mid - 1;
  }
  return low + 1;
}

/** True for the nodes that carry no token: documentation comments and whitespace-only JSX text. */
function isTriviaNode(SyntaxKind: Kinds, node: Node): boolean {
  const kind = node.kind;
  if (kind >= SyntaxKind.FirstJSDocNode && kind <= SyntaxKind.LastJSDocNode) return true;
  return kind === SyntaxKind.JsxText && Boolean((node as JsxText).containsOnlyTriviaWhiteSpaces);
}

function normalizedKindOf(SyntaxKind: Kinds, literalKinds: Set<Kind>, kind: Kind): number {
  if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier) return ID;
  return literalKinds.has(kind) ? LIT : kind;
}

function visitToken(walk: TokenWalk, node: Node, inType: boolean): void {
  const { ts, sourceFile, kinds, lines, types, lineStarts, literalKinds } = walk;
  const { SyntaxKind } = ts;
  if (isTriviaNode(SyntaxKind, node)) return;
  if (walk.excluded?.has(node)) { walk.segment += 1; return; }
  const kind = node.kind;
  const typeScope = inType || kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration;
  kinds.push(normalizedKindOf(SyntaxKind, literalKinds, kind));
  lines.push(lineOfPosition(lineStarts, node.getStart(sourceFile)));
  types.push(typeScope ? 1 : 0);
  walk.segments.push(walk.segment);
  ts.forEachChild(node, (child) => { visitToken(walk, child, typeScope); });
}

/** Leading import and export-from statements repeat legitimately and are not tokenised. */
const isDroppedStatement = (SyntaxKind: Kinds, statement: Statement): boolean => statement.kind === SyntaxKind.ImportDeclaration || statement.kind === SyntaxKind.ImportEqualsDeclaration
  || (statement.kind === SyntaxKind.ExportDeclaration && Boolean((statement as ExportDeclaration).moduleSpecifier));

export function tokenize(ts: TypeScriptApi, sourceFile: SourceFile, { excluded = null }: { excluded?: Set<Node> | null } = {}): TokenizedFile {
  const { SyntaxKind } = ts;
  const walk: TokenWalk = { ts, sourceFile, kinds: [], lines: [], types: [], segments: [], segment: 0, excluded,
    lineStarts: sourceFile.getLineStarts(), literalKinds: literalKindSet(SyntaxKind) };
  for (const statement of sourceFile.statements) {
    if (!isDroppedStatement(SyntaxKind, statement)) visitToken(walk, statement, false);
  }
  return { kinds: Int32Array.from(walk.kinds), lines: Int32Array.from(walk.lines), types: Uint8Array.from(walk.types), segments: Int32Array.from(walk.segments) };
}

/** The app a file belongs to, by the slot binding of the manifest; null for a file of no app. */
const appOfFile = (resolver: Resolver, rel: string): string | null => resolver.classifyPath(rel).bindings?.app ?? null;

/** True for the app entry and the transport doors: their shape is fixed by the convention and their body cannot hold logic. */
function uniformByDesign(resolver: Resolver, rel: string): boolean {
  const classified = resolver.classifyPath(rel);
  if (classified.status !== 'owned' || !classified.slot) return false;
  const slot = resolver.slot(classified.slot);
  if (!slot) return false;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (slot.appKind !== undefined) return base === APP_ENTRY && (slot.requires ?? []).includes(APP_ENTRY);
  const role = base.split('.').at(-2);
  return !slot.owner && (slot.composedBy?.length ?? 0) > 0 && role !== undefined && DOOR_ROLES.has(role) && base.endsWith('.ts');
}

function homeText(profile: string, sameOwner: boolean, crossApp: boolean): string {
  if (crossApp) return 'move it to a package (packages/<pkg>, the shared-code slot of the repository) and import it from both apps';
  if (sameOwner) return 'extract it once inside the owner and call it from both places';
  if (profile === 'fe') return 'extract it once inside the app (apps/<app>/src/modules/<capability>/ when pure, apps/<app>/src/hooks/<domain>/ for a React hook) and import it from both';
  return "move the shared helper to src/modules/platform/primitives/ or into the owning capability's src/modules/domain/<capability>/ and import it from both";
}

const cloneBuckets = (entries: CloneEntry[], N: number, T: number): Buckets => {
  const B1 = 1000003;
  const B2 = 92821;
  let maxTokens = 0;
  for (const file of entries) maxTokens = Math.max(maxTokens, file.kinds.length);
  const pow1 = new Int32Array(maxTokens + 1);
  const pow2 = new Int32Array(maxTokens + 1);
  pow1[0] = 1; pow2[0] = 1;
  for (let i = 1; i <= maxTokens; i += 1) { pow1[i] = Math.imul(pow1[i - 1] as number, B1); pow2[i] = Math.imul(pow2[i - 1] as number, B2); }
  const buckets: Buckets = new Map();
  const hashing: Hashing = { pow1, pow2, B1, B2 };
  entries.forEach((file, fileIndex) => addFileWindows(buckets, file, fileIndex, N, T, hashing));
  return buckets;
};

function signedInt32(value: number): number {
  return Math.imul(value, 1);
}

const prefixHashes = (kinds: Int32Array, B1: number, B2: number) => {
  const count = kinds.length;
  const pre1 = new Int32Array(count + 1);
  const pre2 = new Int32Array(count + 1);
  for (let i = 0; i < count; i += 1) {
    pre1[i + 1] = Math.imul(pre1[i] as number, B1) + (kinds[i] as number) + 3;
    pre2[i + 1] = Math.imul(pre2[i] as number, B2) + (kinds[i] as number) + 7;
  }
  return { pre1, pre2 };
};

const windowKey = (pre: Int32Array, pow: Int32Array, start: number, end: number): number => signedInt32((pre[end] as number) - Math.imul(pre[start] as number, pow[end - start] as number));

const addToBucket = (buckets: Buckets, key: string, item: Window) => {
  const list = buckets.get(key);
  if (list) list.push(item); else buckets.set(key, [item]);
};

const addFileWindows = (buckets: Buckets, file: CloneEntry, fileIndex: number, N: number, T: number, hashing: Hashing) => {
  const { pow1, pow2, B1, B2 } = hashing;
  const { kinds, lines, segments } = file;
  const count = kinds.length;
  const { pre1, pre2 } = prefixHashes(kinds, B1, B2);
  let end = 0;
  for (let start = 0; start < count; start += 1) {
    if (start > 0 && lines[start] === lines[start - 1] && segments[start] === segments[start - 1]) continue;
    const limit = (lines[start] as number) + N;
    if (end < start) end = start;
    while (end < count && (lines[end] as number) < limit && segments[end] === segments[start]) end += 1;
    if (end === start || (lines[end - 1] as number) - (lines[start] as number) + 1 < N) continue;
    const length = end - start;
    if (length < T) continue;
    const key = `${windowKey(pre1, pow1, start, end)}:${windowKey(pre2, pow2, start, end)}:${length}`;
    addToBucket(buckets, key, [fileIndex, start, end]);
  }
};

const sameTokens = (entries: CloneEntry[], a: Window, b: Window): boolean => {
  const ka = entryAt(entries, a[0]).kinds;
  const kb = entryAt(entries, b[0]).kinds;
  for (let i = 0; i < a[2] - a[1]; i += 1) if (ka[a[1] + i] !== kb[b[1] + i]) return false;
  return true;
};

/** The first other occurrence is the partner; overlapping windows of one file are one occurrence, not a copy. */
const partnerOf = (list: Window[], item: Window): Window | undefined => list.find((other) => other !== item && (other[0] !== item[0] || other[1] >= item[2] || item[1] >= other[2]));

const orderedPair = (entries: CloneEntry[], item: Window, partner: Window): [Window, Window] => {
  const sameFile = entryAt(entries, item[0]).rel === entryAt(entries, partner[0]).rel;
  const itemFirst = sameFile ? item[1] < partner[1] : entryAt(entries, item[0]).rel < entryAt(entries, partner[0]).rel;
  return itemFirst ? [item, partner] : [partner, item];
};

const addHit = (hits: Hits, a: Window, b: Window) => {
  const key = `${a[0]}|${b[0]}|${b[1] - a[1]}`;
  const group = hits.get(key);
  if (group) group.push([a[1], a[2]]); else hits.set(key, [[a[1], a[2]]]);
};

const cloneHits = (entries: CloneEntry[], buckets: Buckets): Hits => {
  const hits: Hits = new Map();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (const item of list) {
      const partner = partnerOf(list, item);
      if (!partner || !sameTokens(entries, item, partner)) continue;
      const [a, b] = orderedPair(entries, item, partner);
      addHit(hits, a, b);
    }
  }
  return hits;
};

const blockShape = (file: CloneEntry, start: number, end: number) => {
  const nonType = new Set<number>();
  const shapes = new Map<number, number>();
  for (let i = start; i < end; i += 1) {
    const line = file.lines[i] as number;
    if (!file.types[i]) nonType.add(line);
    shapes.set(line, signedInt32((shapes.get(line) ?? 7) * 31 + (file.kinds[i] as number) + 5));
  }
  return { nonType: nonType.size, distinct: new Set(shapes.values()).size };
};

const appendCloneBlock = (blocks: CloneBlock[], fileA: CloneEntry, fileB: CloneEntry, start: number, end: number, diag: number, N: number) => {
  const shape = blockShape(fileA, start, end);
  if (shape.nonType < Math.ceil(N / 2) || shape.distinct < Math.ceil(N / 3)) return;
  const lineA = fileA.lines[start] as number;
  const endA = fileA.lines[end - 1] as number;
  blocks.push({ a: fileA, b: fileB, line: lineA, endLine: endA, lines: endA - lineA + 1,
    twin: { path: fileB.rel, line: fileB.lines[start + diag] as number, endLine: fileB.lines[end - 1 + diag] as number } });
};

const cloneBlocks = (entries: CloneEntry[], hits: Hits, N: number): CloneBlock[] => {
  const blocks: CloneBlock[] = [];
  for (const [key, group] of hits) {
    const [ai, bi, diagText] = key.split('|');
    const fileA = entryAt(entries, Number(ai));
    const fileB = entryAt(entries, Number(bi));
    const diag = Number(diagText);
    group.sort((x, y) => x[0] - y[0]);
    let [start, end] = group[0] as [number, number];
    for (const [nextStart, nextEnd] of group.slice(1)) {
      if (nextStart <= end && fileA.segments[nextStart] === fileA.segments[start]
        && fileB.segments[nextStart + diag] === fileB.segments[start + diag]) { end = Math.max(end, nextEnd); continue; }
      appendCloneBlock(blocks, fileA, fileB, start, end, diag, N);
      start = nextStart; end = nextEnd;
    }
    appendCloneBlock(blocks, fileA, fileB, start, end, diag, N);
  }
  return blocks;
};

const differentApps = (resolver: Resolver, a: string, b: string): boolean => {
  const left = appOfFile(resolver, a);
  const right = appOfFile(resolver, b);
  return left !== null && right !== null && left !== right;
};

const cloneViolations = (blocks: CloneBlock[], resolver: Resolver, profile: string, N: number, T: number): ArchitectureViolation[] => {
  blocks.sort((x, y) => x.a.rel.localeCompare(y.a.rel) || x.line - y.line || x.b.rel.localeCompare(y.b.rel));
  return blocks.slice(0, MAX_VIOLATIONS).map((block) => ({
    ruleId: 'HFS_DUPLICATE_CODE', path: block.a.rel, line: block.line, endLine: block.endLine, twin: block.twin, lines: block.lines,
    message: `${block.a.rel}:${block.line}-${block.endLine} duplicates ${block.twin.path}:${block.twin.line}-${block.twin.endLine} (${block.lines} lines, threshold ${N} lines / ${T} tokens, identifiers and literals ignored); ${homeText(profile, block.a.unit === block.b.unit, differentApps(resolver, block.a.rel, block.b.rel))}.`,
  }));
};

const cloneCoverage = (entries: CloneEntry[], blocks: CloneBlock[], N: number, T: number) => {
  const owners = new Set<string>();
  let duplicatedLines = 0;
  for (const block of blocks) { owners.add(block.a.unit); owners.add(block.b.unit); duplicatedLines += block.lines; }
  return { status: 'checked', minLines: N, minTokens: T, files: entries.length, cloneBlocks: blocks.length, ownersInvolved: owners.size, duplicatedLines,
    ...(blocks.length > MAX_VIOLATIONS ? { truncated: true } : {}) };
};

export function checkClones({ context, graph }: CheckInput) {
  // reason: the rule-params validators require duplicateBlock on every profile that runs this check
  const { lines: N, tokens: T } = graph.resolver.ruleParams()?.duplicateBlock as NonNullable<RuleParams['duplicateBlock']>;
  const ts = context.ts ?? (context as CloneContext).loaded.ts;
  const entries: CloneEntry[] = [];
  for (const rel of [...graph.files.keys()].sort(byCodeUnit)) {
    if (/\.d\.[cm]?tsx?$/.test(rel) || uniformByDesign(graph.resolver, rel)) continue;
    const unit = graph.unit(rel);
    if (!unit) continue;
    const sourceFile = (graph.files.get(rel) as GraphFile).sourceFile;
    entries.push({ rel, unit, ...tokenize(ts, sourceFile, { excluded: canonCloneNodes(ts, sourceFile, graph.profile) }) });
  }
  const buckets = cloneBuckets(entries, N, T);
  const blocks = cloneBlocks(entries, cloneHits(entries, buckets), N);
  const profile = graph.profile;
  const violations = cloneViolations(blocks, graph.resolver, profile, N, T);
  return { violations, coverage: cloneCoverage(entries, blocks, N, T) };
}

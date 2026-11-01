import fs from 'node:fs';
import path from 'node:path';
import { byCodeUnit } from '../../lib/list.mjs';
import type { ArchitectureViolation, CheckInput } from './hfs-graph.mjs';

/**
 * The component tier ladder, checked on the source of a component library and of a component tree.
 *
 *   GRAMMAR_TIER_DIRECTION  a grammar component imports a tier above it (the ladder leaf, branch, composite, frame: a tier imports
 *                           nothing above itself), type-only imports included, through a shared untiered module as well;
 *                           `tiers.grammar` of knowledge/hfs/slots.yaml is the matrix
 *   GRAMMAR_TIER_STAMP      a `data-tier` stamp names a tier other than the folder the file sits in (`atom`, `primitive` and
 *                           `composition` are not tiers)
 *   FE_TIER_DIRECTION       (layers) a component imports a layer at or above its own: blocks, frames, composites, branches, leaves
 *
 * A library is a folder holding `src/core/<tier>/<Name>/`; a tree is a folder holding `components/<layer>/<Unit>/` that no hfs
 * front-end slot already judges (an app without hfs.json, such as the harness desktop app).
 */
export const COMPONENT_TIER_RULE_IDS = ['GRAMMAR_TIER_DIRECTION', 'GRAMMAR_TIER_STAMP'];

/** One tier of the matrix: the tiers it may import. */
export interface TierMatrixEntry { mayImport: readonly string[] }
/** The result of a check: findings and the coverage line. */
export interface ComponentTierResult { violations: ArchitectureViolation[]; coverage: { status: string; [field: string]: unknown } }

const SKIPPED = new Set(['node_modules', '.git', 'dist', '.next', 'storybook-static', 'proof']);
const SOURCE = /\.(?:ts|tsx)$/u;
const TEST_OR_STORY = /\.(?:stories|spec|test)\.[jt]sx?$/u;
const IMPORT = /(?:\bimport|\bexport)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;
const STAMP = /["']?data-tier["']?\s*[=:]\s*\{?\s*["']([a-z-]+)["']/gu;
const LIBRARY_FILE = /^(.*?)src\/core\/(leaf|branch|composite|frame)\/([^/]+)\//u;

function walk(root: string, dir = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts') && !TEST_OR_STORY.test(entry.name)) out.push(rel);
  }
  return out;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** The file an import specifier names, as a repo-relative path in `files`, or null (a package, or a file outside the walk). */
function resolveImport(files: ReadonlySet<string>, from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).replace(/\.(?:js|mjs|cjs)$/u, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) if (files.has(candidate)) return candidate;
  return null;
}

interface Edge { to: string; line: number; specifier: string }

function edgesOf(root: string, files: ReadonlySet<string>, cache: Map<string, { text: string; edges: Edge[] }>, file: string) {
  const cached = cache.get(file);
  if (cached) return cached;
  const text = fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
  const edges: Edge[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? '';
    const to = resolveImport(files, file, specifier);
    if (to !== null) edges.push({ to, line: lineOf(text, match.index ?? 0), specifier });
  }
  const entry = { text, edges };
  cache.set(file, entry);
  return entry;
}

/** The tier (the folder under `src/core`) and the component of a grammar source file, or null for a file outside the ladder. */
const gradeOf = (file: string): { tier: string; unit: string } | null => {
  const match = LIBRARY_FILE.exec(file);
  return match === null ? null : { tier: match[2] as string, unit: `${match[1]}${match[2]}/${match[3]}` };
};

/**
 * Check the component libraries under `root` against `matrix` (`tiers.grammar`). Not applicable when no folder holds
 * `src/core/<tier>/<Name>/`. A file outside the tier folders (a shared helper under `src/core`) is not a tier, but an import that
 * reaches a higher tier through it is the importing tier's edge.
 */
export function checkGrammarLibraries({ root, matrix }: { root: string; matrix: Readonly<Record<string, TierMatrixEntry>> }): ComponentTierResult {
  const all = walk(root).filter(file => /(?:^|\/)src\//u.test(file));
  const library = all.filter(file => gradeOf(file) !== null);
  if (!library.length) return { violations: [], coverage: { status: 'not-applicable' } };
  const files = new Set(all);
  const cache = new Map<string, { text: string; edges: Edge[] }>();
  const violations: ArchitectureViolation[] = [];
  const tiers = new Set(Object.keys(matrix));
  let edgesChecked = 0;
  let stamps = 0;
  for (const file of library.sort(byCodeUnit)) {
    const from = gradeOf(file) as { tier: string; unit: string };
    const { text, edges } = edgesOf(root, files, cache, file);
    for (const stamp of text.matchAll(STAMP)) {
      stamps += 1;
      if (stamp[1] !== from.tier) {
        violations.push({ ruleId: 'GRAMMAR_TIER_STAMP', path: file, line: lineOf(text, stamp.index ?? 0), column: 1,
          message: `${file} stamps data-tier="${stamp[1]}" and sits in the ${from.tier} folder: the stamp is the folder (${[...tiers].join(', ')}).` });
      }
    }
    // Follow shared untiered modules, so a leaf cannot reach a frame by one hop of indirection.
    const queue = edges.map(edge => ({ edge, via: [] as string[] }));
    const seen = new Set<string>();
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const { edge, via } = next;
      const target = gradeOf(edge.to);
      if (target === null) {
        if (seen.has(edge.to) || !edge.to.includes('/src/') && !edge.to.startsWith('src/')) continue;
        seen.add(edge.to);
        for (const onward of edgesOf(root, files, cache, edge.to).edges) queue.push({ edge: { ...onward, line: edge.line }, via: [...via, edge.to] });
        continue;
      }
      if (target.unit === from.unit) continue;
      edgesChecked += 1;
      if ((matrix[from.tier]?.mayImport ?? []).includes(target.tier)) continue;
      violations.push({ ruleId: 'GRAMMAR_TIER_DIRECTION', path: file, line: edge.line, column: 1, specifier: edge.specifier, resolvedPath: edge.to,
        message: `${file} (${from.tier}) imports ${edge.to} (${target.tier})${via.length ? ` through ${via.join(' -> ')}` : ''}: a ${from.tier} may import only ${(matrix[from.tier]?.mayImport ?? []).join(', ') || 'nothing'}. Type-only imports count.` });
    }
  }
  const unique = new Map(violations.map(violation => [`${violation.ruleId}|${violation.path}|${violation.line}|${violation.resolvedPath ?? ''}`, violation]));
  return { violations: [...unique.values()], coverage: { status: 'checked', files: library.length, edgesChecked, stamps } };
}

const LAYER_FILE = /^(.*?)components\/([^/]+)\/([^/]+)\//u;

/**
 * Check a component tree under `root` that no hfs slot judges: a component imports only the layers after its own (`layers` in order,
 * the first layer imports all below it). The layers are the folder names of slot fe.components.
 */
export function checkComponentLayers({ root, layers }: { root: string; layers: readonly string[] }): ComponentTierResult {
  const all = walk(root).filter(file => /(?:^|\/)src\//u.test(file));
  const placed = (file: string): { layer: number; unit: string } | null => {
    const match = LAYER_FILE.exec(file);
    const layer = match === null ? -1 : layers.indexOf(match[2] as string);
    return match === null || layer < 0 ? null : { layer, unit: `${match[1]}components/${match[2]}/${match[3]}` };
  };
  const tree = all.filter(file => placed(file) !== null);
  if (!tree.length) return { violations: [], coverage: { status: 'not-applicable' } };
  const files = new Set(all);
  const cache = new Map<string, { text: string; edges: Edge[] }>();
  const violations: ArchitectureViolation[] = [];
  let edgesChecked = 0;
  for (const file of tree.sort(byCodeUnit)) {
    const from = placed(file) as { layer: number; unit: string };
    for (const edge of edgesOf(root, files, cache, file).edges) {
      const target = placed(edge.to);
      if (target === null || target.unit === from.unit) continue;
      edgesChecked += 1;
      if (target.layer > from.layer) continue;
      violations.push({ ruleId: 'FE_TIER_DIRECTION', path: file, line: edge.line, column: 1, specifier: edge.specifier, resolvedPath: edge.to,
        message: `${file}: a ${layers[from.layer]} component may import only the layers after it (${layers.slice(from.layer + 1).join(', ') || 'none'}); it imports a ${layers[target.layer]}. Type-only imports count.` });
    }
  }
  return { violations, coverage: { status: 'checked', files: tree.length, edgesChecked } };
}

/** The machine check: the grammar libraries of the repository, judged by `tiers.grammar` of the slot manifest. */
export function checkGrammarTiers({ config }: CheckInput): ComponentTierResult {
  const matrix = (config.hfs.manifest.tiers as Record<string, Record<string, TierMatrixEntry> | undefined>).grammar;
  if (matrix === undefined) return { violations: [], coverage: { status: 'not-applicable' } };
  return checkGrammarLibraries({ root: config.root, matrix });
}

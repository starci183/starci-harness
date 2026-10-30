// lint-family.mts - the `lint` family of the app check cache (contexts/project/check-cache.md, ESLint and stylelint): the per-file results of ESLint
// and stylelint, judged again only for what a change can have altered, on the records of `.starcistacks/cache/lint/<side>/`.
//
// ESLint's own `--cache` is not used. A file's result is reused when the side key is unchanged, or when the file is outside the dirty set:
//   1. the files that changed (hash differs from the record, added, removed) and every file that reaches one through imports, in the new import
//      graph and the recorded one (import-graph.mts); a changed file that declares globals dirties the whole side;
//   2. every file whose project-graph findings (duplicate code, unused exports, tier direction, ...) differ from the recorded ones, taken from the
//      installed canon's own `projectGraph` run once over the side; ESLint itself lints that file again, so ESLint stays the only emitter of a message;
//   3. every file whose declared cross-file inputs (`crossFileInputs` of the canons: siblings, listings, manifests, stylesheets) differ from the
//      digest recorded with its result. A canon without the declaration makes the side a whole-side lint.
// The dirty set is linted by the same launcher, chunking and result validation as a full run (the `eslint` and `stylelint` seams); the rest of the
// scope takes its record. Everything the family needs of the world is a seam, so a spec drives it with a fake session and a fake linter.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type TypeScript from 'typescript';
import { braceVariants, globExpression } from '../runtime/scripts/lib/glob.mjs';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { buildImportGraph, dirtySetOf, posix, type GraphBuild, type ImportGraph, type ImportNode } from './import-graph.mjs';
import { canonicalJson, reconcile, sortFindings } from './jsonl.mjs';
import type { CacheRecord, CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

type Ts = typeof TypeScript;

/** Record steps of the `lint/<side>` folder. */
export const LINT_STEPS = Object.freeze({ eslint: 'eslint', stylelint: 'stylelint', imports: 'imports', graph: 'graph', meta: 'meta' });
/** The record path of the side's own record (no file of the tree holds it). */
export const SIDE_RECORD = '.side';

/** One input a rule reads that the import graph does not carry (`crossFileInputs` of a canon; see its cross-file-inputs.ts). */
export interface CrossFileInput {
  readonly rule: string;
  readonly kind: 'content' | 'exists';
  readonly relativeTo: 'file' | 'side';
  readonly globs: readonly string[];
  readonly appliesTo: readonly string[];
  readonly reader?: string;
}
/** One finding of the canon's project graph on a file. */
export interface GraphFinding { readonly rule: string; readonly code: string; readonly line: number; readonly column: number; readonly message: string }
/** What a canon's `projectGraph` export answers. */
export interface GraphSnapshot { readonly files?: number; readonly byFile: Readonly<Record<string, readonly GraphFinding[]>> }

/** What the family needs to know of one installed canon (an ESLint canon, a grammar family, the stylelint canon). */
export interface CanonDeclarations {
  /** The package name, for the reason line. */
  readonly name: string;
  /** Its `crossFileInputs`, or null when the installed canon does not declare them (the side is then linted whole). */
  readonly crossFileInputs: readonly CrossFileInput[] | null;
  /** Whether the canon publishes project-graph rules. */
  readonly graphRules: boolean;
  /** Its `projectGraph` export; null when it publishes graph rules without the export (the side is then linted whole). */
  readonly projectGraph: ((input: { repoRoot: string }) => GraphSnapshot) | null;
}

/** The fields of an ESLint result the cache keeps and rebuilds. */
export interface EslintMessage { ruleId: string | null; message: string; line?: number; column?: number; endLine?: number; severity?: number; [key: string]: unknown }
export interface EslintResult { filePath: string; messages: EslintMessage[]; [key: string]: unknown }
/** The fields of a stylelint result the cache keeps and rebuilds. */
export interface StylelintWarning { rule: string; text: string; line?: number; column?: number; endLine?: number; severity?: string; [key: string]: unknown }
export interface StylelintResult { source: string; warnings: StylelintWarning[]; [key: string]: unknown }

/** The answer of a linter seam: validated results of the files it was asked about, or why it could not complete. */
export interface LinterOutcome<R> { results: R[]; errors: string[] }

/** Everything one side's cached lint needs. */
export interface LintSideInput {
  session: CheckSession;
  side: string;
  /** The absolute side folder, where the linters run from. */
  sideRoot: string;
  /** The canon scope of the side, enumerated afresh: side-relative posix source files. */
  scope: readonly string[];
  /** The stylesheets stylelint judges (fe only): side-relative posix; empty otherwise. */
  stylesheets: readonly string[];
  /** The files this run reports when it reports part of a side (a workspace lint); null reports the whole side. A partial run never writes. */
  report: ((file: string) => boolean) | null;
  /** The ESLint canon, its grammar family, in config order. */
  canons: readonly CanonDeclarations[];
  /** The stylelint canon; null when the side has no stylesheet judge. */
  styleCanon: CanonDeclarations | null;
  /** The app's own TypeScript, for the import graph. */
  typescript: () => Ts;
  /** A digest of the side's untracked program inputs (generated code the program reads); a change dirties the side. */
  extraKey: string;
  /** Set for `--full` or a full decision: ignore the records and rewrite them. */
  full: string | null;
  /** Whether this run may write the side's records. */
  write: boolean;
  /** ESLint over `files` (side-relative), or over the whole requested scope when null; results already validated and with app-relative messages. */
  eslint: (files: readonly string[] | null) => Promise<LinterOutcome<EslintResult>>;
  /** stylelint over `files`, or over the whole glob when null. Absent when the side has no stylesheet judge. */
  stylelint: ((files: readonly string[] | null) => Promise<LinterOutcome<StylelintResult>>) | null;
}

/** What one side's lint reports back to the verb. */
export interface LintSideOutcome {
  eslint: EslintResult[];
  stylelint: StylelintResult[];
  errors: string[];
  stats: LintSideStats;
}
/** The counts and the reason of a side, for the family line. */
export interface LintSideStats {
  mode: 'full' | 'diff';
  reason: string;
  checked: number;
  reused: number;
  newFindings: number;
  knownFindings: number;
  fixedFindings: number;
  written: boolean;
}

// ---------------------------------------------------------------------------------------------------- findings <-> records

const byLocation = (a: { line: number; column: number; rule: string; message: string; end: number }, b: { line: number; column: number; rule: string; message: string; end: number }): number =>
  a.line - b.line || a.column - b.column || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0) || a.end - b.end;

interface Located { line: number; column: number; rule: string; message: string; end: number }

/** The findings of a record in the order they are stored, with their end lines. */
function fromEslint(side: string, file: string, result: EslintResult): { findings: Finding[]; ends: number[] } {
  const located: Located[] = result.messages.map((message) => ({
    line: message.line ?? 0, column: message.column ?? 0, rule: message.ruleId ?? 'eslint-error', message: message.message, end: message.endLine ?? 0,
  }));
  located.sort(byLocation);
  return { findings: located.map((entry): Finding => ({ path: `${side}/${file}`, line: entry.line, column: entry.column, rule: entry.rule, message: entry.message })), ends: located.map((entry) => entry.end) };
}

function fromStylelint(side: string, file: string, result: StylelintResult): { findings: Finding[]; ends: number[] } {
  const located: Located[] = result.warnings.map((warning) => ({
    line: warning.line ?? 0, column: warning.column ?? 0, rule: warning.rule || 'stylelint-error', message: warning.text, end: warning.endLine ?? 0,
  }));
  located.sort(byLocation);
  return { findings: located.map((entry): Finding => ({ path: `${side}/${file}`, line: entry.line, column: entry.column, rule: entry.rule, message: entry.message })), ends: located.map((entry) => entry.end) };
}

const endsOf = (record: CacheRecord): number[] => {
  const data = record.data;
  const ends = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as { [key: string]: JsonValue })['ends'] : undefined;
  return Array.isArray(ends) ? ends.map((value) => (typeof value === 'number' ? value : 0)) : [];
};

const crossOf = (record: CacheRecord | undefined): string | undefined => {
  const data = record?.data;
  const cross = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as { [key: string]: JsonValue })['cross'] : undefined;
  return typeof cross === 'string' ? cross : undefined;
};

/** The ESLint result a record stands for. */
function toEslint(sideRoot: string, file: string, record: CacheRecord): EslintResult {
  const ends = endsOf(record);
  return {
    filePath: path.join(sideRoot, file),
    messages: record.findings.map((finding, at): EslintMessage => ({
      ruleId: finding.rule === 'eslint-error' ? null : finding.rule, message: finding.message, line: finding.line, column: finding.column,
      ...((ends[at] ?? 0) > 0 ? { endLine: ends[at] as number } : {}), severity: 2,
    })),
  };
}

function toStylelint(sideRoot: string, file: string, record: CacheRecord): StylelintResult {
  const ends = endsOf(record);
  return {
    source: path.join(sideRoot, file),
    warnings: record.findings.map((finding, at): StylelintWarning => ({
      rule: finding.rule === 'stylelint-error' ? '' : finding.rule, text: finding.message, line: finding.line, column: finding.column,
      ...((ends[at] ?? 0) > 0 ? { endLine: ends[at] as number } : {}), severity: 'error',
    })),
  };
}

const keyOf = (finding: Finding): string => `${finding.path}\0${finding.line}\0${finding.column}\0${finding.rule}\0${finding.message}`;

// ---------------------------------------------------------------------------------------------------- cross-file inputs

/** The anchored expressions of a glob (braces expanded). */
const expressions = (glob: string): RegExp[] => braceVariants(glob).map((variant) => globExpression(variant));
const matchesAny = (patterns: readonly RegExp[], file: string): boolean => patterns.some((pattern) => pattern.test(file));

/**
 * The digest of what the declared cross-file inputs of `file` hold now: for each declaration that applies, the matching paths of the app with
 * their hashes (`content`) or alone (`exists`). Undefined when no declaration applies. `paths` are app-relative; side-relative globs are
 * resolved below `<side>/`, so a glob may step out of the side with `../` to the app root.
 */
export function crossDigestFactory(options: {
  side: string;
  declarations: readonly CrossFileInput[];
  paths: readonly string[];
  hashOf: (appRelative: string) => string | undefined;
}): (file: string) => string | undefined {
  const { side, declarations, paths, hashOf } = options;
  const compiled = declarations.map((declaration) => ({ declaration, applies: declaration.appliesTo.flatMap(expressions) }));
  const cache = new Map<string, string>();
  const matched = (index: number, directory: string): string => {
    const declaration = (declarations[index] as CrossFileInput);
    const key = `${index}\0${declaration.relativeTo === 'file' ? directory : ''}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const base = declaration.relativeTo === 'file' ? path.posix.join(side, directory) : side;
    const patterns = declaration.globs.flatMap((glob) => expressions(path.posix.normalize(path.posix.join(base, glob))));
    const lines = paths.filter((candidate) => matchesAny(patterns, candidate)).sort()
      .map((candidate) => (declaration.kind === 'content' ? `${candidate}\0${hashOf(candidate) ?? 'absent'}` : candidate));
    const digest = hashText(lines.join('\n'));
    cache.set(key, digest);
    return digest;
  };
  return (file) => {
    const parts: Record<string, string> = {};
    compiled.forEach((entry, index) => {
      if (!matchesAny(entry.applies, file)) return;
      parts[`${index}:${entry.declaration.rule}:${entry.declaration.kind}`] = matched(index, path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file));
    });
    return Object.keys(parts).length === 0 ? undefined : combineHashes(parts);
  };
}

// ---------------------------------------------------------------------------------------------------- the app's TypeScript

/** The TypeScript the app installed, resolved from the side folder like the linters are (not this package's own copy). */
export function loadAppTypeScript(sideRoot: string): Ts {
  const require = createRequire(path.join(sideRoot, 'package.json'));
  return require('typescript') as Ts;
}

// ---------------------------------------------------------------------------------------------------- one side

const readText = (file: string): string | null => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};
const isFile = (file: string): boolean => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
};

/** A record's `data` object, or an empty one. */
const dataOf = (record: CacheRecord): { readonly [key: string]: JsonValue } => (record.data !== null && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as { [key: string]: JsonValue } : {});

/** The graph findings of every canon that publishes graph rules, merged by file and sorted. */
function mergedSnapshot(sideRoot: string, canons: readonly CanonDeclarations[]): Record<string, GraphFinding[]> | null {
  const merged: Record<string, GraphFinding[]> = {};
  for (const canon of canons) {
    if (!canon.graphRules) continue;
    if (canon.projectGraph === null) return null;
    for (const [file, findings] of Object.entries(canon.projectGraph({ repoRoot: sideRoot }).byFile)) merged[posix(file)] = [...(merged[posix(file)] ?? []), ...findings];
  }
  for (const list of Object.values(merged)) list.sort((a, b) => a.line - b.line || a.column - b.column || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  return merged;
}

const graphRecordFindings = (side: string, file: string, findings: readonly GraphFinding[]): Finding[] =>
  sortFindings(findings.map((finding): Finding => ({ path: `${side}/${file}`, line: finding.line, column: finding.column, rule: finding.code, message: finding.message })));

/**
 * Judges one side: ESLint (and, for fe, stylelint) over what the records cannot vouch for, the records of the rest, and the new records.
 * Never throws for a tool failure: those come back in `errors`, and a side with an error stores nothing.
 */
export async function lintSide(input: LintSideInput): Promise<LintSideOutcome> {
  const { session, side, sideRoot, scope, stylesheets } = input;
  const inReport = input.report ?? ((): boolean => true);
  const scopeSet = new Set(scope);
  const styleSet = new Set(stylesheets);
  const folder = `lint/${side}`;
  const prefix = `${side}/`;
  const errors: string[] = [];
  const abs = (file: string): string => path.join(sideRoot, file);

  // what the tree holds now
  const memo = new Map<string, string | undefined>();
  const hashOf = (file: string): string | undefined => {
    if (!memo.has(file)) memo.set(file, session.index.hashOf(`${prefix}${file}`) ?? hashFile(abs(file)));
    return memo.get(file);
  };
  const trackedHere = session.index.paths.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
  const sidePaths = [...new Set([...trackedHere, ...scope, ...stylesheets])].sort();
  const sideKey = combineHashes(Object.fromEntries(sidePaths.map((file) => [file, hashOf(file) ?? 'absent'])));
  const pathsDigest = hashText(sidePaths.join('\n'));
  const appHash = (appRelative: string): string | undefined => session.index.hashOf(appRelative) ?? (appRelative.startsWith(prefix) ? hashOf(appRelative.slice(prefix.length)) : hashFile(path.join(session.root, appRelative)));
  const appPaths = [...new Set([...session.index.paths, ...scope.map((file) => `${prefix}${file}`), ...stylesheets.map((file) => `${prefix}${file}`)])];

  // what the cache holds
  const stored = session.records(folder);
  const ofStep = (step: string): CacheRecord[] => stored.filter((record) => record.step === step);
  const validEslint = new Map(reconcile(ofStep(LINT_STEPS.eslint), hashOf).map((record) => [record.path, record]));
  const validStyle = new Map(reconcile(ofStep(LINT_STEPS.stylelint), hashOf).map((record) => [record.path, record]));
  const meta = ofStep(LINT_STEPS.meta).find((record) => record.path === SIDE_RECORD);
  const metaData = meta === undefined ? {} : dataOf(meta);
  const previousFindings = new Set([...ofStep(LINT_STEPS.eslint), ...ofStep(LINT_STEPS.stylelint)].filter((record) => inReport(record.path)).flatMap((record) => record.findings.map(keyOf)));

  const progress = session.progress.step('lint', `lint ${side}`, scope.length + stylesheets.length);

  // ------------------------------------------------------------------ the plan
  let whole: string | null = input.full;
  let dirtyEslint = new Set<string>();
  let dirtyStyle = new Set<string>();
  let build: GraphBuild | null = null;
  let snapshot: Record<string, GraphFinding[]> | null = null;
  const crossEslint = new Map<string, string | undefined>();
  const crossStyle = new Map<string, string | undefined>();

  const sideUnchanged = whole === null && meta !== undefined && meta.hash === sideKey && metaData['extra'] === input.extraKey
    && scope.every((file) => validEslint.has(file)) && stylesheets.every((file) => validStyle.has(file))
    && ofStep(LINT_STEPS.eslint).every((record) => scopeSet.has(record.path)) && ofStep(LINT_STEPS.stylelint).every((record) => styleSet.has(record.path))
    // a file the program reads that is no lint source (a JSON module, untracked generated code) is part of the side too
    && ofStep(LINT_STEPS.imports).filter((record) => !scopeSet.has(record.path)).every((record) => hashOf(record.path) === record.hash);

  const crossFor = (canons: readonly CanonDeclarations[]): ((file: string) => string | undefined) =>
    crossDigestFactory({ side, declarations: canons.flatMap((canon) => canon.crossFileInputs ?? []), paths: appPaths, hashOf: appHash });
  const eslintCross = crossFor(input.canons);
  const styleCross = crossFor(input.styleCanon === null ? [] : [input.styleCanon]);
  if (!sideUnchanged) {
    for (const file of scope) crossEslint.set(file, eslintCross(file));
    for (const file of stylesheets) crossStyle.set(file, styleCross(file));
  }

  let reason = whole === null ? '' : `${whole}`;
  if (whole === null && !sideUnchanged) {
    // a plan only a changed side needs
    const undeclared = input.canons.find((canon) => canon.crossFileInputs === null);
    const styleUndeclared = input.styleCanon !== null && input.styleCanon.crossFileInputs === null;
    if (meta === undefined) whole = 'no recorded lint of this side';
    else if (metaData['extra'] !== input.extraKey) whole = 'the untracked program inputs of the side changed';
    else if (undeclared !== undefined) whole = `${undeclared.name} declares no crossFileInputs`;
    else if (input.canons.some((canon) => canon.graphRules && canon.projectGraph === null)) whole = `${input.canons.find((canon) => canon.graphRules)?.name ?? 'the canon'} exports no projectGraph`;
    if (whole === null) {
      try {
        const ts = input.typescript();
        const previous = new Map<string, ImportNode>();
        for (const record of ofStep(LINT_STEPS.imports)) {
          const data = dataOf(record);
          const imports = Array.isArray(data['imports']) ? (data['imports'] as JsonValue[]).filter((value): value is string => typeof value === 'string') : [];
          const kept = previous.get(record.path);
          if (kept === undefined || record.hash === hashOf(record.path)) previous.set(record.path, { hash: record.hash, imports, declaresGlobals: data['globals'] === true });
        }
        const recordedGraph: ImportGraph | null = previous.size === 0 ? null : previous;
        build = buildImportGraph({ ts, sideRoot, readText, fileExists: isFile, hashOf: (file) => hashOf(file) ?? null }, scope, recordedGraph, { pathsChanged: metaData['paths'] !== pathsDigest });
        const dirty = dirtySetOf(recordedGraph, build.graph);
        if (dirty.wholeSide !== null) whole = dirty.wholeSide;
        else dirtyEslint = new Set([...dirty.dirty].filter((file) => scopeSet.has(file)));
      } catch (error) {
        whole = `the import graph of the side cannot be built: ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}`;
      }
    }
    if (whole === null) {
      for (const file of scope) {
        const valid = validEslint.get(file);
        if (valid === undefined) dirtyEslint.add(file);
        else if (crossOf(valid) !== crossEslint.get(file)) dirtyEslint.add(file);
      }
      try {
        snapshot = mergedSnapshot(sideRoot, input.canons);
        if (snapshot === null) whole = 'a canon exports no projectGraph';
        else {
          const recorded = new Map(ofStep(LINT_STEPS.graph).filter((record) => record.hash === hashOf(record.path)).map((record) => [record.path, canonicalJson(record.findings)]));
          const files = new Set([...scope.filter((file) => validEslint.has(file)), ...recorded.keys()]);
          for (const file of files) {
            if (!scopeSet.has(file)) continue;
            const now = canonicalJson(graphRecordFindings(side, file, snapshot[file] ?? []));
            if ((recorded.get(file) ?? '[]') !== now) dirtyEslint.add(file);
          }
        }
      } catch (error) {
        whole = `the project graph of the side cannot be built: ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}`;
      }
    }
    // stylelint
    const recordedStyles = new Set(ofStep(LINT_STEPS.stylelint).map((record) => record.path));
    const styleChanged = [...recordedStyles].some((file) => !styleSet.has(file)) || stylesheets.some((file) => !recordedStyles.has(file));
    if (styleUndeclared) dirtyStyle = new Set(stylesheets);
    else if (styleChanged) dirtyStyle = new Set(stylesheets);
    else for (const file of stylesheets) {
      const valid = validStyle.get(file);
      if (valid === undefined || crossOf(valid) !== crossStyle.get(file)) dirtyStyle.add(file);
    }
    reason = whole ?? `${dirtyEslint.size} of ${scope.length} source files and ${dirtyStyle.size} of ${stylesheets.length} stylesheets differ from the cache`;
  } else if (whole === null) reason = 'the side key is unchanged';
  if (whole !== null) { dirtyEslint = new Set(scope); dirtyStyle = new Set(stylesheets); }

  // ------------------------------------------------------------------ the run
  const eslintList = [...dirtyEslint].filter(inReport).sort();
  const styleList = [...dirtyStyle].filter(inReport).sort();
  const freshEslint = new Map<string, EslintResult>();
  const freshStyle = new Map<string, StylelintResult>();
  const rootOf = (file: string): string => path.relative(sideRoot, file).replace(/\\/g, '/');
  if (eslintList.length > 0) {
    const run = await input.eslint(whole !== null ? null : eslintList);
    errors.push(...run.errors);
    for (const result of run.results) freshEslint.set(posix(rootOf(result.filePath)), result);
  }
  if (input.stylelint !== null && styleList.length > 0) {
    const run = await input.stylelint(whole !== null ? null : styleList);
    errors.push(...run.errors);
    for (const result of run.results) freshStyle.set(posix(rootOf(result.source)), result);
  }

  // ------------------------------------------------------------------ the answer
  const eslintResults: EslintResult[] = [];
  const styleResults: StylelintResult[] = [];
  const current: Finding[] = [];
  const eslintRecords: CacheRecord[] = [];
  const styleRecords: CacheRecord[] = [];
  const planHash = (file: string): string => hashOf(file) ?? 'absent';
  for (const file of scope) {
    if (!inReport(file)) continue;
    const fresh = freshEslint.get(file);
    const reuse = fresh === undefined ? validEslint.get(file) : undefined;
    if (fresh !== undefined) {
      eslintResults.push(fresh);
      const converted = fromEslint(side, file, fresh);
      current.push(...converted.findings);
      const cross = crossEslint.get(file);
      eslintRecords.push({ path: file, step: LINT_STEPS.eslint, hash: planHash(file), findings: converted.findings, data: { ends: converted.ends, ...(cross === undefined ? {} : { cross }) } });
    } else if (reuse !== undefined) {
      eslintResults.push(toEslint(sideRoot, file, reuse));
      current.push(...reuse.findings);
      eslintRecords.push(reuse);
    }
  }
  for (const file of stylesheets) {
    if (!inReport(file)) continue;
    const fresh = freshStyle.get(file);
    const reuse = fresh === undefined ? validStyle.get(file) : undefined;
    if (fresh !== undefined) {
      styleResults.push(fresh);
      const converted = fromStylelint(side, file, fresh);
      current.push(...converted.findings);
      const cross = crossStyle.get(file);
      styleRecords.push({ path: file, step: LINT_STEPS.stylelint, hash: planHash(file), findings: converted.findings, data: { ends: converted.ends, ...(cross === undefined ? {} : { cross }) } });
    } else if (reuse !== undefined) {
      styleResults.push(toStylelint(sideRoot, file, reuse));
      current.push(...reuse.findings);
      styleRecords.push(reuse);
    }
  }
  const checked = freshEslint.size + freshStyle.size;
  const units = [...scope, ...stylesheets].filter(inReport).length;
  const reused = Math.max(0, units - checked);
  progress.tick(units, reused, checked);
  progress.end();

  // ------------------------------------------------------------------ the records
  let written = false;
  const complete = errors.length === 0 && input.write && input.report === null && !sideUnchanged;
  if (complete) {
    const stable = [...freshEslint.keys(), ...freshStyle.keys()].every((file) => hashFile(abs(file)) === hashOf(file));
    if (stable) {
      const records: CacheRecord[] = [...eslintRecords, ...styleRecords];
      // without an import graph or a project graph the next run lints the side whole; the results themselves are still stored
      try {
        if (build === null) {
          const ts = input.typescript();
          build = buildImportGraph({ ts, sideRoot, readText, fileExists: isFile, hashOf: (file) => hashOf(file) ?? null }, scope, null);
        }
        for (const [file, node] of build.graph) records.push({ path: file, step: LINT_STEPS.imports, hash: node.hash, findings: [], data: { globals: node.declaresGlobals, imports: node.imports } });
        snapshot ??= mergedSnapshot(sideRoot, input.canons);
        for (const [file, findings] of Object.entries(snapshot ?? {})) {
          if (scopeSet.has(file) && findings.length > 0) records.push({ path: file, step: LINT_STEPS.graph, hash: planHash(file), findings: graphRecordFindings(side, file, findings) });
        }
      } catch {
        records.splice(0, records.length, ...records.filter((record) => record.step === LINT_STEPS.eslint || record.step === LINT_STEPS.stylelint));
      }
      records.push({ path: SIDE_RECORD, step: LINT_STEPS.meta, hash: sideKey, findings: [], data: { extra: input.extraKey, files: scope.length, paths: pathsDigest, stylesheets: stylesheets.length } });
      session.replace(folder, records);
      written = true;
    }
  }

  const currentKeys = new Set(current.map(keyOf));
  let knownFindings = 0;
  for (const key of currentKeys) if (previousFindings.has(key)) knownFindings += 1;
  const stats: LintSideStats = {
    mode: whole !== null || input.full !== null ? 'full' : 'diff',
    reason,
    checked,
    reused,
    newFindings: currentKeys.size - knownFindings,
    knownFindings,
    fixedFindings: [...previousFindings].filter((key) => !currentKeys.has(key)).length,
    written,
  };
  return { eslint: eslintResults, stylelint: styleResults, errors, stats };
}

/** The family line of a run over several sides: one report for the family, the sides' counts added and their reasons joined. */
export function lintFamilyReport(sides: readonly { side: string; stats: LintSideStats }[]): FamilyReport {
  const sum = (pick: (stats: LintSideStats) => number): number => sides.reduce((total, entry) => total + pick(entry.stats), 0);
  return {
    family: 'lint',
    mode: sides.length > 0 && sides.every((entry) => entry.stats.mode === 'full') ? 'full' : 'diff',
    reason: sides.map((entry) => `${entry.side}: ${entry.stats.reason}`).join('; '),
    checked: sum((stats) => stats.checked),
    reused: sum((stats) => stats.reused),
    newFindings: sum((stats) => stats.newFindings),
    knownFindings: sum((stats) => stats.knownFindings),
    fixedFindings: sum((stats) => stats.fixedFindings),
  };
}

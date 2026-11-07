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
import { lockEntries, packageDigests } from './fingerprint.mjs';
import { buildImportGraph, dirtySetOf, posix, type GraphBuild, type GraphHost, type ImportGraph, type ImportNode } from './import-graph.mjs';
import { canonicalJson, reconcile, sortFindings } from './jsonl.mjs';
import type { CacheRecord, CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

type Ts = typeof TypeScript;

/** The journal an ESLint run of a side streams to: `file` for one child, `part(i)` the file of the i-th of several parallel chunks (`part(0)` is `file`). */
export interface LintJournal { readonly file: string; part(index: number): string }

/** Record steps of the `lint/<side>` folder. */
export const LINT_STEPS = Object.freeze({ eslint: 'eslint', stylelint: 'stylelint', imports: 'imports', graph: 'graph', meta: 'meta' });
/** How many files one ESLint child judges before it appends their results to the journal: a kill loses at most this many (and the batch it was in). */
export const STREAM_BATCH = 250;
/** The record path of the side's own record (no file of the tree holds it). */
export const SIDE_RECORD = '.side';

/** One input a rule reads that the import graph does not carry (`crossFileInputs` of a canon; see its cross-file-inputs.ts). */
export interface CrossFileInput {
  readonly rule: string;
  readonly kind: 'content' | 'exists' | 'git';
  readonly relativeTo: 'file' | 'side';
  readonly globs: readonly string[];
  readonly appliesTo: readonly string[];
  /** For `git`: the line count above which the rule reads history; a shorter file does not depend on it. */
  readonly minLines?: number;
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
/** The ESLint result a journaled line stands for, or undefined when the line is not one (a foreign or damaged line): the child's `{ key, messages }` with each message as ESLint gave it. */
function journaledResult(line: unknown, sideRoot: string, relativize: ((message: string) => string) | undefined): EslintResult | undefined {
  if (line === null || typeof line !== 'object') return undefined;
  const { key, messages } = line as { key?: unknown; messages?: unknown };
  if (typeof key !== 'string' || !Array.isArray(messages) || key === '') return undefined;
  if (!messages.every((message: unknown) => message !== null && typeof message === 'object' && typeof (message as { message?: unknown }).message === 'string')) return undefined;
  return {
    filePath: path.join(sideRoot, key),
    messages: (messages as EslintMessage[]).map((message) => ({ ...message, message: relativize === undefined ? message.message : relativize(message.message) })),
  };
}

/** The fields of a stylelint result the cache keeps and rebuilds. */
export interface StylelintWarning { rule: string; text: string; line?: number; column?: number; endLine?: number; severity?: string; [key: string]: unknown }
export interface StylelintResult { source: string; warnings: StylelintWarning[]; [key: string]: unknown }

/**
 * The answer of a linter seam: validated results of the files it was asked about, or why it could not complete. `graph` is, for ESLint, the project-graph
 * snapshot each canon's graph rules built in the child, by canon name: the records of the `graph` step are written from it instead of building the graph again.
 */
export interface LinterOutcome<R> { results: R[]; errors: string[]; graph?: Readonly<Record<string, GraphSnapshot>> | undefined }

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
  /** The ESLint canon, its grammar family, in config order. */
  canons: readonly CanonDeclarations[];
  /** The stylelint canon; null when the side has no stylesheet judge. */
  styleCanon: CanonDeclarations | null;
  /** The app's own TypeScript, for the import graph. */
  typescript: () => Ts;
  /** A digest of the side's untracked program inputs (generated code the program reads); a change dirties the side. */
  extraKey: string;
  /** The merge-base of HEAD with the base branch (what the size-growth rules compare with), or a marker when there is none; `git` inputs depend on it. */
  gitToken?: string;
  /** Set for `--full` or a full decision: ignore the records and rewrite them. */
  full: string | null;
  /** Whether this run may write the side's records. */
  write: boolean;
  /**
   * ESLint over `files` (side-relative), or over the whole requested scope when null; results already validated and with app-relative messages. With `stream`
   * (always with a list) the child appends each batch of results to that journal file as it judges them (`STREAM_BATCH` files at a time), so a run cut short
   * keeps them.
   */
  eslint: (files: readonly string[] | null, stream?: LintJournal) => Promise<LinterOutcome<EslintResult>>;
  /** The side-relative to app-relative rewrite of a message (the launcher applies it to every result it returns); applied to journaled results, which are raw. */
  relativize?: ((message: string) => string) | undefined;
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
  /** The state of git history the `git` inputs stand for (the merge-base with the base branch); changes when the base moves. */
  gitToken?: string;
  /** The line count of a side-relative file, for the `git` inputs that matter only above a size. */
  lineCountOf?: (file: string) => number;
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
    const resolved = declaration.globs.map((glob) => path.posix.normalize(path.posix.join(base, glob)));
    const patterns = resolved.flatMap(expressions);
    // a glob can only match below the folder in front of its first wildcard; testing the other paths would cost a regular expression each
    const roots = resolved.flatMap((glob) => braceVariants(glob)).map((glob) => (glob.search(/[*?]/) < 0 ? glob : glob.slice(0, glob.search(/[*?]/))).replace(/[^/]*$/, ''));
    const lines = paths.filter((candidate) => roots.some((root) => candidate.startsWith(root)) && matchesAny(patterns, candidate)).sort()
      .map((candidate) => (declaration.kind === 'content' ? `${candidate}\0${hashOf(candidate) ?? 'absent'}` : candidate));
    const digest = hashText(lines.join('\n'));
    cache.set(key, digest);
    return digest;
  };
  return (file) => {
    const parts: Record<string, string> = {};
    compiled.forEach((entry, index) => {
      if (!matchesAny(entry.applies, file)) return;
      if (entry.declaration.kind === 'git') {
        const long = (options.lineCountOf?.(file) ?? Number.POSITIVE_INFINITY) > (entry.declaration.minLines ?? 0);
        parts[`${index}:${entry.declaration.rule}:git`] = long ? `git:${options.gitToken ?? ''}` : 'short';
        return;
      }
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
const isDirectory = (folder: string): boolean => {
  try { return fs.statSync(folder).isDirectory(); } catch { return false; }
};

/**
 * What the import graph reads of the disk, remembered for the build: a side's thousands of files probe the same few hundred folders and
 * candidate paths while resolving their imports, and the tree does not change while the graph is built.
 */
function graphHost(ts: Ts, sideRoot: string, hashOf: (file: string) => string | null): GraphHost {
  const files = new Map<string, boolean>(), folders = new Map<string, boolean>();
  const remembered = (known: Map<string, boolean>, ask: (path: string) => boolean) => (path: string): boolean => {
    let answer = known.get(path);
    if (answer === undefined) { answer = ask(path); known.set(path, answer); }
    return answer;
  };
  return { ts, sideRoot, readText, fileExists: remembered(files, isFile), directoryExists: remembered(folders, isDirectory), hashOf };
}

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/**
 * What a lint rule can read of an app's own manifest (the app root's or a side's `package.json`, which the canons name as a cross-file input): the manifest with each
 * dependency's version range reduced to what a rule can tell apart, a workspace, file or link reference (`workspace:`, `file:`, `link:`), an alias (`npm:<name>`) or
 * a plain registry range. A canon reads the names, the workspaces and these references from it, never a registry version, so raising a pin (`@starci/hfs`, `starci-harness`,
 * any library) leaves this digest and every file's cross-file input unchanged, while adding, removing or renaming a dependency, a `workspaces` entry or a reference does
 * not. Undefined for a text that is not a JSON object (the file's own hash stands then).
 */
export function manifestIdentity(text: string): string | undefined {
  let manifest: unknown;
  try { manifest = JSON.parse(text); } catch { return undefined; }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined;
  const reduced: Record<string, unknown> = { ...(manifest as Record<string, unknown>) };
  for (const section of DEPENDENCY_SECTIONS) {
    const declared = reduced[section];
    if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) continue;
    reduced[section] = Object.fromEntries(Object.entries(declared as Record<string, unknown>).map(([name, range]) => {
      const written = typeof range === 'string' ? range : '';
      const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@|$)/u.exec(written)?.[1];
      return [name, alias !== undefined ? `npm:${alias}` : /^(?:workspace|file|link):/u.exec(written)?.[0] ?? (typeof range === 'string' ? 'range' : 'other')];
    }));
  }
  return hashText(canonicalJson(reduced));
}

/** A record's `data` object, or an empty one. */
const dataOf = (record: CacheRecord): { readonly [key: string]: JsonValue } => (record.data !== null && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as { [key: string]: JsonValue } : {});

/**
 * The graph findings of every canon that publishes graph rules, merged by file and sorted. A canon whose snapshot the ESLint child handed out (`handed`, by
 * canon name) is not asked to build its graph again; any other canon builds it through its `projectGraph`.
 */
export function mergedSnapshot(sideRoot: string, canons: readonly CanonDeclarations[], handed?: Readonly<Record<string, GraphSnapshot>>): Record<string, GraphFinding[]> | null {
  const merged: Record<string, GraphFinding[]> = {};
  for (const canon of canons) {
    if (!canon.graphRules) continue;
    const given = handed?.[canon.name];
    if (given === undefined && canon.projectGraph === null) return null;
    const { byFile } = given ?? (canon.projectGraph as NonNullable<CanonDeclarations['projectGraph']>)({ repoRoot: sideRoot });
    for (const [file, findings] of Object.entries(byFile)) merged[posix(file)] = [...(merged[posix(file)] ?? []), ...findings];
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
  const contentHash = (appRelative: string): string | undefined => session.index.hashOf(appRelative) ?? (appRelative.startsWith(prefix) ? hashOf(appRelative.slice(prefix.length)) : hashFile(path.join(session.root, appRelative)));
  // The app root's and the side's own manifests stand by their identity (manifestIdentity), so a raised pin is no change of any file's cross-file input.
  const identities = new Map<string, string | undefined>();
  const appHash = (appRelative: string): string | undefined => {
    if (appRelative !== 'package.json' && appRelative !== `${prefix}package.json`) return contentHash(appRelative);
    if (!identities.has(appRelative)) {
      const text = readText(path.join(session.root, appRelative));
      identities.set(appRelative, text === null ? undefined : manifestIdentity(text));
    }
    return identities.get(appRelative) ?? contentHash(appRelative);
  };
  const appPaths = [...new Set([...session.index.paths, ...scope.map((file) => `${prefix}${file}`), ...stylesheets.map((file) => `${prefix}${file}`)])];

  // what the cache holds
  const stored = session.records(folder);
  const ofStep = (step: string): CacheRecord[] => stored.filter((record) => record.step === step);
  const validEslint = new Map(reconcile(ofStep(LINT_STEPS.eslint), hashOf).map((record) => [record.path, record]));
  const validStyle = new Map(reconcile(ofStep(LINT_STEPS.stylelint), hashOf).map((record) => [record.path, record]));
  const meta = ofStep(LINT_STEPS.meta).find((record) => record.path === SIDE_RECORD);
  const metaData = meta === undefined ? {} : dataOf(meta);
  // the installed packages the side imports, by install digest: a bump re-lints the files that import the package, not the side
  const installed = packageDigests(lockEntries(session.root));
  const recordedPackages = metaData['packages'] !== null && typeof metaData['packages'] === 'object' && !Array.isArray(metaData['packages']) ? (metaData['packages'] as Record<string, JsonValue>) : null;
  const changedPackages = new Set(recordedPackages === null ? [] : Object.keys(recordedPackages).filter((name) => recordedPackages[name] !== (installed.get(name) ?? 'absent')));
  const previousFindings = new Set([...ofStep(LINT_STEPS.eslint), ...ofStep(LINT_STEPS.stylelint)].flatMap((record) => record.findings.map(keyOf)));

  const progress = session.progress.step('lint', `lint ${side}`, scope.length + stylesheets.length);

  // ------------------------------------------------------------------ the plan
  let whole: string | null = input.full;
  let dirtyEslint = new Set<string>();
  let dirtyStyle = new Set<string>();
  let build: GraphBuild | null = null;
  let snapshot: Record<string, GraphFinding[]> | null = null;
  const crossEslint = new Map<string, string | undefined>();
  const crossStyle = new Map<string, string | undefined>();

  const sideUnchanged = whole === null && meta !== undefined && meta.hash === sideKey && metaData['extra'] === input.extraKey && recordedPackages !== null && changedPackages.size === 0
    && scope.every((file) => validEslint.has(file)) && stylesheets.every((file) => validStyle.has(file))
    && ofStep(LINT_STEPS.eslint).every((record) => scopeSet.has(record.path)) && ofStep(LINT_STEPS.stylelint).every((record) => styleSet.has(record.path))
    // a file the program reads that is no lint source (a JSON module, untracked generated code) is part of the side too
    && ofStep(LINT_STEPS.imports).filter((record) => !scopeSet.has(record.path)).every((record) => hashOf(record.path) === record.hash);

  const lineCountOf = (file: string): number => {
    const text = readText(abs(file));
    if (text === null) return 0;
    const lines = text.split(/\r?\n/);
    return lines.at(-1) === '' ? lines.length - 1 : lines.length;
  };
  const crossFor = (canons: readonly CanonDeclarations[]): ((file: string) => string | undefined) =>
    crossDigestFactory({ side, declarations: canons.flatMap((canon) => canon.crossFileInputs ?? []), paths: appPaths, hashOf: appHash, gitToken: input.gitToken ?? '', lineCountOf });
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
          const strings = (value: JsonValue | undefined): string[] | undefined => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined);
          if (kept === undefined || record.hash === hashOf(record.path)) previous.set(record.path, { hash: record.hash, imports, declaresGlobals: data['globals'] === true, api: typeof data['api'] === 'string' ? data['api'] : undefined, open: typeof data['open'] === 'boolean' ? data['open'] : undefined, refs: strings(data['refs']), packages: strings(data['packages']) });
        }
        const recordedGraph: ImportGraph | null = previous.size === 0 ? null : previous;
        build = buildImportGraph(graphHost(ts, sideRoot, (file) => hashOf(file) ?? null), scope, recordedGraph, { pathsChanged: metaData['paths'] !== pathsDigest });
        const dirty = dirtySetOf(recordedGraph, build.graph, recordedPackages === null ? new Set(installed.keys()) : changedPackages);
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
  const eslintList = [...dirtyEslint].sort();
  const styleList = [...dirtyStyle].sort();
  let handedGraph: Readonly<Record<string, GraphSnapshot>> | undefined;
  const freshEslint = new Map<string, EslintResult>();
  const freshStyle = new Map<string, StylelintResult>();
  const rootOf = (file: string): string => path.relative(sideRoot, file).replace(/\\/g, '/');
  let resumed = 0;
  if (eslintList.length > 0) {
    // What an interrupted run of this very tree already judged is not judged again: its results were journaled under the digest of every input of the side (the
    // side key, the cross-file inputs, the installed packages, the base), which is equal exactly when the tree is the same, so each is the result a run gives now.
    const context = combineHashes({
      side: sideKey, extra: input.extraKey, paths: pathsDigest, git: input.gitToken ?? '', packages: combineHashes(Object.fromEntries(installed)),
      cross: combineHashes(Object.fromEntries([...crossEslint].map(([file, digest]) => [file, digest ?? '']))),
    });
    const wanted = new Set(eslintList);
    if (input.full === null) {
      for (const line of session.journaled?.(folder, context) ?? []) {
        const result = journaledResult(line, sideRoot, input.relativize);
        const file = result === undefined ? undefined : posix(rootOf(result.filePath));
        if (result !== undefined && file !== undefined && wanted.has(file)) freshEslint.set(file, result);
      }
      resumed = freshEslint.size;
    }
    const remaining = eslintList.filter((file) => !freshEslint.has(file));
    const sink = session.journal?.(folder, 'raw', context);
    sink?.open();
    // Each parallel ESLint chunk appends to a file of its own (one writer each); every file carries the same header, so the next run reads them all.
    const partSink = (index: number): string => {
      const own = index === 0 ? sink : session.journal?.(folder, 'raw', context, index);
      own?.open();
      return own?.file ?? sink?.file ?? '';
    };
    if (remaining.length > 0) {
      const run = await input.eslint(whole !== null && resumed === 0 && sink === undefined ? null : remaining, sink === undefined ? undefined : { file: sink.file, part: (index) => partSink(index) });
      errors.push(...run.errors);
      handedGraph = run.graph;
      for (const result of run.results) freshEslint.set(posix(rootOf(result.filePath)), result);
    }
    if (resumed > 0) reason += `; ${String(resumed)} of them already judged by an interrupted run`;
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
  const units = scope.length + stylesheets.length;
  const reused = Math.max(0, units - checked);
  progress.tick(units, reused, checked);
  progress.end();

  // ------------------------------------------------------------------ the records
  let written = false;
  const complete = errors.length === 0 && input.write && !sideUnchanged;
  if (complete) {
    // A file edited while the run read it gets no record of any step, and the others keep theirs: their hashes are those of the tree the run
    // planned from, so the edited file is then added (no recorded graph entry) and its dependents are judged again, whatever they read of it.
    const moved = new Set([...freshEslint.keys(), ...freshStyle.keys()].filter((file) => hashFile(abs(file)) !== hashOf(file)));
    const records: CacheRecord[] = [...eslintRecords, ...styleRecords].filter((record) => !moved.has(record.path));
    // without an import graph or a project graph the next run lints the side whole; the results themselves are still stored
    try {
      if (build === null) {
        const ts = input.typescript();
        build = buildImportGraph(graphHost(ts, sideRoot, (file) => hashOf(file) ?? null), scope, null);
      }
      for (const [file, node] of build.graph) {
        if (!moved.has(file)) records.push({ path: file, step: LINT_STEPS.imports, hash: node.hash, findings: [], data: { globals: node.declaresGlobals, imports: node.imports, ...(node.api === undefined ? {} : { api: node.api }), open: node.open !== false, ...(node.refs === undefined ? {} : { refs: node.refs }), ...(node.packages === undefined ? {} : { packages: node.packages }) } });
      }
      snapshot ??= mergedSnapshot(sideRoot, input.canons, handedGraph);
      for (const [file, findings] of Object.entries(snapshot ?? {})) {
        if (scopeSet.has(file) && !moved.has(file) && findings.length > 0) records.push({ path: file, step: LINT_STEPS.graph, hash: planHash(file), findings: graphRecordFindings(side, file, findings) });
      }
    } catch {
      records.splice(0, records.length, ...records.filter((record) => record.step === LINT_STEPS.eslint || record.step === LINT_STEPS.stylelint));
    }
    const packagesOf = (record: CacheRecord): string[] => {
      const listed = dataOf(record)['packages'];
      return Array.isArray(listed) ? listed.filter((entry): entry is string => typeof entry === 'string') : [];
    };
    const imported = [...new Set(records.filter((record) => record.step === LINT_STEPS.imports).flatMap(packagesOf))].sort();
    records.push({ path: SIDE_RECORD, step: LINT_STEPS.meta, hash: sideKey, findings: [], data: { extra: input.extraKey, files: scope.length, paths: pathsDigest, stylesheets: stylesheets.length, packages: Object.fromEntries(imported.map((name) => [name, installed.get(name) ?? 'absent'])) } });
    session.replace(folder, records);
    written = true;
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

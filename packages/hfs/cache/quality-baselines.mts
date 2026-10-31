// quality-baselines.mts - the `--sonar` family of the app check cache (contexts/project/check-cache.md, "Sonar and Codecov"). `sonar-baseline/` and `codecov-baseline/` hold
// REFERENCE data only: the base commit of the new code, the quality gate's conditions as read from their owner with that owner's digest, the analysis scope's digest, and the
// patch and project targets of codecov.yml with its digest. They never hold a server's result. From them and the merged coverage a run predicts what the servers will say,
// and every prediction is labelled as one: Sonar's new-code coverage and duplication on the lines changed since the base commit, Codecov's patch coverage and project
// change (the base total computed from the base commit's committed coverage records). The servers stay the judges: a prediction never passes or fails a run.
import { spawnSync } from 'node:child_process';
import { hashText } from './hash.mjs';
import { parseRecords } from './jsonl.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import type { CacheRecord, CheckSession, FamilyReport, JsonValue } from './types.mjs';

export const SONAR_FOLDER = 'sonar-baseline';
export const CODECOV_FOLDER = 'codecov-baseline';
/** The step of every reference record. */
export const REFERENCE_STEP = 'reference';
/** The label every prediction carries and every printed line states. */
export const PREDICTION = 'prediction';

/** The unit-spec records of the test family, read by folder and step (kept in step with test-family.mts, which owns them). */
const TEST_FOLDER = 'test-coverage';
const SPEC_STEP = 'unit-spec';

// ---- reference data ---------------------------------------------------------------------------------------------------------------------------------------

/** The new-code conditions of the Sonar quality gate, as its owner (`runtime/knowledge/sonar-gate.yaml`) states them. */
export interface SonarGate {
  readonly coverageMinPercent: number;
  readonly duplicationMaxPercent: number;
}
/** The targets of codecov.yml, in percent. */
export interface CodecovTargets {
  readonly project: number;
  readonly patch: number;
}

function numberAt(document: unknown, keys: readonly string[], what: string): number {
  let value: unknown = document;
  for (const key of keys) value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new Error(`${what} is not declared at ${keys.join('.')}`);
  return parsed;
}

/** The gate conditions the predictions are compared with, read from the gate document (`newCode.coverage.minPercent`, `newCode.duplication.maxPercent`). */
export function readSonarGate(gateYaml: string): SonarGate {
  const document: unknown = parseYaml(gateYaml);
  return { coverageMinPercent: numberAt(document, ['newCode', 'coverage', 'minPercent'], 'the Sonar gate'), duplicationMaxPercent: numberAt(document, ['newCode', 'duplication', 'maxPercent'], 'the Sonar gate') };
}

/** The patch and project targets of codecov.yml (`coverage.status.{project,patch}.default.target`, `90%`). */
export function readCodecovTargets(codecovYaml: string): CodecovTargets {
  const document: unknown = parseYaml(codecovYaml);
  return {
    project: numberAt(document, ['coverage', 'status', 'project', 'default', 'target'], 'codecov.yml'),
    patch: numberAt(document, ['coverage', 'status', 'patch', 'default', 'target'], 'codecov.yml'),
  };
}

const SCOPE_KEY = /^sonar\.(?:sources|tests|inclusions|exclusions|test\.inclusions|test\.exclusions|coverage\.exclusions|cpd\.exclusions|javascript\.lcov\.reportPaths|typescript\.tsconfigPaths)$/u;

/** The digest of the analysis scope settings of sonar-project.properties: the settings that decide which lines Sonar sees, sorted, nothing else. */
export function scopeDigest(propertiesText: string): string {
  const settings = propertiesText.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*(.*?)\s*$/u.exec(line);
    return match !== null && SCOPE_KEY.test(match[1] ?? '') ? [`${match[1]}=${match[2]}`] : [];
  });
  return hashText(settings.sort().join('\n'));
}

/** What the reference records are built from. Texts are the owners' files as they stand; the base commit is the merge-base the new code is measured against. */
export interface BaselineSources {
  readonly baseCommit: string;
  readonly sonarGateYaml: string;
  readonly sonarProperties: string;
  readonly codecovYaml: string;
}

const reference = (key: string, hash: string, data: JsonValue): CacheRecord => ({ path: key, step: REFERENCE_STEP, hash, findings: [], data });

/** The records of the two baseline folders: reference data and digests, never a result of a server. */
export function baselineRecords(sources: BaselineSources): { readonly sonar: readonly CacheRecord[]; readonly codecov: readonly CacheRecord[] } {
  const gate = readSonarGate(sources.sonarGateYaml);
  const targets = readCodecovTargets(sources.codecovYaml);
  return {
    sonar: [
      reference('new-code-base', sources.baseCommit, { baseCommit: sources.baseCommit }),
      reference('quality-gate', hashText(sources.sonarGateYaml), { coverageMinPercent: gate.coverageMinPercent, duplicationMaxPercent: gate.duplicationMaxPercent, owner: 'runtime/knowledge/sonar-gate.yaml' }),
      reference('analysis-scope', scopeDigest(sources.sonarProperties), { digestOf: 'sonar-project.properties' }),
    ],
    codecov: [
      reference('base', sources.baseCommit, { baseCommit: sources.baseCommit }),
      reference('targets', hashText(sources.codecovYaml), { project: targets.project, patch: targets.patch, owner: 'codecov.yml' }),
    ],
  };
}

/** The reference parts already stored whose digest differs from the current one (a first adoption has none): the gate, the scope or the targets moved since the baseline was written. */
export function baselineDrift(stored: readonly CacheRecord[], current: readonly CacheRecord[]): string[] {
  const before = new Map(stored.map((record) => [record.path, record.hash]));
  return current.filter((record) => before.has(record.path) && before.get(record.path) !== record.hash).map((record) => record.path).sort();
}

// ---- changed lines ----------------------------------------------------------------------------------------------------------------------------------------

/** Per file, the lines added or changed since the base commit (new-code lines). */
export type ChangedLines = Readonly<Record<string, readonly number[]>>;

/** The lines a `git diff -U0 <base>` adds or changes, per file (`+++ b/path`, hunk headers `@@ -a,b +c,d @@`); a deleted file has none. */
export function changedLinesFromDiff(diff: string): ChangedLines {
  const out: Record<string, number[]> = {};
  let file: string | undefined;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      file = target === '/dev/null' ? undefined : target.replace(/^b\//u, '');
      if (file !== undefined) out[file] = out[file] ?? [];
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (hunk !== null && file !== undefined) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) out[file]?.push(start + i);
    }
  }
  return out;
}

// ---- coverage by line --------------------------------------------------------------------------------------------------------------------------------------

/** Per source, its instrumented lines and the lines the whole suite covers. */
export type LineCoverage = Readonly<Record<string, { readonly instrumented: readonly number[]; readonly covered: readonly number[] }>>;

/**
 * The line coverage the unit-spec records stand for: a line is instrumented when a statement starts on it and covered when any spec covers one that does. Equal for a
 * base commit's committed records and the work tree's, so the project change is computed on the same footing.
 */
export function lineCoverageOf(records: readonly CacheRecord[]): LineCoverage {
  const instrumented = new Map<string, Set<number>>();
  const covered = new Map<string, Set<number>>();
  for (const record of records) {
    if (record.step !== SPEC_STEP) continue;
    const data = record.data;
    const sources = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { readonly [key: string]: JsonValue })['sources'] : undefined;
    if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) continue;
    for (const [source, items] of Object.entries(sources)) {
      const statements = typeof items === 'object' && items !== null && !Array.isArray(items) ? (items as { readonly [key: string]: JsonValue })['s'] : undefined;
      if (!Array.isArray(statements)) continue;
      const all = instrumented.get(source) ?? new Set<number>();
      const hit = covered.get(source) ?? new Set<number>();
      for (const statement of statements) {
        if (!Array.isArray(statement) || typeof statement[0] !== 'number') continue;
        all.add(statement[0]);
        if (statement[4] === 1) hit.add(statement[0]);
      }
      instrumented.set(source, all);
      covered.set(source, hit);
    }
  }
  return Object.fromEntries([...instrumented].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([source, lines]) => [source, { instrumented: [...lines].sort((a, b) => a - b), covered: [...(covered.get(source) ?? [])].sort((a, b) => a - b) }]));
}

/** The base commit's coverage records, read from the commit itself (`git show <base>:<path>`), so the base total is computed and not stored. */
export function recordsAtCommit(baseCommit: string, git: (args: readonly string[]) => string | undefined, folder = `.starcistacks/cache/${TEST_FOLDER}`): CacheRecord[] {
  const listing = git(['ls-tree', '-r', '--name-only', baseCommit, '--', folder]);
  if (listing === undefined) return [];
  return listing.split(/\r?\n/u).filter((name) => name.endsWith('.jsonl')).flatMap((name) => parseRecords(git(['show', `${baseCommit}:${name}`]) ?? '').records);
}

/** `git` run in `cwd`, undefined when it fails (an unreadable base commit is no base total, not a crash). */
export function gitRunner(cwd: string): (args: readonly string[]) => string | undefined {
  return (args) => {
    const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : undefined;
  };
}

// ---- predictions --------------------------------------------------------------------------------------------------------------------------------------------

/** A duplicated block of a source: where the clones step found it. */
export interface CloneBlock {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface QualityInputs {
  readonly changed: ChangedLines;
  readonly coverage: LineCoverage;
  /** The base commit's coverage, or undefined when it cannot be read (then no project change is predicted). */
  readonly baseCoverage: LineCoverage | undefined;
  readonly clones: readonly CloneBlock[];
  readonly gate: SonarGate;
  readonly targets: CodecovTargets;
  /** The files Sonar and Codecov measure (the coverage scope), or every covered file when absent. */
  readonly measured?: (path: string) => boolean;
  /** The files Sonar counts new code in (its sources minus its exclusions), or every changed file when absent. */
  readonly analysed?: (path: string) => boolean;
}

/** One prediction. `value` is undefined when nothing in the change could be measured; it is never a verdict. */
export interface Prediction {
  readonly label: typeof PREDICTION;
  readonly provider: 'sonar' | 'codecov';
  readonly metric: string;
  readonly value: number | undefined;
  /** The numbers the percentage comes from, as text (`28 of 30 changed lines`). */
  readonly basis: string;
  /** What the server holds the metric to, from the baseline. */
  readonly target: string;
}

const percent = (part: number, whole: number): number | undefined => (whole === 0 ? undefined : Math.round((part / whole) * 10000) / 100);

/** Covered and coverable lines among the changed lines of the measured sources. */
function changedCoverage(inputs: QualityInputs): { covered: number; coverable: number } {
  let covered = 0;
  let coverable = 0;
  for (const [file, lines] of Object.entries(inputs.changed)) {
    const coverage = inputs.coverage[file];
    if (coverage === undefined || inputs.measured?.(file) === false) continue;
    const instrumented = new Set(coverage.instrumented);
    const hit = new Set(coverage.covered);
    for (const line of new Set(lines)) {
      if (!instrumented.has(line)) continue;
      coverable += 1;
      if (hit.has(line)) covered += 1;
    }
  }
  return { covered, coverable };
}

function total(coverage: LineCoverage, measured: ((path: string) => boolean) | undefined): { covered: number; coverable: number } {
  let covered = 0;
  let coverable = 0;
  for (const [file, lines] of Object.entries(coverage)) {
    if (measured?.(file) === false) continue;
    coverable += lines.instrumented.length;
    covered += lines.covered.length;
  }
  return { covered, coverable };
}

/** Sonar's new-code coverage and duplication and Codecov's patch coverage and project change, each labelled as a prediction. */
export function predict(inputs: QualityInputs): Prediction[] {
  const patch = changedCoverage(inputs);
  const out: Prediction[] = [
    { label: PREDICTION, provider: 'sonar', metric: 'new-code coverage', value: percent(patch.covered, patch.coverable), basis: `${patch.covered} of ${patch.coverable} coverable changed lines`, target: `>= ${inputs.gate.coverageMinPercent}%` },
  ];
  let newLines = 0;
  let duplicated = 0;
  for (const [file, lines] of Object.entries(inputs.changed)) {
    if (inputs.analysed?.(file) === false) continue;
    const changed = new Set(lines);
    newLines += changed.size;
    const inClone = new Set<number>();
    for (const block of inputs.clones) if (block.path === file) for (let line = block.startLine; line <= block.endLine; line += 1) if (changed.has(line)) inClone.add(line);
    duplicated += inClone.size;
  }
  out.push({ label: PREDICTION, provider: 'sonar', metric: 'new-code duplication', value: percent(duplicated, newLines), basis: `${duplicated} of ${newLines} changed lines`, target: `<= ${inputs.gate.duplicationMaxPercent}%` });
  out.push({ label: PREDICTION, provider: 'codecov', metric: 'patch coverage', value: percent(patch.covered, patch.coverable), basis: `${patch.covered} of ${patch.coverable} changed lines with coverage`, target: `>= ${inputs.targets.patch}%` });
  const now = total(inputs.coverage, inputs.measured);
  const nowPercent = percent(now.covered, now.coverable);
  if (inputs.baseCoverage === undefined) {
    out.push({ label: PREDICTION, provider: 'codecov', metric: 'project change', value: undefined, basis: 'the base commit holds no readable coverage records', target: `project >= ${inputs.targets.project}%` });
  } else {
    const base = total(inputs.baseCoverage, inputs.measured);
    const basePercent = percent(base.covered, base.coverable);
    const change = nowPercent === undefined || basePercent === undefined ? undefined : Math.round((nowPercent - basePercent) * 100) / 100;
    out.push({ label: PREDICTION, provider: 'codecov', metric: 'project change', value: change, basis: `${nowPercent ?? 'n/a'}% now against ${basePercent ?? 'n/a'}% at the base commit`, target: `project >= ${inputs.targets.project}%` });
  }
  return out;
}

/** The lines a run prints: each states that it is a local prediction and what the server holds the metric to. */
export function formatPredictions(predictions: readonly Prediction[]): string[] {
  return predictions.map((entry) => `${entry.provider}: ${entry.metric} ${entry.value === undefined ? 'not measurable' : `${entry.value}%`} (${entry.basis}) [${entry.label} from the local run, not the server's result; the server holds it to ${entry.target}]`);
}

export interface QualityFamilyResult {
  readonly predictions: readonly Prediction[];
  readonly lines: readonly string[];
  /** The reference parts whose owner changed since the baseline was written. */
  readonly drift: readonly string[];
  readonly report: FamilyReport;
}

/**
 * The `--sonar` family: writes the two baseline folders from the owners' files and predicts from the merged coverage. It always runs (the predictions read the changed
 * lines, which no key holds) and it never fails a run: `ok` does not exist here, the servers judge.
 */
export function runQualityFamily({ session, sources, changed, clones, baseCoverage, measured, analysed }: {
  session: CheckSession;
  sources: BaselineSources;
  changed: ChangedLines;
  clones: readonly CloneBlock[];
  baseCoverage: LineCoverage | undefined;
  measured?: (path: string) => boolean;
  analysed?: (path: string) => boolean;
}): QualityFamilyResult {
  const records = baselineRecords(sources);
  const drift = [...new Set([...baselineDrift(session.records(SONAR_FOLDER), records.sonar), ...baselineDrift(session.records(CODECOV_FOLDER), records.codecov)])].sort();
  session.replace(SONAR_FOLDER, records.sonar);
  session.replace(CODECOV_FOLDER, records.codecov);
  const predictions = predict({
    changed,
    coverage: lineCoverageOf(session.records(TEST_FOLDER)),
    baseCoverage,
    clones,
    gate: readSonarGate(sources.sonarGateYaml),
    targets: readCodecovTargets(sources.codecovYaml),
    ...(measured === undefined ? {} : { measured }),
    ...(analysed === undefined ? {} : { analysed }),
  });
  const report: FamilyReport = { family: 'sonar', mode: 'full', reason: 'predictions always run', checked: predictions.length, reused: 0, newFindings: 0, knownFindings: 0, fixedFindings: 0 };
  session.report(report);
  return { predictions, lines: formatPredictions(predictions), drift, report };
}

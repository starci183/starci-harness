// format-family.mts - `app check --format`: Prettier (HFS_FORMAT) over every tracked file, reused per file. A path whose content hash is
// unchanged keeps its recorded verdict; changed and added paths are formatted again, in batches (sync/format.mts). The records are
// `check/format/`, sparse: a clean file is a record with its hash and no finding.
import { formatFindings, formattable, FORMAT, type FormatFinding, type Prettier } from '../sync/format.mjs';
import { reconcile } from './jsonl.mjs';
import { makeReport } from './report.mjs';
import type { CacheRecord, CheckSession, FamilyReport, Finding } from './types.mjs';

export const FORMAT_FOLDER = 'check/format';
const STEP = 'prettier';
/** Area files of the format records: app-relative paths, so `fe/apps/web` is the third folder. */
const FORMAT_DEPTH = 3;

export interface FormatFamilyResult {
  readonly findings: FormatFinding[];
  readonly report: FamilyReport;
}

const asFinding = (found: FormatFinding): Finding => ({ path: found.path, line: 0, column: 0, rule: found.code, message: found.message });
const fromFinding = (found: Finding): FormatFinding => ({ code: found.rule, level: 'error', path: found.path, message: found.message });

/** Runs the format family against `session`: decides, formats what must be formatted, replaces the records, reports. */
export async function runFormatFamily(session: CheckSession, { files, prettier }: { files: readonly string[]; prettier?: Prettier | undefined }): Promise<FormatFamilyResult> {
  const decision = session.decide('format');
  const candidates = formattable(files).filter((file) => session.index.hashOf(file) !== undefined);
  const previous = session.records(FORMAT_FOLDER);
  const reusable = decision.mode === 'diff'
    ? new Map(reconcile(previous.filter((record) => record.step === STEP), (file) => session.index.hashOf(file)).map((record) => [record.path, record]))
    : new Map<string, CacheRecord>();
  const todo = candidates.filter((file) => !reusable.has(file));
  const step = session.progress.step('format', STEP, candidates.length);
  step.tick(candidates.length - todo.length, candidates.length - todo.length, 0);
  const judged = await formatFindings({
    repoRoot: session.root, files: todo, prettier,
    onProgress: (done) => step.tick(candidates.length - todo.length + done, candidates.length - todo.length, done),
  });
  step.end();
  const byPath = new Map<string, FormatFinding[]>();
  for (const found of judged) byPath.set(found.path, [...(byPath.get(found.path) ?? []), found]);
  const records: CacheRecord[] = [];
  for (const file of candidates) {
    const kept = reusable.get(file);
    if (kept !== undefined) records.push(kept);
    else records.push({ path: file, step: STEP, hash: session.index.hashOf(file) ?? '', findings: (byPath.get(file) ?? []).map(asFinding) });
  }
  const findings = records.flatMap((record) => record.findings.map(fromFinding));
  session.replace(FORMAT_FOLDER, records, { depth: FORMAT_DEPTH });
  const report = makeReport({
    family: 'format', mode: decision.mode, reason: decision.reason, checked: todo.length, reused: candidates.length - todo.length,
    previous: previous.flatMap((record) => record.findings), current: records.flatMap((record) => record.findings),
  });
  session.report(report);
  return { findings, report };
}

export { FORMAT };

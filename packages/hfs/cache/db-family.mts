// db-family.mts - `app check --db`: the database rules of `db/` (DB_*). Scoped: reused when every `db/` hash and the merge-base the baseline
// rules compare with are unchanged; any `db/` change or a new merge-base judges the rules again.
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { mergeBase } from '../runtime/scripts/api/git/merge-base.mjs';
import { RecordSet, keyOfPaths, scopedStep } from './records.mjs';
import { makeReport } from './report.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { CheckSession, FamilyReport, Finding, JsonValue } from './types.mjs';

export const DB_FOLDER = 'check/db';

/** The merge-base of HEAD with origin/main, else main, as the baseline rules find it; `none` when neither resolves. */
export function dbMergeBase(repoRoot: string): string {
  for (const ref of ['origin/main', 'main']) {
    const sha = mergeBase(repoRoot, 'HEAD', ref);
    if (sha) return sha;
  }
  return 'none';
}

const compact = (finding: CheckFinding): Finding => ({ path: finding.path ?? 'db', line: finding.line ?? 0, column: finding.column ?? 0, rule: finding.code, message: String(finding.message ?? '') });

export async function runDbFamily(session: CheckSession, { repoRoot, tracked, base }: { repoRoot: string; tracked: readonly string[]; base?: string | undefined }): Promise<{ findings: CheckFinding[]; report: FamilyReport }> {
  const decision = session.decide('db');
  const records = new RecordSet(session.records(DB_FOLDER));
  const previous = records.findings('db-rules');
  const inputs = session.index.paths.filter((file) => file.startsWith('db/') || file.startsWith('supabase/') || file.endsWith('.sql'));
  const key = keyOfPaths(session.index, inputs, { 'merge-base': base ?? dbMergeBase(repoRoot) });
  const step = session.progress.step('db', 'rules', inputs.length);
  const { value, reused } = await scopedStep(session, records, {
    path: 'db', step: 'db-rules', key, reuse: decision.mode === 'diff', inputs,
    compute: async () => JSON.parse(JSON.stringify(await checkDatabase({ repoRoot, files: [...tracked], base }))) as JsonValue,
    compact: (found) => (found as unknown as CheckFinding[]).map(compact),
  });
  step.tick(inputs.length, reused ? inputs.length : 0, reused ? 0 : inputs.length);
  step.end();
  session.replace(DB_FOLDER, records.toArray());
  const findings = value as unknown as CheckFinding[];
  const report = makeReport({ family: 'db', mode: decision.mode, reason: decision.reason, checked: reused ? 0 : inputs.length, reused: reused ? inputs.length : 0, previous, current: findings.map(compact) });
  session.report(report);
  return { findings, report };
}

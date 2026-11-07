// db-family.mts - `app check --db`: the database rules of `db/` (DB_*). Scoped: reused when every input's hash and the inputs AT the merge-base the
// baseline rules compare with are unchanged; any input change, or a base whose inputs differ, judges the rules again. The base is keyed by
// what the rules read there (the blob of each input path), never by its sha, so a merge or a commit that leaves the inputs alone (a cache
// commit, a merge of unrelated work) rewrites no record (a record that depended on its own commit was rewritten by every push).
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { mergeBase } from '../runtime/scripts/api/git/merge-base.mjs';
import { runGit } from '../runtime/scripts/api/git/lib.mjs';
import { hashText } from './hash.mjs';
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

/** The inputs of the db rules (hfs.json, db/, supabase/, any .sql) at `base`, as one digest of their paths and blobs; `none` without a base. */
export const isDbInput = (file: string): boolean => file === 'hfs.json' || file.startsWith('db/') || file.startsWith('supabase/') || file.endsWith('.sql');
export function baseInputs(repoRoot: string, base: string): string {
  if (base === 'none') return 'none';
  const listed = runGit(['ls-tree', '-r', base], { dir: repoRoot, maxBuffer: 256 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) return `unreadable:${base}`;
  const lines = String(listed.stdout ?? '').split('\n').filter((line) => { const file = line.split('\t')[1]; return file !== undefined && isDbInput(file) && !file.startsWith('.starcistacks/cache/'); });
  return hashText(lines.join('\n'));
}

const compact = (finding: CheckFinding): Finding => ({ path: finding.path ?? 'db', line: finding.line ?? 0, column: finding.column ?? 0, rule: finding.code, message: String(finding.message ?? '') });

export async function runDbFamily(session: CheckSession, { repoRoot, tracked, base }: { repoRoot: string; tracked: readonly string[]; base?: string | undefined }): Promise<{ findings: CheckFinding[]; report: FamilyReport }> {
  const decision = session.decide('db');
  const records = new RecordSet(session.records(DB_FOLDER));
  const previous = records.findings('db-rules');
  // hfs.json carries the edition and the db block (its db.destructiveRulings entries included), which the rules read.
  const inputs = session.index.paths.filter(isDbInput);
  const key = keyOfPaths(session.index, inputs, { 'base-inputs': baseInputs(repoRoot, base ?? dbMergeBase(repoRoot)) });
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

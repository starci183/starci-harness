// ratchet.mts - the lint ratchet (R379 LINT_RATCHET_RAISED) of a branch whose profile runs lint as `report`: a commit there never adds lint findings to the
// files it touches. Each touched source file has no more ESLint error findings than at the base, and a new file has none; the findings it already
// carried stay report-only. Both versions of each touched file are linted in ONE ESLint child per scope, as texts in place of the file (lintText with the
// file's path: lint/eslint-list.cts), through the side's installed config, so the typed rules judge the base text against the same program. Only the
// touched files are linted, so the ratchet costs one typed program per side the change touches. A ratchet violation blocks at any count (gate-threshold.mts).
//   staged   the pre-commit hook (`starci app check --ratchet`): the staged files (index content) against HEAD, the parent of the commit to be
//   range    the pre-push hook and CI (the lint family of `starci app check` under the profile): the files the commits since the base touched (HEAD content)
//            against the base, the merge-base of HEAD with STARCI_BASE_REF (CI's pushed range), else with origin/<branch>, else HEAD^
import path from 'node:path';
import { runGit } from '../runtime/scripts/api/git/lib.mjs';
import { SIDES } from '../runtime/scripts/hfs/slots.mjs';
import { PACKAGES, canonScope, installedLintConfig, packagesConfig, runLinter, type LintText, type LinterRunner } from './run.mjs';
import { hashText } from '../cache/hash.mjs';
import { parseRecords } from '../cache/jsonl.mjs';
import { lintChunkOf } from '../runtime/scripts/api/node/memory-plan.mjs';
import type { CacheRecord } from '../cache/types.mjs';

export const LINT_RATCHET_RAISED = 'LINT_RATCHET_RAISED';

/** One touched file: app-relative path, its text at the base (null when it is new there) and its text now. */
export interface TouchedFile { file: string; base: string | null; current: string }
/** A ratchet finding: one touched file whose error count rose. */
export type RatchetFinding = { code: typeof LINT_RATCHET_RAISED; level: 'error'; path: string; message: string; rules: string[] };
/** The ratchet's answer: its findings, the files it compared and every tool error (a scope it could not lint: the check then exits 2). */
export interface RatchetResult { findings: RatchetFinding[]; compared: number; errors: string[]; fromCache: number; linted: number }

// reason: ESLint's json results come from the child and carry the message fields this module reads
type EslintResultJson = { messages?: { ruleId?: string | null; severity?: number; fatal?: boolean }[] };

const SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const git = (repoRoot: string, args: readonly string[]): string | null => {
  const run = runGit(args, { dir: repoRoot, maxBuffer: 256 * 1024 * 1024 });
  return !run.error && run.status === 0 ? String(run.stdout ?? '') : null;
};
const lines = (text: string | null): string[] => (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
const sha = (repoRoot: string, ref: string): string | null => git(repoRoot, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])?.trim() || null;

/** The base the range ratchet compares with, and why: the merge-base of HEAD with STARCI_BASE_REF, else with origin/<branch>, else HEAD^; null for a root commit. */
export function ratchetBase(repoRoot: string, env: NodeJS.ProcessEnv, branch: string | null): { base: string | null; source: string } {
  const head = sha(repoRoot, 'HEAD');
  const named = env.STARCI_BASE_REF?.trim();
  for (const [ref, source] of [[named, 'STARCI_BASE_REF'], [branch === null ? undefined : `origin/${branch}`, `origin/${branch ?? ''}`]] as const) {
    if (ref === undefined || ref === '') continue;
    const merged = git(repoRoot, ['merge-base', 'HEAD', ref])?.trim();
    if (merged && merged !== head) return { base: merged, source: `the merge-base of HEAD with ${source}` };
  }
  const parent = sha(repoRoot, 'HEAD^1');
  return parent === null ? { base: null, source: 'a root commit: every file is new' } : { base: parent, source: 'HEAD^' };
}

/** The text of `file` at `rev` (`:` the index), or null when it does not exist there. */
const textAt = (repoRoot: string, rev: string, file: string): string | null => git(repoRoot, ['show', `${rev}:${file}`]);

/** The touched source files of the commits base..HEAD (HEAD content), each with its text at the base; a root commit touches every file of HEAD. */
export function rangeTouched(repoRoot: string, base: string | null): TouchedFile[] {
  const names = base === null ? lines(git(repoRoot, ['ls-tree', '-r', '--name-only', 'HEAD'])) : lines(git(repoRoot, ['diff', '--name-only', '--no-renames', '--diff-filter=ACM', base, 'HEAD']));
  return names.filter((file) => SOURCE.test(file)).flatMap((file) => {
    const current = textAt(repoRoot, 'HEAD', file);
    return current === null ? [] : [{ file, base: base === null ? null : textAt(repoRoot, base, file), current }];
  });
}

/** The staged source files (index content), each with its text at HEAD, the parent of the commit being made. */
export function stagedTouched(repoRoot: string): TouchedFile[] {
  const head = sha(repoRoot, 'HEAD');
  return lines(git(repoRoot, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACM'])).filter((file) => SOURCE.test(file)).flatMap((file) => {
    const current = textAt(repoRoot, '', file);
    return current === null ? [] : [{ file, base: head === null ? null : textAt(repoRoot, 'HEAD', file), current }];
  });
}

/** Per side, the ESLint findings by rule that a set of lint records holds for a file at the content hash it had: `counts(side, file, hash)`, undefined when none. */
export interface RecordedCounts { counts(side: string, file: string, hash: string): Map<string, number> | undefined }

const LINT_CACHE = '.starcistacks/cache/lint';
const countsOf = (records: readonly CacheRecord[]): Map<string, Map<string, number>> => {
  const out = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (record.step !== 'eslint') continue;
    const counts = new Map<string, number>();
    for (const finding of record.findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
    out.set(`${record.path}\0${record.hash}`, counts);
  }
  return out;
};

/** The lint records the committed cache holds at `rev` (the base commit's own `.starcistacks/cache/lint/<side>/` files), read from git; an empty set when it has none. */
export function committedLintCounts(repoRoot: string, rev: string | null): RecordedCounts {
  const bySide = new Map<string, Map<string, Map<string, number>>>();
  if (rev !== null) {
    for (const side of SIDES as readonly string[]) {
      const files = lines(git(repoRoot, ['ls-tree', '-r', '--name-only', rev, '--', `${LINT_CACHE}/${side}`])).filter((file) => file.endsWith('.jsonl'));
      const records = files.flatMap((file) => parseRecords(textAt(repoRoot, rev, file) ?? '').records);
      bySide.set(side, countsOf(records));
    }
  }
  return { counts: (side, file, hash) => bySide.get(side)?.get(`${file}\0${hash}`) };
}

/** The lint records of this run (the lint family's records of each side, read from the session after it linted). */
export function sessionLintCounts(records: (folder: string) => readonly CacheRecord[]): RecordedCounts {
  const bySide = new Map((SIDES as readonly string[]).map((side) => [side, countsOf(records(`lint/${side}`))] as const));
  return { counts: (side, file, hash) => bySide.get(side)?.get(`${file}\0${hash}`) };
}

/** True when no rule has more findings in `now` than in `before`: then no error rule can have risen, whatever severity each rule has. */
const noRuleRose = (before: Map<string, number>, now: Map<string, number>): boolean => [...now].every(([rule, count]) => count <= (before.get(rule) ?? 0));

/** The most texts one ratchet child lints: the touched files of a large range are linted in bounded chunks, never all in one heap. */
export const RATCHET_TEXTS_PER_CHILD = 600;

/** The error findings of one result, by rule. */
function errorsByRule(result: EslintResultJson | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of result?.messages ?? []) {
    if (message.severity !== 2 && message.fatal !== true) continue;
    const rule = message.ruleId ?? 'eslint-error';
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
}
const total = (counts: Map<string, number>): number => [...counts.values()].reduce((sum, count) => sum + count, 0);

/** The scope a touched file is linted in (be, fe or the root packages) and its path relative to that scope's folder. */
function scopeOf(file: string): { scope: string; relative: string } | null {
  const side = SIDES.find((candidate: string) => file.startsWith(`${candidate}/`));
  if (side !== undefined) return { scope: side, relative: file.slice(side.length + 1) };
  return file.startsWith(`${PACKAGES}/`) ? { scope: PACKAGES, relative: file } : null;
}

/**
 * The ratchet over `touched`: per scope (limited to `side` when given), the files the installed config selects, both texts linted in one child,
 * a finding for each file whose error count rose. `branch` names the profile in the message.
 */
export async function ratchetFindings({ repoRoot, touched, side, branch, run = runLinter, base, now }: {
  repoRoot: string; touched: readonly TouchedFile[]; side?: string | undefined; branch: string; run?: LinterRunner | undefined;
  /** The lint records of the base (the committed cache at the base commit) and of this run: a file both hold, with no rule risen, needs no lint. */
  base?: RecordedCounts | undefined; now?: RecordedCounts | undefined;
}): Promise<RatchetResult> {
  const result: RatchetResult = { findings: [], compared: 0, errors: [], fromCache: 0, linted: 0 };
  const byScope = new Map<string, { file: TouchedFile; relative: string }[]>();
  for (const file of touched) {
    const placed = scopeOf(file.file);
    if (placed === null || (side !== undefined && placed.scope !== side)) continue;
    byScope.set(placed.scope, [...(byScope.get(placed.scope) ?? []), { file, relative: placed.relative }]);
  }
  for (const [scope, files] of byScope) {
    const cwd = scope === PACKAGES ? repoRoot : path.join(repoRoot, scope);
    let selected: typeof files;
    try {
      const config = scope === PACKAGES ? await packagesConfig(repoRoot) : await installedLintConfig({ repoRoot, cwd, side: scope });
      const lintScope = canonScope(config);
      selected = files.filter(({ relative }) => !lintScope.ignored(relative) && lintScope.source(relative));
    } catch (error) { result.errors.push(`the lint ratchet cannot read the lint scope of ${scope}/: ${String((error as Error | undefined)?.message ?? error)}`); continue; }
    // The trusted records first (the committed cache at the base, this run's lint records now): a file whose recorded findings rose by no rule
    // is settled without a child; only the rest, a file the records lack or one they say rose, is linted, so a first push is not a whole-side lint twice.
    const unsettled = selected.filter(({ file, relative }) => {
      const current = now?.counts(scope, relative, hashText(file.current));
      const before = file.base === null ? new Map<string, number>() : base?.counts(scope, relative, hashText(file.base));
      if (current === undefined || before === undefined || !noRuleRose(before, current)) return true;
      result.compared += 1;
      result.fromCache += 1;
      return false;
    });
    // The memory plan's lint chunk when one is in force (memory-plan.mts), else the fixed bound.
    const step = Math.max(1, Math.floor(lintChunkOf(RATCHET_TEXTS_PER_CHILD) / 2));
    for (let start = 0; start < unsettled.length; start += step) {
      const chunk = unsettled.slice(start, start + step);
      if (!(await judgeChunk({ chunk, cwd, scope, branch, repoRoot, run, result }))) break;
    }
  }
  return result;
}

/** One bounded chunk of the ratchet: both texts of each file linted in one child, a finding for each file whose error count rose; false on a tool error. */
async function judgeChunk({ chunk, cwd, scope, branch, repoRoot, run, result }: { chunk: readonly { file: TouchedFile; relative: string }[]; cwd: string; scope: string; branch: string; repoRoot: string; run: LinterRunner; result: RatchetResult }): Promise<boolean> {
  {
    const selected = chunk;
    const texts: LintText[] = selected.flatMap(({ file, relative }) => [...(file.base === null ? [] : [{ file: relative, text: file.base }]), { file: relative, text: file.current }]);
    const linted = await run({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], texts, bound: repoRoot });
    const results = (linted.results ?? []) as EslintResultJson[];
    if (linted.error !== undefined || results.length !== texts.length) { result.errors.push(`the lint ratchet could not lint ${scope}/: ${linted.error ?? `${String(results.length)} results for ${String(texts.length)} texts`}`); return false; }
    result.linted += selected.length;
    let at = 0;
    for (const { file } of selected) {
      const before = file.base === null ? new Map<string, number>() : errorsByRule(results[at++]);
      const now = errorsByRule(results[at++]);
      result.compared += 1;
      if (total(now) <= total(before)) continue;
      const rules = [...now].filter(([rule, count]) => count > (before.get(rule) ?? 0)).map(([rule]) => rule).sort();
      const was = file.base === null ? 'it is new, so it carries none' : `${String(total(before))} at the base`;
      result.findings.push({ code: LINT_RATCHET_RAISED, level: 'error', path: file.file, rules,
        message: `${file.file}: ${String(total(now))} lint error finding(s), ${was}; on branch ${branch} lint reports, but a commit never adds lint findings to a file it touches (raised: ${rules.join(', ')})` });
    }
  }
  return true;
}

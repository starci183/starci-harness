// rule-memo.mts - the seam through which the result cache (packages/hfs/cache/structure-memo.mts) reuses the content rules of `starci app check`.
// The rules know nothing of the cache: a per-file rule is declared as a `FileRule` (its findings for a file are a function of that file's
// bytes and the declared `deps`), a cross-file rule is wrapped in `memoKeyed` (its findings are a function of the files it reads through
// `readText` / `readJson`, which the memo records). With no memo installed (every other caller of checkRepo) both just run.
import type { CheckFinding } from './check.mjs';

/** A rule whose findings for one file depend on that file alone (and the files `deps` names), so the cache reuses them per file. */
export interface FileRule {
  /** Names the rule in its record and in the spec that proves its declaration. */
  readonly id: string;
  /** The findings over `files` (scope-relative tracked paths); every finding's `path` is one of `files`. */
  run(files: string[]): CheckFinding[];
  /** Other scope-relative files whose content the findings for `file` read. */
  deps?(file: string): string[];
}

/** What the cache gives the rule runner. */
export interface RuleMemo {
  /** The findings of `rules` over the tracked `files` of the scope at `scopeRoot` (absolute), reusing what the cache holds per file. */
  files(scopeRoot: string, files: readonly string[], rules: readonly FileRule[]): CheckFinding[];
  /** The findings of the cross-file rule `id` of the scope at `scopeRoot`, reused while every file it read and the tracked path list are unchanged. */
  keyed(scopeRoot: string, id: string, run: () => CheckFinding[]): CheckFinding[];
  /**
   * The value `compute` yields for `file` (scope-relative) of the scope at `scopeRoot`, reused while the file's bytes and `extra` (every other input the value
   * depends on, as text) are unchanged. `compute` reads only that file; the value is plain JSON; `empty` is the value a file with nothing to say yields.
   */
  unit<T>(scopeRoot: string, id: string, file: string, extra: string, empty: T, compute: () => T): T;
}

let active: RuleMemo | null = null;

/** Runs `run` with `memo` serving the per-file and cross-file rules of every checkRepo inside it. */
export function withRuleMemo<T>(memo: RuleMemo, run: () => T): T {
  const before = active;
  active = memo;
  try { return run(); } finally { active = before; }
}

/** The findings of per-file `rules` over `files`, from the cache when one is installed. Rules run in order, each over the files it must judge. */
export function memoFiles(scopeRoot: string, files: readonly string[], rules: readonly FileRule[]): CheckFinding[] {
  return active ? active.files(scopeRoot, files, rules) : rules.flatMap((rule) => rule.run([...files]));
}

/** The value of a per-file unit of a cross-file rule, from the cache when one is installed (see `RuleMemo.unit`). */
export function memoUnit<T>(scopeRoot: string, id: string, file: string, extra: string, empty: T, compute: () => T): T {
  return active ? active.unit(scopeRoot, id, file, extra, empty, compute) : compute();
}

/** The findings of a cross-file rule, from the cache when one is installed. */
export function memoKeyed(scopeRoot: string, id: string, run: () => CheckFinding[]): CheckFinding[] {
  return active ? active.keyed(scopeRoot, id, run) : run();
}

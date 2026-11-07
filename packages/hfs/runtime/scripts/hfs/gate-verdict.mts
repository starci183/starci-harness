// gate-verdict.mts - the verdict of `starci app check` and of every gate it runs: green only with zero error findings.
// A finding the branch profile reports (`report: true`) is listed and recorded but is not passed in here, so it never counts
// (contexts/project/lint.md PROJECT-LINT-2). Typecheck, build and the tests are not judged here.

/** The gate's verdict over a run's error findings: `pass` is true with no error finding; `line` says which, for the report (null when green with nothing to say). */
export interface GateVerdict { pass: boolean; count: number; line: string | null }

export function gateVerdict(errors: readonly unknown[]): GateVerdict {
  const count = errors.length;
  return { pass: count === 0, count, line: count === 0 ? null : `gate: red, ${count} error finding(s)` };
}

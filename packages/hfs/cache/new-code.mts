// new-code.mts - what a branch profile never loosens: new code. Where a profile reports lint or sonar (`dev`), the old debt is report-only and the code the branch
// changed since the merge-base with main is judged as main judges it:
//   LINT_NEW_CODE_FINDING     an ESLint error finding on a line the branch changed since the merge-base with main (the diff `newCodeSince` reads, the one the Sonar
//                             new-code prediction reads); a finding on an untouched line stays report-only
//   COVERAGE_NEW_CODE_BELOW   the predicted new-code coverage of the changed lines (the Sonar prediction of quality-baselines.mts) is below the minimum main's Sonar gate
//                             holds it to (runtime/knowledge/sonar-gate.yaml newCode.coverage.minPercent); the Sonar server's gate and Codecov stay report-only
// Both are plain errors, never marked report (gate-verdict.mts: any error that is not report-only is red). Pure: findings and predictions in, findings out.
import type { ChangedLines, Prediction } from './quality-baselines.mjs';

export const LINT_NEW_CODE = 'LINT_NEW_CODE_FINDING';
export const COVERAGE_NEW_CODE = 'COVERAGE_NEW_CODE_BELOW';

/** The fields of a linter finding this module reads (the shape of lint/run.mts `LintFinding`). */
interface LinterFinding { engine?: string; level: string; rule?: string; path?: string | null; line?: number | null; message?: string }
type Changed = ChangedLines | undefined;

/** True when the finding is an ESLint error on a line of `changed`. */
export const onChangedLine = (finding: LinterFinding, changed: Changed): boolean => {
  if (finding.engine !== 'eslint' || finding.level !== 'error' || finding.path == null || finding.line == null || changed === undefined) return false;
  return changed[finding.path]?.includes(finding.line) === true;
};

/** The blocking finding a changed-line lint finding becomes: it names the rule and the line, and says why the profile does not report it. */
export const newCodeLintFinding = (finding: LinterFinding & { path: string }, branch: string): Record<string, unknown> => ({
  code: LINT_NEW_CODE, level: 'error', path: finding.path, line: finding.line, rule: finding.rule,
  message: `${finding.path}:${String(finding.line)}: ${finding.rule ?? 'eslint'}: ${finding.message ?? ''} (a line this branch changed since the merge-base with main: on ${branch} lint reports only the old findings, new code blocks)`,
});

/** The blocking findings of the predictions: the Sonar new-code coverage under the minimum main's gate holds; nothing measurable never blocks. */
export function newCodeCoverageFindings(predictions: readonly Prediction[], branch: string): Record<string, unknown>[] {
  return predictions.flatMap((prediction) => {
    if (prediction.provider !== 'sonar' || prediction.metric !== 'new-code coverage' || prediction.value === undefined || prediction.minPercent === undefined || prediction.value >= prediction.minPercent) return [];
    return [{ code: COVERAGE_NEW_CODE, level: 'error', path: 'sonar-project.properties',
      message: `the predicted new-code coverage is ${String(prediction.value)}% (${prediction.basis}), below the ${String(prediction.minPercent)}% main's Sonar gate holds it to: on ${branch} the server's gate and Codecov report only, the coverage of the changed lines does not (a local prediction from the unit-spec records)` }];
  });
}

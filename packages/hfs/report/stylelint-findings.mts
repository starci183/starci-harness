// stylelint-findings.mts - the stylelint results of the lint gate of `starci app check` as findings, one per warning, paths app-relative.
import path from 'node:path';

/** A stylelint result as the `--formatter json` output carries it: the stylesheet and its warnings. */
export interface StylelintFileResult { source?: string; warnings?: readonly { rule?: string; text: string; line?: number; column?: number }[] }
/** One stylelint warning as a check finding. */
export interface StylelintFinding { engine: 'stylelint'; rule: string; code: string; level: 'error'; path: string; line: number | null; column: number | null; message: string }

/** The findings of stylelint results; `appRoot` makes their paths app-relative. */
export function stylelintFindings(results: readonly StylelintFileResult[], appRoot: string): StylelintFinding[] {
  return results.flatMap((result) => (result.warnings ?? []).map((warning): StylelintFinding => {
    const rule = warning.rule || 'stylelint-error';
    return { engine: 'stylelint', rule, code: rule, level: 'error', path: path.relative(appRoot, result.source ?? '').replace(/\\/g, '/'), line: warning.line ?? null, column: warning.column ?? null, message: warning.text };
  }));
}

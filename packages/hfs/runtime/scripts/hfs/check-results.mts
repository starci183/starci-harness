// Common result shaping for the slot check and its optional proof reports.
import { HfsSlotsError } from './slot-errors.mjs';

/** Attach the localized catalog explanation to every finding. */
/** A check finding: a rule code and level, with whatever fields the rule adds. */
export interface Finding { code: string; level: string; [key: string]: unknown }
/** The localized catalog explanation of one code. */
export interface Why { title: string; titleVi: string; whyVi: string; nextStepVi: string }
/** Findings counted by severity and by code. */
/** Findings counted by severity and by code. */
export interface Summary { error: number; warning: number; info: number; byCode: Record<string, { level: string; count: number; blocking?: number; reported?: number }> }

/**
 * The counts of findings as judged: `error` every error-level finding, `blocking` the ones in the verdict and `reportOnly` the ones a pending cutover, the local registry or a
 * report profile keeps out of it (`report: true`); each code of `byCode` splits its errors the same way.
 */
export function judgedCounts(findings: Finding[]): Summary & { blocking: number; reportOnly: number } {
  const errors = findings.filter((f) => f.level === 'error');
  return { ...summarize(findings), blocking: errors.filter((f) => f['report'] !== true).length, reportOnly: errors.filter((f) => f['report'] === true).length };
}

export function withWhy(findings: Finding[], why: Record<string, Why>): Finding[] {
  return findings.map((f) => {
    const entry = why[f.code];
    if (entry === undefined) throw new HfsSlotsError('HFS_MANIFEST_INVALID', `internal error: finding code ${f.code} has no failure-code catalog entry loaded (readWhy was not asked for it)`, { code: f.code });
    return { ...f, title: entry.title, titleVi: entry.titleVi, whyVi: entry.whyVi, nextStepVi: entry.nextStepVi };
  });
}

/** Count findings by severity and code without dropping report-only results. */
export function summarize(findings: Finding[]): Summary {
  const byCode: Summary['byCode'] = {};
  for (const f of findings) {
    const entry = (byCode[f.code] ??= { level: f.level, count: 0 });
    entry.count += 1;
    if (f.level === 'error') {
      if (f['report'] === true) entry.reported = (entry.reported ?? 0) + 1;
      else entry.blocking = (entry.blocking ?? 0) + 1;
    }
  }
  return {
    error: findings.filter((f) => f.level === 'error').length,
    warning: findings.filter((f) => f.level === 'warning').length,
    info: findings.filter((f) => f.level === 'info').length,
    byCode,
  };
}


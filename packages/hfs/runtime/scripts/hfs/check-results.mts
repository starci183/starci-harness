// Common result shaping for the slot check and its optional proof reports.
import { loadRuleCatalog } from './slots.mjs';

/** Attach the localized catalog explanation to every finding. */
/** A check finding: a rule code and level, with whatever fields the rule adds. */
export interface Finding { code: string; level: string; [key: string]: unknown }
/** The localized catalog explanation of one code. */
export interface Why { title: string; titleVi: string; whyVi: string; nextStepVi: string }
/** Findings counted by severity and by code. */
export interface Summary { error: number; warning: number; info: number; byCode: Record<string, { level: string; count: number }> }

export function withWhy(findings: Finding[], why: Record<string, Why>): Finding[] {
  return findings.map((f) => ({ ...f, title: why[f.code]!.title, titleVi: why[f.code]!.titleVi, whyVi: why[f.code]!.whyVi, nextStepVi: why[f.code]!.nextStepVi }));
}

/** Count findings by severity and code without dropping report-only results. */
export function summarize(findings: Finding[]): Summary {
  const byCode: Summary['byCode'] = {};
  for (const f of findings) {
    byCode[f.code] ??= { level: f.level, count: 0 };
    byCode[f.code]!.count += 1;
  }
  return {
    error: findings.filter((f) => f.level === 'error').length,
    warning: findings.filter((f) => f.level === 'warning').length,
    info: findings.filter((f) => f.level === 'info').length,
    byCode,
  };
}

/** Keep findings judged in this edition; uncatalogued refusal codes always remain. */
export function judgedFindings(findings: Finding[], edition: string, root: string): Finding[] {
  const catalog = loadRuleCatalog({ root });
  return findings.filter((finding) => catalog.judgedIn(finding.code, edition));
}

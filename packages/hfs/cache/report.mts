// report.mts - what a family says about itself: one diagnosis line, and the comparison of its findings with the ones its records held.
import { type Finding, type FamilyReport, type FamilyId, type RunMode } from './types.mjs';

/** `hfs: diff (against the cache at 1a2b3c4d5e6f), checked 12, reused 3400; findings 1 new, 4 known, 0 fixed` */
export function familyLine(report: FamilyReport): string {
  return `${report.family}: ${report.mode} (${report.reason}), checked ${report.checked}, reused ${report.reused}; findings ${report.newFindings} new, ${report.knownFindings} known, ${report.fixedFindings} fixed`;
}

const keyOf = (finding: Finding): string => `${finding.path}\0${finding.rule}\0${finding.message}`;

/** The findings this run produced against the ones the records held: new, known (held already) and fixed (held, no longer produced). */
export function compareFindings(previous: readonly Finding[], current: readonly Finding[]): { newFindings: number; knownFindings: number; fixedFindings: number } {
  const before = new Map<string, number>();
  for (const finding of previous) before.set(keyOf(finding), (before.get(keyOf(finding)) ?? 0) + 1);
  let known = 0;
  let fresh = 0;
  for (const finding of current) {
    const held = before.get(keyOf(finding)) ?? 0;
    if (held > 0) {
      known += 1;
      before.set(keyOf(finding), held - 1);
    } else fresh += 1;
  }
  let fixed = 0;
  for (const left of before.values()) fixed += left;
  return { newFindings: fresh, knownFindings: known, fixedFindings: fixed };
}

/** A family report from a decision, the work it did and the findings before and after. */
export function makeReport(input: { family: FamilyId; mode: RunMode; reason: string; checked: number; reused: number; previous: readonly Finding[]; current: readonly Finding[] }): FamilyReport {
  return { family: input.family, mode: input.mode, reason: input.reason, checked: input.checked, reused: input.reused, ...compareFindings(input.previous, input.current) };
}

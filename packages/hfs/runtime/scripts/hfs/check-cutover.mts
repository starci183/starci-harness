// check-cutover.mts - how `starci app check` judges an environment declared `cutover: {state: pending}` (contexts/project/stacks.md PROJECT-STACKS-19).
// The catalog (modules/kernel/failure-codes.yaml) is the one list of the codes a not-yet-cut-over environment may cause: each such code carries
// `cutoverTolerant: true` (any finding of it about that environment) or `cutoverTolerant: kept` (only a finding about a sealed member, or one key of
// it, that the declaration's `keep` lists). A finding of a tolerated code whose environment is pending is reported (`report: true`, `cutover: <env>`),
// never part of the verdict; every other finding still blocks, in both `--env local` and `--env prod`. The declaration itself is judged here on every
// run, uncached, because its expiry reads the clock: an unsound block is HFS_CUTOVER_DECLARATION_INVALID and a past `until` HFS_CUTOVER_EXPIRED, both
// blocking, and neither tolerates anything.
import path from 'node:path';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { readCatalogOnce } from './catalog-once.mjs';
import { FAILURE_CODES_FILE } from './check.mjs';
import { memberOfName, SEALED_NAME } from '../lib/sealed-member.mjs';
import { DECLARATION, STACK_ROOT } from '../lib/stack-declaration.mjs';
import { pendingCutovers, type CutoverDeclaration, type CutoverRead } from '../lib/stack-cutover.mjs';

export const CUTOVER_DECLARATION_INVALID = 'HFS_CUTOVER_DECLARATION_INVALID';
export const CUTOVER_EXPIRED = 'HFS_CUTOVER_EXPIRED';
const DECLARED = `${STACK_ROOT}/${DECLARATION}`;

/** How a tolerated code is tolerated: `any` finding about the pending environment, or only one about a `kept` member. */
export type CutoverTolerance = 'any' | 'kept';

/** The codes the catalog marks `cutoverTolerant`, each with how it is tolerated. */
export function cutoverTolerantCodes(root: string = skillRoot): ReadonlyMap<string, CutoverTolerance> {
  const catalog = readCatalogOnce(path.join(root, FAILURE_CODES_FILE)) as Record<string, { cutoverTolerant?: unknown } | undefined> | null;
  const codes = new Map<string, CutoverTolerance>();
  for (const [code, entry] of Object.entries(catalog ?? {})) {
    if (entry?.cutoverTolerant === true) codes.set(code, 'any');
    else if (entry?.cutoverTolerant === 'kept') codes.set(code, 'kept');
  }
  return codes;
}

/** A finding as the cutover reads it. */
export interface CutoverFinding { code?: string | null | undefined; level?: string | undefined; path?: unknown; message?: unknown; key?: unknown; environment?: unknown; report?: boolean | undefined; cutover?: string | undefined }

const ENV_FOLDER = new RegExp(`^${STACK_ROOT.replace('.', '\\.')}/([^/]+)/`, 'u');
const NAMED_ENV = /environments\.([a-z][a-z0-9-]*)[.:[]/gu;

/**
 * The stack environment a finding is about, or null: its own `environment` field; else the environment folder of its path
 * (`.starcistacks/<env>/...`); else, for a finding on the declaration file, the one environment its message names (`environments.<env>.`).
 * A finding that names no environment, or several, is about none and is never tolerated.
 */
export function findingEnvironment(finding: CutoverFinding, environments: ReadonlySet<string>): string | null {
  if (typeof finding.environment === 'string') return environments.has(finding.environment) ? finding.environment : null;
  const file = typeof finding.path === 'string' ? finding.path.replace(/\\/g, '/') : '';
  const folder = ENV_FOLDER.exec(file)?.[1];
  if (folder !== undefined) return environments.has(folder) ? folder : null;
  if (file !== DECLARED) return null;
  const named = new Set([...String(finding.message ?? '').matchAll(NAMED_ENV)].map((match) => match[1] as string));
  if (named.size !== 1) return null;
  const [only] = named;
  return only !== undefined && environments.has(only) ? only : null;
}

/** Whether a finding about `declaration`'s environment is about a member, or one key of a member, that it keeps for rollback. */
function kept(finding: CutoverFinding, declaration: CutoverDeclaration): boolean {
  const file = typeof finding.path === 'string' ? finding.path.replace(/\\/g, '/') : '';
  const name = file.split('/').pop() ?? '';
  if (!SEALED_NAME.test(name) || !file.includes('/secrets/')) return false;
  const member = memberOfName(name);
  return declaration.keep.includes(member) || (typeof finding.key === 'string' && declaration.keep.includes(`${member}/${finding.key}`));
}

/** Whether `finding` is one the pending cutover of its environment causes. */
export function cutoverTolerated(finding: CutoverFinding, pending: ReadonlyMap<string, CutoverDeclaration>, codes: ReadonlyMap<string, CutoverTolerance>): string | null {
  if (typeof finding.code !== 'string') return null;
  const tolerance = codes.get(finding.code);
  if (tolerance === undefined) return null;
  const env = findingEnvironment(finding, new Set(pending.keys()));
  const declaration = env === null ? undefined : pending.get(env);
  if (declaration === undefined) return null;
  return tolerance === 'any' || kept(finding, declaration) ? declaration.env : null;
}

/** The findings as the pending cutovers judge them: each tolerated error is report-only (`report: true`) and names its environment (`cutover`). */
export function judgedForCutover<T extends CutoverFinding>(findings: readonly T[], read: CutoverRead, codes: ReadonlyMap<string, CutoverTolerance> = cutoverTolerantCodes()): T[] {
  const pending = new Map(pendingCutovers(read).map((entry) => [entry.env, entry]));
  if (pending.size === 0) return [...findings];
  return findings.map((finding) => {
    if (finding.level !== 'error') return finding;
    const env = cutoverTolerated(finding, pending, codes);
    return env === null ? finding : { ...finding, report: true, cutover: env };
  });
}

/** The blocking findings of the declarations themselves: every shape problem, and every declaration whose `until` has passed. */
export function cutoverDeclarationFindings(read: CutoverRead, today: string): { code: string; level: 'error'; path: string; message: string }[] {
  return [
    ...read.problems.map((problem) => ({ code: CUTOVER_DECLARATION_INVALID, level: 'error' as const, path: DECLARED, message: `${DECLARED} ${problem.at}: ${problem.message}; an unsound declaration tolerates nothing` })),
    ...Object.values(read.declared).filter((entry) => entry.expired).map((entry) => ({ code: CUTOVER_EXPIRED, level: 'error' as const, path: DECLARED,
      message: `${DECLARED} environments.${entry.env}.cutover is pending until ${entry.until}, which has passed (today ${today}): finish the cutover runbook and remove the declaration, or move until with the owner's yes; an expired declaration tolerates nothing` })),
  ];
}

/** The `app check` report of each pending environment: its declaration and the codes it tolerated in this run, so a pending cutover is never silent. */
export interface CutoverReport { env: string; reason: string; until: string; keep: string[]; tolerated: Record<string, number> }

/** The reports of the pending cutovers over the judged findings. */
export function cutoverReports(read: CutoverRead, findings: readonly CutoverFinding[]): CutoverReport[] {
  return pendingCutovers(read).map((entry) => {
    const tolerated: Record<string, number> = {};
    for (const finding of findings) if (finding.cutover === entry.env && typeof finding.code === 'string') tolerated[finding.code] = (tolerated[finding.code] ?? 0) + 1;
    return { env: entry.env, reason: entry.reason, until: entry.until, keep: entry.keep, tolerated };
  });
}

/** The lines `app check` prints for the pending cutovers, or none. */
export function cutoverLines(reports: readonly CutoverReport[]): string[] {
  if (reports.length === 0) return [];
  return [
    'environments pending cutover by declaration (PROJECT-STACKS-19), every deploy to them refused (STACK_CUTOVER_PENDING) until the declaration is removed:',
    ...reports.map((report) => {
      const codes = Object.entries(report.tolerated).sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => `${code} x${String(count)}`);
      const total = Object.values(report.tolerated).reduce((sum, count) => sum + count, 0);
      return `  ${report.env}: ${report.reason} (until ${report.until}${report.keep.length > 0 ? `; keep ${report.keep.join(', ')}` : ''}); ${String(total)} finding(s) reported, not blocking${codes.length > 0 ? `: ${codes.join(', ')}` : ''}`;
    }),
  ];
}

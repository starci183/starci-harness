// check-env.mts - the environment a `starci app check` run judges for (`--env local|prod`, default local). Both environments judge the same code: hfs, format, db, wiring, lint,
// types, tests, coverage, build and audit are identical and blocking. They differ only in the findings about whether the run is fit to commit, push or release, which a developer
// iterating with locally built harness packages cannot satisfy until `starci deps install-local --restore`. Those codes are marked `localOnly: true` in modules/kernel/failure-codes.yaml,
// the one owner list; a finding of such a code that carries `local: true` (its producer saw a local-registry build as the only cause) is report-only in `local` and blocks in `prod`.
import path from 'node:path';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { readCatalogOnce } from './catalog-once.mjs';
import { FAILURE_CODES_FILE } from './check.mjs';

/** The environments `--env` accepts. */
export const CHECK_ENVS = Object.freeze(['local', 'prod'] as const);
export type CheckEnv = (typeof CHECK_ENVS)[number];
/** The environment of a run that names none: a developer machine. */
export const DEFAULT_CHECK_ENV: CheckEnv = 'local';

/** The environment `--env` names (the default when none is given), or undefined when it is none of them. */
export const checkEnvOf = (value: string | undefined): CheckEnv | undefined => CHECK_ENVS.find((env) => env === (value ?? DEFAULT_CHECK_ENV));

/** The failure codes the catalog marks `localOnly: true`: the only findings `--env local` can report instead of refuse. */
export function localOnlyCodes(root: string = skillRoot): ReadonlySet<string> {
  const catalog = readCatalogOnce(path.join(root, FAILURE_CODES_FILE)) as Record<string, { localOnly?: unknown } | undefined> | null;
  return new Set(Object.entries(catalog ?? {}).filter(([, entry]) => entry?.localOnly === true).map(([code]) => code));
}

/** A finding as the environment reads it. */
export interface EnvFinding { code?: string | null | undefined; level?: string | undefined; local?: unknown; report?: boolean | undefined }

/** Whether the finding is one a local-registry loop alone causes: a localOnly code the producer marked `local`. */
export const isLocalOnly = (finding: EnvFinding, codes: ReadonlySet<string>): boolean => finding.local === true && typeof finding.code === 'string' && codes.has(finding.code);

/** The findings as `env` judges them: in `local` each local-only finding is report-only (`report: true`, `local: true`); in `prod` nothing changes. */
export function judgedForEnv<T extends EnvFinding>(findings: readonly T[], env: CheckEnv, codes: ReadonlySet<string> = localOnlyCodes()): T[] {
  return findings.map((finding) => (env === 'local' && isLocalOnly(finding, codes) ? { ...finding, report: true } : finding));
}

/** The error findings `--env local` lists as report-only: the local-only ones. */
export const localReported = <T extends EnvFinding>(findings: readonly T[], codes: ReadonlySet<string> = localOnlyCodes()): T[] => findings.filter((finding) => finding.level === 'error' && isLocalOnly(finding, codes));

/** The verdict line of a green local run that still lists local findings, or null. */
export function localVerdictLine(reported: readonly EnvFinding[]): string | null {
  if (reported.length === 0) return null;
  return `gate: green for local (not pushable), ${String(reported.length)} local finding(s) report-only until \`starci deps install-local --restore\`: ${[...new Set(reported.map((finding) => String(finding.code)))].join(', ')}`;
}

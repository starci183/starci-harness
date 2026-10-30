// gate-threshold.mjs - the verdict of `starci app check` and `starci app lint` (owner ruling gate-threshold-20, 2026-10-30): green
// while fewer than GATE_ERROR_LIMIT error findings remain and none of them is a hard blocker, so a release is not held back finding
// by finding (5, 4, 3, ...) by the last few structural nits. A plaintext secret, a failed boot proof and a broken migration block at
// any count. Every finding is still printed; only the exit code changes. Typecheck, build and the tests are not judged here.

export const GATE_ERROR_LIMIT = 20;

/** The limit in force: policy/quality.yaml `gate.errorLimit`, handed in by the harness CLI as STARCI_GATE_ERROR_LIMIT, else 20. */
export function gateErrorLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.STARCI_GATE_ERROR_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : GATE_ERROR_LIMIT;
}
export const GATE_THRESHOLD_RULING = 'owner ruling gate-threshold-20 2026-10-30: app check and lint pass under 20 error findings with no plaintext secret, boot proof or migration finding';

/** The codes that block at any count: plaintext secrets, the boot proof, the migrations. */
export const HARD_BLOCKERS: ReadonlySet<string> = Object.freeze(new Set<string>([
  'HFS_PLAINTEXT_SECRET', 'HFS_SECRET_PLAINTEXT_FILE', 'HFS_SECRET_OUTSIDE_ENC', 'HFS_SCRIPT_PLAINTEXT_LOAD', 'RT_SECRET_TRACKED',
  'STACKS_SECRET_ENV_LITERAL', 'APP_SECRET_IN_CI', 'BE_LOG_SECRET',
  'BE_APP_BOOT_PROOF_MISSING',
  'DB_MIGRATION_SHAPE', 'DB_MIGRATION_DESTRUCTIVE', 'LITE_DB_MIGRATION', 'BE_MIGRATION_REVERSIBLE',
]));

/**
 * The verdict over the error findings (each with `code`): { pass, count, hard, line }. `pass` is true when no hard blocker is
 * among them and there are fewer than GATE_ERROR_LIMIT; `line` says which, for the report.
 */
/** The gate's verdict over a run's error findings. */
export interface GateVerdict { pass: boolean; count: number; hard: string[]; line: string | null }

export function gateVerdict(errors: readonly { code: string | null }[], limit: number = gateErrorLimit()): GateVerdict {
  const hard = [...new Set(errors.map((finding) => finding.code).filter((code): code is string => code !== null && HARD_BLOCKERS.has(code)))].sort();
  const count = errors.length;
  const pass = hard.length === 0 && count < limit;
  const line = count === 0 ? null
    : hard.length > 0 ? `gate: red, ${hard.join(', ')} block${hard.length === 1 ? 's' : ''} at any count (${count} error finding(s))`
      : pass ? `gate: green under the threshold, ${count} error finding(s) < ${limit} and no hard blocker (owner ruling gate-threshold-20); they stay listed above`
        : `gate: red, ${count} error finding(s), the threshold is fewer than ${limit}`;
  return { pass, count, hard, line };
}

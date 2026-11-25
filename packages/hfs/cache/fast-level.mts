// fast-level.mts - `starci app check --level dev`, the FAST level of the two-level gate (contexts/project/cicd.md "Gate levels"). A lane landing on dev and a push of dev run
// only what breaks dev for everyone at once: the type check (the packages it reads built and the app's codegen first, as the types family does), the lane's own
// business tests (the unit specs its diff adds or touches and the specs whose closure reaches a changed file, Jest's --findRelatedTests by the closure resolver the
// test family keys on), and the database step (a screen's design needs no owner approval, owner decision 2026-11-25).
// The CLI adds the deps check. Everything else (the hfs rule sweep, the first audits and the stale or missing ui-audit blocks, the project and nivoos package checks,
// the whole unit suite and its coverage, lint, format, wiring, sonar, the CI build and the audit) runs ONCE at the main cut, `--level full`, and a red full run is fixed
// in a hardening lane before the cut. The fast level keeps no test records and judges no coverage: the full level owns both.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { createJestEnvironment, type JestEnvironment } from './test-family.mjs';
import type { FamilyId } from './types.mjs';

/** The levels of `app check`: `full` (the default, every gate, the main cut and the release verbs) and `dev` (the fast level of a landing on dev). */
export const CHECK_LEVELS = ['full', 'dev'] as const;
export type CheckLevel = (typeof CHECK_LEVELS)[number];

/** The level a `--level` value names, undefined for an unknown one; no value is the full level. */
export const checkLevelOf = (value: string | undefined): CheckLevel | undefined => (value === undefined ? 'full' : CHECK_LEVELS.find((level) => level === value));

/** The families the fast level runs: the type check (with its package builds and codegen), the lane's own tests and the database step. */
export const FAST_FAMILIES: readonly FamilyId[] = ['types', 'test', 'db'];

/** What the fast level runs, by name, in the order of the start line: the CLI's deps check is the last. */
export const FAST_GATES: readonly string[] = ['types (package builds, codegen, tsc)', "the lane's own tests (changed and related unit specs)", 'db', 'deps (the CLI)'];

/** What the fast level skips, each run once at the main cut (`app check --level full`). */
export const FAST_SKIPPED: readonly string[] = [
  'hfs rule sweep (structure, machine, unused-symbol, contract-emit, secrets)',
  'rule-188 first audits and the ui-audit stale and missing blocks (uiaudit)',
  'project and nivoos package checks (checks)',
  'whole-repo tests and coverage',
  'lint', 'format', 'wiring', 'sonar', 'build', 'audit',
];

/** The one line the fast level prints first: what it runs, what it skips, and that the skipped gates run at the main cut. */
export const fastLevelLine = (): string => `check --level dev (fast): runs ${FAST_GATES.join(', ')}; skips ${FAST_SKIPPED.join(', ')}: they run once at the main cut (app check --level full)`;

/** A changed path as the closure lists it: app-relative posix. */
const posix = (file: string): string => file.replaceAll('\\', '/');

/**
 * The lane's own specs of `jest`: every spec the diff adds or touches, and every spec whose closure (what Jest's resolver reaches from it, the project's setup
 * files included) holds a changed file. A setup file every spec loads relates every spec: its change runs them all, as Jest's --findRelatedTests would.
 */
export function laneSpecs(jest: Pick<JestEnvironment, 'specs' | 'closureOf'>, changed: readonly string[]): string[] {
  const touched = new Set(changed.map(posix));
  if (touched.size === 0) return [];
  return jest.specs.filter((spec) => touched.has(spec) || jest.closureOf(spec).some((file) => touched.has(file)));
}

/** What the lane's tests came to: the specs run, the ones that failed and the lines the run prints. */
export interface LaneTests {
  readonly ran: readonly string[];
  readonly failed: readonly string[];
  readonly findings: CheckFinding[];
  readonly lines: string[];
}

/**
 * Runs the lane's own unit specs of the back end through the app's Jest (`--runTestsByPath`), judged by the per-spec verdict the preset's reporter writes; a spec
 * that wrote no verdict failed. No record is stored and no coverage threshold judged. `jest` is a seam for the specs.
 */
export async function runLaneTests({ repoRoot, tracked, changed, execute, jest: given }: { repoRoot: string; tracked: readonly string[]; changed: readonly string[]; execute?: HeavyNodeRun | undefined; jest?: JestEnvironment }): Promise<LaneTests> {
  if (given === undefined && !tracked.some((file) => file.startsWith('be/'))) return { ran: [], failed: [], findings: [], lines: ['  lane tests: no be/ side, nothing to run'] };
  const jest = given ?? (await createJestEnvironment({ appRoot: repoRoot, side: 'be', execute }));
  const specs = laneSpecs(jest, changed);
  if (specs.length === 0) return { ran: [], failed: [], findings: [], lines: [`  lane tests: none of ${String(jest.specs.length)} unit spec(s) is changed or reaches a changed file`] };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-lane-tests-'));
  try {
    const outcome = await jest.run(specs, scratch);
    const passed = new Set(jest.readCoverage(scratch).filter((file) => file.passed).map((file) => posix(path.posix.join('be', file.spec))));
    const failed = specs.filter((spec) => !passed.has(spec));
    const findings: CheckFinding[] = failed.map((spec) => ({ code: 'JEST_SPEC_FAILED', level: 'error', engine: 'jest', path: spec, message: `${spec} failed or reported no verdict (exit ${String(outcome.status)}); run npm test -- ${spec} for its output` }));
    return { ran: specs, failed, findings, lines: [`  lane tests: ran ${String(specs.length)} of ${String(jest.specs.length)} unit spec(s) the diff touches or reaches, ${String(failed.length)} failed`] };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

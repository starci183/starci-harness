// run.mts - one `starci app check` / `starci app lint` pass over the selected families, against one session. It owns the order of the families,
// the judging of their findings (edition and the Vietnamese why of every code) and the merge into the one result the verb prints and the gate
// judges, so the two verbs never hold two answers for one tree.
import { skillRoot } from '../runtime/engine/runtime-root.mjs';
import { readWhy, type CheckFinding, type RepositoryResult } from '../runtime/scripts/hfs/check.mjs';
import { judgedFindings, summarize, withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import type { Presets } from '../sync/index.mjs';
import type { Prettier } from '../sync/format.mjs';
import { runDbFamily } from './db-family.mjs';
import { runFormatFamily } from './format-family.mjs';
import { runStructurePass } from './hfs-family.mjs';
import { runWiringFamily } from './wiring-family.mjs';
import { FAMILIES, type CheckSession, type FamilyId, type FamilyReport } from './types.mjs';

/** The families of a run with no selector, in the order they run. Families a work package adds register in `extraFamilies`. */
export const DEFAULT_FAMILIES: readonly FamilyId[] = FAMILIES.filter((family) => ['hfs', 'format', 'db', 'secrets', 'wiring', 'lint'].includes(family));

export interface AppRunInput {
  readonly repoRoot: string;
  readonly tracked: readonly string[];
  readonly session: CheckSession;
  readonly selected: ReadonlySet<FamilyId>;
  readonly harness?: { version?: string } | undefined;
  readonly presets?: Presets | undefined;
  readonly prettier?: Prettier | undefined;
  readonly edition?: string | undefined;
  /** Limits the formatter to these app-relative files (`app lint --changed`). */
  readonly only?: readonly string[] | undefined;
  /** The ref the baseline database rules compare with, when the caller names one. */
  readonly base?: string | undefined;
}

export interface AppRunResult extends RepositoryResult {
  readonly families: readonly FamilyReport[];
  /** The wiring proof, when the wiring family ran. */
  wiring?: { status: string; apps: string[]; findings: CheckFinding[] };
}

const emptyResult = (repoRoot: string, tracked: number): RepositoryResult => ({
  ok: true, repoRoot, manifest: '', profile: null, apps: [], tracked, findings: [], counts: summarize([]),
  machine: { status: 'skipped', reason: 'the structure family was not selected' },
});

/** Runs the selected families against `session` and merges their findings. The caller flushes the session. */
export async function runAppFamilies(input: AppRunInput): Promise<AppRunResult> {
  const { repoRoot, session, selected } = input;
  const reports: FamilyReport[] = [];
  const track = (report: FamilyReport | null | undefined): void => void (report && reports.push(report));
  const structure = selected.has('hfs') || selected.has('secrets');
  const pass = structure
    ? await runStructurePass(session, { repoRoot, harness: input.harness, presets: input.presets, tracked: input.tracked, hfs: selected.has('hfs'), secrets: selected.has('secrets') })
    : null;
  if (pass) { track(pass.report); track(pass.secretsReport); }
  const base: RepositoryResult = pass?.result ?? emptyResult(repoRoot, input.tracked.length);
  const extra: CheckFinding[] = [];
  if (selected.has('format')) {
    const formatted = await runFormatFamily(session, { files: input.only ?? input.tracked, prettier: input.prettier });
    track(formatted.report);
    extra.push(...formatted.findings);
  }
  if (selected.has('db')) {
    const database = await runDbFamily(session, { repoRoot, tracked: input.tracked, base: input.base });
    track(database.report);
    extra.push(...database.findings);
  }
  let wiring: AppRunResult['wiring'];
  if (selected.has('wiring')) {
    const proved = await runWiringFamily(session, { repoRoot, edition: input.edition, files: input.tracked });
    track(proved.report);
    wiring = { status: proved.wiring.status, apps: proved.wiring.apps, findings: proved.wiring.findings as unknown as CheckFinding[] };
    extra.push(...(proved.wiring.findings as unknown as CheckFinding[]));
  }
  const edition = input.edition ?? declaredEdition(repoRoot);
  const judged = extra.length === 0 ? [] : withWhy(judgedFindings(extra, edition, skillRoot), readWhy(skillRoot, [...new Set(extra.map((finding) => finding.code))])) as CheckFinding[];
  // A family's findings reach the result once: the pass already holds the ones the always-run rules produced.
  const findings = [...base.findings, ...judged];
  const counts = summarize(findings);
  return { ...base, findings, counts, ok: counts.error === 0, families: reports, ...(wiring ? { wiring } : {}) };
}

function declaredEdition(repoRoot: string): string {
  try { return readRepoDeclaration(loadSlotManifest(), repoRoot).edition ?? 'full'; } catch { return 'full'; }
}

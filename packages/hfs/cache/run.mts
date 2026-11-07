// run.mts - the app pass of `starci app check`: the structure, format, db and wiring families as steps of the check graph (schedule.mts), and the one
// merge of their findings (edition and the Vietnamese why of every code) into the result the verb prints and the gate judges, so the two verbs never hold
// two answers for one tree.
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { skillRoot } from '../runtime/engine/runtime-root.mjs';
import { readWhy, type CheckFinding, type RepositoryResult } from '../runtime/scripts/hfs/check.mjs';
import { judgedFindings, summarize, withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { withLandedMigrationsKnown } from '../runtime/scripts/hfs/rules/database-landed.mjs';
import type { Presets } from '../sync/index.mjs';
import type { Prettier } from '../sync/format.mjs';
import { runDbFamily } from './db-family.mjs';
import { runFormatFamily } from './format-family.mjs';
import { runStructurePass, type PassResult } from './hfs-family.mjs';
import { runWiringFamily } from './wiring-family.mjs';
import { FAMILIES, type CheckSession, type FamilyId, type FamilyReport } from './types.mjs';

/** The families of a run with no selector. Families a work package adds register in `extraFamilies`. */
export const DEFAULT_FAMILIES: readonly FamilyId[] = FAMILIES.filter((family) => ['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar'].includes(family));

export interface AppRunInput {
  readonly repoRoot: string;
  readonly execute?: HeavyNodeRun | undefined;
  readonly tracked: readonly string[];
  readonly session: CheckSession;
  readonly selected: ReadonlySet<FamilyId>;
  readonly harness?: { version?: string } | undefined;
  readonly presets?: Presets | undefined;
  readonly prettier?: Prettier | undefined;
  readonly edition?: string | undefined;
  /** Limits the formatter to these app-relative files. */
  readonly only?: readonly string[] | undefined;
  /** The ref the baseline database rules compare with, when the caller names one. */
  readonly base?: string | undefined;
}

export interface AppRunResult extends RepositoryResult {
  readonly families: readonly FamilyReport[];
  /** The wiring proof, when the wiring family ran. */
  wiring?: { status: string; apps: string[]; findings: CheckFinding[] };
}

/** What the app pass steps answered, each set by its own step: the structure pass, and the findings of format, db and wiring. */
export interface AppPassParts {
  pass?: PassResult | null;
  format?: CheckFinding[];
  db?: CheckFinding[];
  wiring?: { status: string; apps: string[]; findings: CheckFinding[] };
}

const emptyResult = (repoRoot: string, tracked: number): RepositoryResult => ({
  ok: true, repoRoot, manifest: '', profile: null, apps: [], tracked, findings: [], counts: summarize([]),
  machine: { status: 'skipped', reason: 'the structure family was not selected' },
});

/** The structure step (`hfs`, and `secrets`, which the same pass finds). */
export async function runStructureStep(input: AppRunInput, parts: AppPassParts): Promise<void> {
  const { selected } = input;
  parts.pass = await runStructurePass(input.session, { repoRoot: input.repoRoot, harness: input.harness, presets: input.presets, tracked: input.tracked, hfs: selected.has('hfs'), secrets: selected.has('secrets'), execute: input.execute });
}

/** The format step. */
export async function runFormatStep(input: AppRunInput, parts: AppPassParts): Promise<void> {
  parts.format = (await runFormatFamily(input.session, { files: input.only ?? input.tracked, prettier: input.prettier })).findings;
}

/** The db step. */
export async function runDbStep(input: AppRunInput, parts: AppPassParts): Promise<void> {
  parts.db = (await runDbFamily(input.session, { repoRoot: input.repoRoot, tracked: input.tracked, base: input.base })).findings;
}

/** The wiring step: the boot proof. */
export async function runWiringStep(input: AppRunInput, parts: AppPassParts): Promise<void> {
  const proved = await runWiringFamily(input.session, { repoRoot: input.repoRoot, edition: input.edition, files: input.tracked, execute: input.execute });
  parts.wiring = { status: proved.wiring.status, apps: proved.wiring.apps, findings: proved.wiring.findings as unknown as CheckFinding[] };
}

/** Merges what the app pass steps answered into one result, in family order whatever order they ended in. The caller flushes the session. */
export function mergeAppPass(input: Pick<AppRunInput, 'repoRoot' | 'tracked' | 'edition' | 'base'>, parts: AppPassParts, reports: readonly FamilyReport[]): AppRunResult {
  const { repoRoot } = input;
  const base: RepositoryResult = parts.pass?.result ?? emptyResult(repoRoot, input.tracked.length);
  const extra: CheckFinding[] = [...(parts.format ?? []), ...(parts.db ?? []), ...(parts.wiring?.findings ?? [])];
  const edition = input.edition ?? declaredEdition(repoRoot);
  const judged = extra.length === 0 ? [] : withWhy(judgedFindings(extra, edition, skillRoot), readWhy(skillRoot, [...new Set(extra.map((finding) => finding.code))])) as CheckFinding[];
  // A family's findings reach the result once: the pass already holds the ones the always-run rules produced. A migration already on the
  // base is immutable, so what only a rewrite of it could clear is reported as a known item (R259, database-landed.mts).
  const findings = withLandedMigrationsKnown([...base.findings, ...judged], { repoRoot, base: input.base });
  const counts = summarize(findings);
  return { ...base, findings, counts, ok: counts.error === 0, families: reports, ...(parts.wiring ? { wiring: parts.wiring } : {}) };
}

function declaredEdition(repoRoot: string): string {
  try { return readRepoDeclaration(loadSlotManifest(), repoRoot).edition ?? 'full'; } catch { return 'full'; }
}

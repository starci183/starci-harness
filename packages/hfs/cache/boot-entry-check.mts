// boot-entry-check.mts - the boot entry check of `starci app check` (R448, contexts/code/be/injection.md BE-INJECTION-6): for each back-end app hfs.json
// `sides.be.apps[].boot` declares, the composition root a command of the app boots is composed for real, without listening (runtime/scripts/hfs/app-boot.mts).
// It runs inside the `checks` step, beside the project checks and the nivoos package checks, so it runs wherever the hfs gate runs: a project that switched the
// wiring gate off still has the entry it declared composed (the incident: wiring off, a provider injecting a token its module did not import, the stack seed
// down for forty minutes). Its verdict is scoped (cache/check-verdicts.mts, step `boot-entry`): keyed on the back-end side (tracked and untracked program
// inputs), the tracked files of `packages/` and `hfs.json`, the declared entries, the lockfile, the Node major and the harness, so an unchanged key reuses it;
// a timeout reached no verdict and is never stored.
import fs from 'node:fs';
import path from 'node:path';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { appBootAsync, bootEntries, type BootRepo, type BootResult } from '../runtime/scripts/hfs/app-boot.mjs';
import { BOOT_PROOF_TIMEOUT, type WiringFinding } from '../runtime/scripts/hfs/app-wiring.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { VerdictBook, verdictKey, VERDICT_FOLDER, type VerdictKey } from './check-verdicts.mjs';
import { sideKey } from './side-key.mjs';
import type { CheckSession } from './types.mjs';

/** The step of the boot entry verdict in the records of check/build. */
export const BOOT_ENTRY_STEP = 'boot-entry';
const RECORD_ID = BOOT_ENTRY_STEP;

/** hfs.json at `repoRoot`, or undefined when it cannot be read (the structure pass judges that). */
function declarationOf(repoRoot: string): BootRepo | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')) as BootRepo; } catch { return undefined; }
}

/** The key of the verdict: the back-end side and what else the composition may read, plus the declared entries. */
function keyOf(session: CheckSession, repoRoot: string, repo: BootRepo): VerdictKey {
  const extra: Record<string, string> = { '#boots': JSON.stringify(bootEntries(repo)) };
  if (repo.sides === undefined) return verdictKey(session, ['.'], extra);
  const side = sideKey(repoRoot, session.index, 'be');
  const base = verdictKey(session, ['packages', 'hfs.json'], { ...extra, '#side': side.key });
  return { key: base.key, inputs: [...base.inputs, ...side.inputs], captured: { ...base.captured, ...side.hashes } };
}

const finding = (item: WiringFinding): CheckFinding => ({ code: item.code, level: item.level, path: item.path, message: item.message });

/** The lines of a result, one per declared app: `boot entry <app>: green|red|not judged`. */
const linesOf = (result: Pick<BootResult, 'states'>, reused: boolean): string[] => result.states.map(({ app, state }) => `  boot entry ${app}: ${state}${reused ? ' (reused, nothing it reads changed)' : ''}`);

/**
 * Runs the declared boot entries: their findings (a Nest wiring error, an error; a failure outside the wiring, a warning) and one line per app. With a `session`, an unchanged key takes the
 * verdict recorded for it; `boot` replaces the run (a spec's seam). An app that declares none runs nothing and its stale verdict is dropped.
 */
export async function runBootEntryChecks({ repoRoot, session, execute, boot }: { repoRoot: string; session?: CheckSession | undefined; execute?: HeavyNodeRun | undefined; boot?: ((repo: BootRepo) => Promise<BootResult> | BootResult) | undefined }): Promise<{ findings: CheckFinding[]; lines: string[] }> {
  const repo = declarationOf(repoRoot);
  const book = session === undefined ? undefined : new VerdictBook(session, BOOT_ENTRY_STEP, session.decide('hfs').mode === 'diff');
  if (repo === undefined || bootEntries(repo).length === 0) {
    if (session !== undefined && session.records(VERDICT_FOLDER).some((record) => record.step === BOOT_ENTRY_STEP)) book?.finish();
    return { findings: [], lines: [] };
  }
  const keyed = session === undefined ? undefined : keyOf(session, repoRoot, repo);
  const held = keyed === undefined ? undefined : book?.held(RECORD_ID, keyed);
  if (held !== undefined) {
    let reused: BootResult | undefined;
    try { reused = JSON.parse(held.message) as BootResult; } catch { reused = undefined; }
    if (reused !== undefined && Array.isArray(reused.findings) && Array.isArray(reused.states)) {
      book?.finish();
      return { findings: reused.findings.map(finding), lines: linesOf(reused, true) };
    }
  }
  const result = await (boot === undefined ? appBootAsync({ repoRoot, repo, execute }) : boot(repo));
  const timedOut = result.findings.some((item) => item.code === BOOT_PROOF_TIMEOUT);
  if (keyed !== undefined && !timedOut) book?.put(RECORD_ID, keyed, { red: result.findings.some((item) => item.level === 'error'), message: JSON.stringify({ findings: result.findings, states: result.states }) });
  book?.finish();
  return { findings: result.findings.map(finding), lines: linesOf(result, false) };
}

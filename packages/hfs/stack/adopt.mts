// adopt.mts - the first release of a renamed stack takes over the data of the stack it was renamed from (`stack deploy --adopt`, PROJECT-STACKS-18).
// A new stack name has no accepted release, so a plain deploy would take the first start, which refuses a populated database (STACK_FIRST_START_NOT_EMPTY).
// `--adopt` replaces the first start when `deploy.renamedFrom` proves where the data came from:
//   preflight   (before anything changes) renamedFrom is declared, this stack has no accepted release, every new volume of the map exists and is not empty,
//               the old stack runs nothing (it is in standby: `stack standby --renamed-from`), its journal holds that standby, and its release store names
//               its last accepted release, the rollback target of the adopted release (STACK_ADOPT_*)
//   record      the release record (`adoptedFrom` in release.json) and the attempt journal (`adopted`) name the old stack, its last release, its standby
//               and the volume map
//   adopt step  a `stack` database: the hold deploy starts the database alone on the copied volume; the step proves it carries a migration history
//               (STACK_ADOPT_NO_HISTORY otherwise) and runs the plain deploy path inside it: migrate preview, a verified backup when something is pending,
//               the expand migrations. Then the real deploy, converge, seed, post-deploy, verify, accept and the contract migrations, as any deploy.
//   rollback    a failed adopted deploy, or `stack rollback` of the adopted release, puts the new stack in standby and resumes the old stack from its standby
//               record: the old stack's last release runs again on its own, untouched volumes. Its stored bytes are never redeployed under the new name.
import fs from 'node:fs';
import path from 'node:path';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { expandPhase, FIRST_START_WAIT_SECONDS, messageOf } from './db-phases.mjs';
import type { PhaseInput, PhaseResult } from './db-phases.mjs';
import { refusal } from './errors.mjs';
import type { Recorder } from './journal.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import type { ActionResult, Runner } from './remote.mjs';
import { gateIsOn } from './ssh-gate.mjs';
import { isRunning, lastQuiet, quietStack, renamedSource, resumeRecorded, stackServiceFacts, standbyRecord } from './standby.mjs';
import { volumeEmpty, volumeExists } from './volume.mjs';

/** What the release record and the journal keep of an adopted first release. */
export interface AdoptedFrom { stack: string; releasesBase: string; release: string; standby: string; volumes: Record<string, string> }

/** The old stack's release store over the same manager runner (its releases base, lock and journal). */
export const sourceStore = (ctx: Pick<StackContext, 'env'>, config: DeployConfig, run: Runner): ReleaseStore => createReleaseStore(renamedSource(config, 'STACK_ADOPT_UNDECLARED'), run, { gated: gateIsOn(ctx.env) });

/**
 * Everything `--adopt` proves before the deploy changes anything (see the header); returns the record of the adoption. `previous` is this stack's accepted
 * release ('' when none). A volume is judged empty with the pinned backup image when the environment declares one.
 */
export async function adoptPreflight(ctx: StackContext, config: DeployConfig, run: Runner, previous: string): Promise<AdoptedFrom> {
  const from = config.renamedFrom;
  if (!from) throw refusal('STACK_ADOPT_UNDECLARED', `--adopt takes over the data of the stack this one was renamed from: declare environments.${config.env}.deploy.renamedFrom; nothing was changed`);
  if (previous) throw refusal('STACK_ADOPT_ALREADY_ACCEPTED', `stack ${config.stack} already has the accepted release ${previous}: only its first release adopts; deploy without --adopt; nothing was changed`);
  for (const [next, old] of Object.entries(from.volumes)) {
    if (!volumeExists(ctx, next)) throw refusal('STACK_ADOPT_VOLUME_MISSING', `the volume ${next} does not exist: create it (stack prepare --env ${config.env} --execute) and copy ${old} into it (stack volume copy --env ${config.env} --execute); nothing was changed`);
    if (config.backup?.image && volumeEmpty(ctx, config.backup.image, next)) throw refusal('STACK_ADOPT_VOLUME_EMPTY', `the volume ${next} is empty: copy ${old} into it first (stack volume copy --env ${config.env} --execute); nothing was changed`);
  }
  const running = stackServiceFacts(ctx, from.stack).filter(isRunning).map((service) => service.name);
  if (running.length > 0) throw refusal('STACK_ADOPT_SOURCE_RUNNING', `the old stack ${from.stack} still runs ${running.join(', ')}: put it in standby first (stack standby --env ${config.env} --renamed-from --execute), so it neither writes nor routes; nothing was changed`);
  const store = sourceStore(ctx, config, run);
  let release: string;
  let documents: Record<string, unknown>[];
  try {
    release = await store.current();
    documents = await store.journals();
  } catch (error) {
    throw refusal('STACK_ADOPT_SOURCE_UNREADABLE', `the release store of ${from.stack} at ${from.releasesBase} cannot be read (${messageOf(error)}); nothing was changed`);
  }
  if (!release) throw refusal('STACK_ADOPT_SOURCE_NO_RELEASE', `the old stack ${from.stack} has no accepted release under ${from.releasesBase}: there is no rollback target for the adopted release; nothing was changed`);
  const quiet = lastQuiet(documents);
  if (!quiet || quiet.kind !== 'standby') throw refusal('STACK_ADOPT_SOURCE_NOT_STANDBY', `the journal of ${from.stack} holds no standby since its last resume: stop it with stack standby --env ${config.env} --renamed-from --execute, so a rollback can resume it; nothing was changed`);
  return { stack: from.stack, releasesBase: from.releasesBase, release, standby: quiet.attempt, volumes: { ...from.volumes } };
}

/** Writes `adoptedFrom` into the rendered release record (release.json) before it is stored; the release id (the stack bytes' digest) is unchanged. */
export function recordAdoption(out: string, adopted: AdoptedFrom): void {
  const file = path.join(out, 'release.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(file, `${JSON.stringify({ ...record, adoptedFrom: adopted }, null, 2)}\n`);
}

/** The `adoptedFrom` of a stored release record, or null. */
export function adoptedOf(release: Record<string, unknown>): AdoptedFrom | null {
  const value = release.adoptedFrom as Partial<AdoptedFrom> | undefined;
  if (!value || typeof value.stack !== 'string' || typeof value.releasesBase !== 'string' || typeof value.release !== 'string') return null;
  return { stack: value.stack, releasesBase: value.releasesBase, release: value.release, standby: String(value.standby ?? ''), volumes: (value.volumes ?? {}) as Record<string, string> };
}

/**
 * The `adopt` step of a `stack` database, between the hold deploy and the real one: the database container on the copied volume, the proof that it carries
 * a migration history (it is the old stack's data, not an empty volume), then the expand phase of every deploy inside it.
 */
export async function adoptStep(p: PhaseInput): Promise<{ result: { ok: boolean; code?: string; lines: string[] }; phase: PhaseResult | null }> {
  const { ctx, config, database, f } = p;
  const service = `${config.stack}_${database.service}`;
  const container = await f.dbContainer(ctx, config, { service: database.service, seconds: FIRST_START_WAIT_SECONDS });
  if (!container) return { result: { ok: false, code: 'STACK_ADOPT_NO_DATABASE', lines: [`adopt: no running container of ${service} accepted connections within ${FIRST_START_WAIT_SECONDS}s`] }, phase: null };
  const state = await f.emptiness(ctx, f.containerTarget(ctx, container));
  if (!state.history) {
    return { result: { ok: false, code: 'STACK_ADOPT_NO_HISTORY', lines: [`adopt refused: the database of ${service} carries no migration history (${state.publicTables < 0 ? 'an unreadable count of' : state.publicTables} table(s) in public): it is not the copied data of the old stack; copy the old database volume into the new one (stack volume copy) before --adopt`] }, phase: null };
  }
  const expanded = await expandPhase(p);
  const lines = [`adopt: the database of ${service} carries its migration history: the plain deploy path runs`, ...expanded.lines];
  return { result: expanded.ok ? { ok: true, lines } : { ok: false, code: expanded.refused?.code ?? 'STACK_DEPLOY_MIGRATE_FAILED', lines: [...lines, `adopt: ${expanded.refused?.message ?? 'the deploy path is red'}`] }, phase: expanded };
}

/**
 * The way back of an adopted release: the new stack in standby (writers, stores, routes; inside the caller's attempt, under its lock), then the old stack
 * resumed from its standby record as a recorded attempt under its own lock. Returns the lines and whether the old stack runs again.
 */
export async function adoptRollback(ctx: StackContext, config: DeployConfig, run: Runner, adopted: AdoptedFrom, rec: Recorder | null, seconds = 300): Promise<ActionResult> {
  const lines = [`ROLLING BACK the adopted release: ${config.stack} goes into standby and ${adopted.stack} resumes its last release ${adopted.release} on its own volumes`];
  const record = standbyRecord(ctx, stackServiceFacts(ctx, config.stack), null);
  // The attempt keeps the record, so `stack resume --env <env>` can give this stack back later (lastQuiet reads any attempt that recorded a standby).
  rec?.note({ standby: record });
  const quiet = await quietStack(ctx, config, record, seconds, rec);
  lines.push(...quiet.lines);
  if (!quiet.ok) return { ok: false, lines: [...lines, `ROLLBACK DID NOT FINISH: ${config.stack} is not fully stopped; ${adopted.stack} was NOT resumed (two stacks must never serve the same hosts): follow the stack runbook, Rollback`] };
  const source = renamedSource(config, 'STACK_ADOPT_UNDECLARED');
  let resumed: ActionResult;
  try {
    resumed = await resumeRecorded(ctx, source, sourceStore(ctx, config, run), { timeoutSeconds: seconds });
  } catch (error) {
    resumed = { ok: false, lines: [messageOf(error)] };
  }
  lines.push(...resumed.lines);
  return { ok: resumed.ok, lines: [...lines, resumed.ok ? `rolled back: ${adopted.stack} serves its release ${adopted.release} again` : `ROLLBACK DID NOT FINISH: ${adopted.stack} did not resume: stack resume --env ${config.env} --renamed-from --execute`] };
}

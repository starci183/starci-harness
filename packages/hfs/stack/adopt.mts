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
// A Postgres major upgrade that keeps the stack name (`deploy.dbUpgrade`, PROJECT-STACKS-19) adopts the same way: the preflight proves this stack has an
// accepted release (the rollback target, on the old volume with the old image), its database runs nothing, the newest `db-upgrade` attempt of its journal
// is done and restored into the declared new volume with the db image this deploy runs (STACK_ADOPT_UPGRADE_*); then the same hold deploy and adopt step.
// Its rollback is a plain one (stack rollback --data-acknowledged, STACK_ROLLBACK_UPGRADED_DATA without it).
//   rollback    a failed adopted deploy, or `stack rollback` of the adopted release, puts the new stack in standby and resumes the old stack from its standby
//               record: the old stack's last release runs again on its own, untouched volumes. Its stored bytes are never redeployed under the new name.
import fs from 'node:fs';
import path from 'node:path';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { declaredDatabase, expandPhase, FIRST_START_WAIT_SECONDS, messageOf } from './db-phases.mjs';
import type { PhaseInput, PhaseResult } from './db-phases.mjs';
import { upgradePair } from './db-upgrade.mjs';
import { refusal } from './errors.mjs';
import type { Recorder } from './journal.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import type { ActionResult, Runner } from './remote.mjs';
import { gateIsOn } from './ssh-gate.mjs';
import { isRunning, lastQuiet, quietStack, renamedSource, resumeRecorded, stackServiceFacts, standbyRecord } from './standby.mjs';
import { volumeEmpty, volumeExists } from './volume.mjs';

/** What the release record and the journal keep of an adopted first release. */
export interface AdoptedFrom {
  stack: string; releasesBase: string; release: string; standby: string; volumes: Record<string, string>;
  /** `upgrade`: a Postgres major upgrade of this same stack (its db-upgrade attempt in `upgrade`); absent: the data of a renamed stack. */
  kind?: 'upgrade' | undefined; upgrade?: string | undefined;
}

/** The old stack's release store over the same manager runner (its releases base, lock and journal). */
export const sourceStore = (ctx: Pick<StackContext, 'env'>, config: DeployConfig, run: Runner): ReleaseStore => createReleaseStore(renamedSource(config, 'STACK_ADOPT_UNDECLARED'), run, { gated: gateIsOn(ctx.env) });

/**
 * Everything `--adopt` proves before the deploy changes anything (see the header); returns the record of the adoption. `previous` is this stack's accepted
 * release ('' when none). A volume is judged empty with the pinned backup image when the environment declares one.
 */
export async function adoptPreflight(ctx: StackContext, config: DeployConfig, run: Runner, previous: string, images: Record<string, string> = {}): Promise<AdoptedFrom> {
  const from = config.renamedFrom;
  if (!from && config.dbUpgrade) return upgradePreflight(ctx, config, run, previous, images);
  if (!from) throw refusal('STACK_ADOPT_UNDECLARED', `--adopt takes over the data of the stack this one was renamed from (deploy.renamedFrom) or of a database upgrade (deploy.dbUpgrade): declare one in environments.${config.env}.deploy; nothing was changed`);
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

/** The adoption of a Postgres major upgrade of this same stack (see the header). */
async function upgradePreflight(ctx: StackContext, config: DeployConfig, run: Runner, previous: string, images: Record<string, string>): Promise<AdoptedFrom> {
  const database = await declaredDatabase(ctx, config);
  if (!database || database.target !== 'stack') throw refusal('STACK_ADOPT_NO_DATABASE', 'deploy.dbUpgrade adopts the upgraded volume of a database the stack runs itself (database.target: stack); nothing was changed');
  if (!previous) throw refusal('STACK_ADOPT_UPGRADE_NO_RELEASE', `stack ${config.stack} has no accepted release: an upgrade adopts into a stack that ran before, whose last release is the rollback target; nothing was changed`);
  const pair = upgradePair(config, database.service);
  if (!volumeExists(ctx, pair.to)) throw refusal('STACK_ADOPT_VOLUME_MISSING', `the upgraded volume ${pair.to} does not exist: run stack db-upgrade --env ${config.env} --execute first; nothing was changed`);
  const service = `${config.stack}_${database.service}`;
  const running = stackServiceFacts(ctx, config.stack).filter((facts) => (facts.name === service || facts.volumes.includes(pair.from) || facts.volumes.includes(pair.to)) && isRunning(facts)).map((facts) => facts.name);
  if (running.length > 0) throw refusal('STACK_ADOPT_SOURCE_RUNNING', `${running.join(', ')} still run(s) on the database volumes: put the stack in standby first (stack standby --env ${config.env} --execute); nothing was changed`);
  let documents: Record<string, unknown>[];
  try { documents = await createReleaseStore(config, run, { gated: gateIsOn(ctx.env) }).journals(); } catch (error) {
    throw refusal('STACK_ADOPT_SOURCE_UNREADABLE', `the journal of ${config.stack} cannot be read (${messageOf(error)}); nothing was changed`);
  }
  const last = [...documents].reverse().find((document) => document.kind === 'db-upgrade');
  const upgrade = (last?.upgrade ?? {}) as { to?: unknown; from?: unknown; image?: unknown };
  if (!last || last.outcome !== 'done' || upgrade.to !== pair.to || upgrade.from !== pair.from) {
    throw refusal('STACK_ADOPT_UPGRADE_UNPROVEN', `the journal of ${config.stack} holds no finished db-upgrade of ${pair.from} into ${pair.to}${last ? ` (the newest one, ${String(last.attempt)}, is ${String(last.outcome)})` : ''}: run stack db-upgrade --env ${config.env} --image <db image> --execute; nothing was changed`);
  }
  const deployed = images[database.service];
  if (deployed !== undefined && deployed !== upgrade.image) throw refusal('STACK_ADOPT_UPGRADE_IMAGE', `the restore into ${pair.to} was proven with ${String(upgrade.image)}, and this deploy runs ${database.service} with ${deployed}: deploy the image the upgrade proved, or upgrade again with this one; nothing was changed`);
  if (config.backup?.image && volumeEmpty(ctx, config.backup.image, pair.to)) throw refusal('STACK_ADOPT_VOLUME_EMPTY', `the upgraded volume ${pair.to} is empty; nothing was changed`);
  return { kind: 'upgrade', stack: config.stack, releasesBase: config.remote.releasesBase ?? `/srv/${config.stack}`, release: previous, standby: '', upgrade: String(last.attempt), volumes: { [pair.to]: pair.from } };
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
  return { stack: value.stack, releasesBase: value.releasesBase, release: value.release, standby: String(value.standby ?? ''), volumes: (value.volumes ?? {}) as Record<string, string>, ...(value.kind === 'upgrade' ? { kind: 'upgrade' as const, upgrade: String(value.upgrade ?? '') } : {}) };
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
    return { result: { ok: false, code: 'STACK_ADOPT_NO_HISTORY', lines: [`adopt refused: the database of ${service} carries no migration history (${state.publicTables < 0 ? 'an unreadable count of' : state.publicTables} table(s) in public): it is not the copied or upgraded data of the old database; fill the new volume (stack volume copy, or stack db-upgrade) before --adopt`] }, phase: null };
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

/**
 * A plain deploy (no --adopt) of an environment that declares `deploy.dbUpgrade` while its database service still mounts the old volume is refused: it
 * would start the new major on the new volume as an empty database and serve it. The upgrade is `stack db-upgrade`, then `stack deploy --adopt`.
 */
export async function refusePendingUpgrade(ctx: StackContext, config: DeployConfig): Promise<void> {
  const database = await declaredDatabase(ctx, config);
  if (!config.dbUpgrade || !database || database.target !== 'stack') return;
  const [next, old] = Object.entries(config.dbUpgrade.volumes)[0] as [string, string];
  const facts = stackServiceFacts(ctx, config.stack);
  // Until the adopted deploy, a service of the stack still mounts the old volume (a database service renamed with the upgrade is pruned by that deploy).
  const holder = facts.find((service) => service.volumes.includes(old)) ?? facts.find((service) => service.name === `${config.stack}_${database.service}` && !service.volumes.includes(next));
  if (!holder) return;
  throw refusal('STACK_DEPLOY_DB_UPGRADE_PENDING', `${holder.name} still mounts ${holder.volumes.join(', ') || old}, and the release mounts the upgraded volume ${next} (deploy.dbUpgrade): a plain deploy would start an empty database there; run stack db-upgrade --env ${config.env} --execute, then stack deploy --env ${config.env} --adopt; nothing was changed`);
}

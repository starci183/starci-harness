// journal.mjs - the record of every deploy attempt on the manager, and the lock that serialises attempts.
// A deploy (CI, dispatch or the owner's urgent one), a rollback and an accept each run as one ATTEMPT:
//   1. the journal is opened: /srv/<stack>/deploys/<attempt>.json (the document, rewritten at every phase boundary, so a cancelled job still leaves its
//      last phase) and one line in the append-only /srv/<stack>/deploys.jsonl; a journal that cannot be written refuses the attempt before anything changed;
//   2. the deploy lock /srv/<stack>/deploy.lock is taken (a phase of the journal, `lock`): the wait is bounded and a held lock is a refusal
//      `STACK_DEPLOY_LOCKED` with nothing changed; the lock is refreshed at every phase start and released last;
//   3. the body runs, every phase through `phase()`: start, end and verdict are written, a thrown step is recorded failed and rethrown;
//   4. the outcome (accepted, pending, rolled-back, rollback-failed, failed, refused, already-current) closes the document.
// The document holds names, digests, times and verdicts, never a secret value. After the first write a failing journal never fails the deploy: the failure is
// a line of the result (`warnings`).
import { randomBytes } from 'node:crypto';
import type { DeployConfig } from './config.mjs';
import { firstLine } from './context.mjs';
import type { StackContext } from './context.mjs';
import { StackError, refusal } from './errors.mjs';
import type { LockTrigger, ReleaseStore } from './release-store.mjs';
import type { ActionResult } from './remote.mjs';
import type { ObservedService } from './status.mjs';

/** What started the attempt: a CI run, a manual dispatch or the owner's urgent deploy. */
export type Trigger = LockTrigger;
/** What the attempt does. */
export type AttemptKind = 'deploy' | 'rollback' | 'accept';
/** How an attempt ended; `running` is the document of an attempt that has not finished (or was cancelled). */
export type Outcome = 'running' | 'accepted' | 'pending' | 'rolled-back' | 'rollback-failed' | 'failed' | 'refused' | 'already-current';

/** One phase of an attempt. */
export interface PhaseRecord { phase: string; startedAt: string; endedAt: string | null; verdict: 'running' | 'ok' | 'failed' }

/** The document of one attempt, as /srv/<stack>/deploys/<attempt>.json holds it. */
export interface AttemptDocument {
  schema: 'starci/stack-deploy-attempt@1';
  attempt: string;
  kind: AttemptKind;
  stack: string;
  env: string;
  startedAt: string;
  endedAt: string | null;
  trigger: Trigger;
  sourceSha: string | null;
  /** The release tag when the attempt ran from a tag (GITHUB_REF_NAME of a tag run). */
  tag: string | null;
  /** The CI run: its id and, when the runner environment names the repository, its URL. */
  ci: { run: string; url: string | null } | null;
  /** The owner's urgent record: who and why (the reason is the owner's own text, bounded). */
  urgent: { role: string; reason: string; tag: string | null } | null;
  releaseId: string | null;
  previous: string | null;
  phases: PhaseRecord[];
  /** Reserved for the backup phase: its receipt (names and digests only). Null when no backup ran. */
  backup: Record<string, unknown> | null;
  /** Reserved for the migrate and contract phases: the names of the migrations that were applied. */
  migrations: string[];
  /** `docker service inspect` snapshots by moment: `converge`, `rollback`, `accept`. */
  observed: Record<string, ObservedService[]>;
  outcome: Outcome;
  error: { code: string; message: string } | null;
}

/** What an attempt is told about itself when it opens. */
export interface AttemptMeta {
  kind: AttemptKind;
  trigger: Trigger;
  sourceSha?: string | undefined;
  /** The id of the CI run (digits); with it the trigger is `ci`. */
  ciRun?: string | undefined;
  urgent?: { role: string; reason: string; tag?: string | undefined } | undefined;
}

/** The facts an attempt learns while it runs. */
export interface Note { releaseId?: string | null; previous?: string | null; backup?: Record<string, unknown> | null; migrations?: string[]; urgent?: { role: string; reason: string; tag?: string | undefined } }

/** The open record of one attempt. */
export interface Recorder {
  readonly id: string;
  /** Journal failures after the first write; the caller prints them. */
  readonly warnings: string[];
  note(facts: Note): void;
  /** Registers what runs at the start of every later phase (the lock refresh). */
  beforePhase(next: () => Promise<void>): void;
  /** Runs `action` as the named phase: start and end are written; a throw is recorded as failed and rethrown. `passed` judges a returned value (default: ok). */
  phase<T>(name: string, action: () => T | Promise<T>, passed?: (value: T) => boolean): Promise<T>;
  snapshot(moment: string, services: ObservedService[]): void;
  finish(outcome: Outcome, error?: { code: string; message: string } | null): Promise<void>;
}

const REASON_MAX = 500;
const SAFE = /[^A-Za-z0-9._/:@ -]/gu;
const isoOf = (ctx: Pick<StackContext, 'now'>): string => new Date(ctx.now()).toISOString();
const compact = (iso: string): string => iso.replaceAll(/[-:]|\.\d+/gu, '');
const clean = (value: string, max: number): string => value.replaceAll(SAFE, '?').slice(0, max);

/** A new attempt id: the UTC time and 8 random hex characters. */
export const newAttemptId = (ctx: Pick<StackContext, 'now'>): string => `${compact(isoOf(ctx))}-${randomBytes(4).toString('hex')}`;

/** The CI facts of the runner environment: the tag of a tag run and the run's URL. Nothing else of the environment is read. */
function ciFacts(ctx: Pick<StackContext, 'env'>, run: string | undefined): { tag: string | null; ci: AttemptDocument['ci'] } {
  const { GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: ref, GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository } = ctx.env;
  const tag = refType === 'tag' && ref ? clean(ref, 100) : null;
  if (!run) return { tag, ci: null };
  const url = server && repository && /^https:\/\/[A-Za-z0-9.-]+$/u.test(server) && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(repository) ? `${server}/${repository}/actions/runs/${run}` : null;
  return { tag, ci: { run, url } };
}

/**
 * Opens the journal of an attempt and returns its recorder. Writes the first document and the index line; a failure of either is the refusal
 * `STACK_DEPLOY_JOURNAL` (the manager cannot keep a record, so nothing is changed).
 */
export async function openAttempt(ctx: StackContext, config: DeployConfig, store: ReleaseStore, meta: AttemptMeta): Promise<Recorder> {
  const id = newAttemptId(ctx);
  const journal = store.journal(id);
  const facts = ciFacts(ctx, meta.ciRun);
  const document: AttemptDocument = {
    schema: 'starci/stack-deploy-attempt@1', attempt: id, kind: meta.kind, stack: config.stack, env: config.env, startedAt: isoOf(ctx), endedAt: null,
    trigger: meta.trigger, sourceSha: meta.sourceSha ?? null, tag: facts.tag, ci: facts.ci,
    urgent: meta.urgent ? { role: clean(meta.urgent.role, 40), reason: meta.urgent.reason.slice(0, REASON_MAX), tag: meta.urgent.tag ?? null } : null,
    releaseId: null, previous: null, phases: [], backup: null, migrations: [], observed: {}, outcome: 'running', error: null,
  };
  const warnings: string[] = [];
  let beat: () => Promise<void> = async () => {};
  const save = async (): Promise<void> => {
    try { await journal.write(document); } catch (error) { warnings.push(`journal: could not write ${id}: ${firstLine((error as Error).message)}`); }
  };
  try {
    await journal.write(document);
    await journal.index({ attempt: id, at: document.startedAt, event: 'start', kind: meta.kind, trigger: meta.trigger, sourceSha: document.sourceSha });
  } catch (error) {
    throw refusal('STACK_DEPLOY_JOURNAL', `the manager cannot keep the deploy journal (${firstLine((error as Error).message)}); nothing was changed`);
  }
  const recorder: Recorder = {
    id, warnings,
    beforePhase: (next) => { beat = next; },
    note(found) {
      if (found.releaseId !== undefined) document.releaseId = found.releaseId;
      if (found.previous !== undefined) document.previous = found.previous;
      if (found.backup !== undefined) document.backup = found.backup;
      if (found.migrations !== undefined) document.migrations = found.migrations;
      if (found.urgent) document.urgent = { role: clean(found.urgent.role, 40), reason: found.urgent.reason.slice(0, REASON_MAX), tag: found.urgent.tag ?? null };
    },
    async phase<T>(name: string, action: () => T | Promise<T>, passed: (value: T) => boolean = () => true): Promise<T> {
      const entry: PhaseRecord = { phase: name, startedAt: isoOf(ctx), endedAt: null, verdict: 'running' };
      document.phases.push(entry);
      await beat();
      await save();
      try {
        const value = await action();
        entry.verdict = passed(value) ? 'ok' : 'failed';
        return value;
      } catch (error) {
        entry.verdict = 'failed';
        throw error;
      } finally {
        entry.endedAt = isoOf(ctx);
        await save();
      }
    },
    snapshot(moment, services) { document.observed[moment] = services; },
    async finish(outcome, error = null) {
      document.outcome = outcome;
      document.endedAt = isoOf(ctx);
      document.error = error;
      await save();
      try { await journal.index({ attempt: id, at: document.endedAt, event: 'end', outcome, releaseId: document.releaseId }); } catch (indexError) { warnings.push(`journal: could not index ${id}: ${firstLine((indexError as Error).message)}`); }
    },
  };
  return recorder;
}

/** What the lock wait takes. */
export interface LockWait { waitSeconds?: number | undefined; pollSeconds?: number | undefined }

/** The default wait for a held deploy lock (the design's ten minutes). */
export const LOCK_WAIT_SECONDS = 600;
const LOCK_POLL_SECONDS = 10;

/** A taken lock: refresh keeps it alive, release gives it back. */
export interface LockHold { token: string; refresh(): Promise<boolean>; release(): Promise<boolean> }

/** Takes the deploy lock, waiting while another deploy holds it; `STACK_DEPLOY_LOCKED` when the wait ends. */
export async function holdLock(ctx: StackContext, store: ReleaseStore, trigger: Trigger, wait: LockWait = {}): Promise<LockHold> {
  const token = randomBytes(16).toString('hex');
  const deadline = ctx.now() + (wait.waitSeconds ?? LOCK_WAIT_SECONDS) * 1000;
  for (;;) {
    const attempt = await store.tryLock(token, trigger);
    if (attempt.acquired) return { token, refresh: () => store.refreshLock(token), release: () => store.unlock(token) };
    if (ctx.now() >= deadline) throw refusal('STACK_DEPLOY_LOCKED', `another deploy (${attempt.holder}) has held the deploy lock for ${attempt.ageSeconds}s without finishing; nothing was changed. If its job is gone, remove the deploy.lock directory under the releases base on the manager`);
    await ctx.sleep((wait.pollSeconds ?? LOCK_POLL_SECONDS) * 1000);
  }
}

/** The data every result of the steps carries that decides the outcome. */
interface OutcomeData { steps?: { step: string }[]; rolledBack?: boolean; pendingAccept?: boolean; alreadyCurrent?: boolean }

/** How a finished result reads as an outcome. */
export function outcomeOf(result: ActionResult, kind: AttemptKind): Outcome {
  const data = (result.data ?? {}) as OutcomeData;
  if (data.alreadyCurrent) return 'already-current';
  if (result.ok) return data.pendingAccept ? 'pending' : 'accepted';
  if (kind !== 'deploy') return 'failed';
  const changed = (data.steps ?? []).some((entry) => entry.step === 'deploy' || entry.step === 'deploy-hold');
  if (!changed) return 'refused';
  return data.rolledBack ? 'rolled-back' : 'rollback-failed';
}

/** A thrown value as the { code, message } of a journal document. */
function errorOf(error: unknown): { code: string; message: string } {
  if (error instanceof StackError) return { code: error.code, message: firstLine(error.message).slice(0, 300) };
  return { code: 'UNEXPECTED', message: firstLine((error as Error | undefined)?.message).slice(0, 300) };
}

/**
 * Runs `body` as one recorded attempt under the deploy lock: journal opened, lock taken, `body(recorder)` run, outcome written, lock released. The result
 * gains `data.attempt` (the attempt id) and the journal's warnings as lines; a throw is recorded as `refused` and rethrown.
 */
export async function recordedAttempt(ctx: StackContext, config: DeployConfig, store: ReleaseStore, meta: AttemptMeta, wait: LockWait, body: (recorder: Recorder) => Promise<ActionResult>): Promise<ActionResult> {
  const recorder = await openAttempt(ctx, config, store, meta);
  let hold: LockHold | null = null;
  try {
    hold = await recorder.phase('lock', () => holdLock(ctx, store, meta.trigger, wait));
    const owned = hold;
    recorder.beforePhase(async () => {
      try { if (!await owned.refresh()) recorder.warnings.push('journal: the deploy lock is no longer ours (taken over as stale)'); } catch { recorder.warnings.push('journal: could not refresh the deploy lock'); }
    });
    const result = await body(recorder);
    await recorder.finish(outcomeOf(result, meta.kind), result.refused ? { code: result.refused.code, message: result.refused.message.slice(0, 300) } : null);
    return { ...result, lines: [...result.lines, ...recorder.warnings], data: { ...result.data, attempt: recorder.id } };
  } catch (error) {
    await recorder.finish('refused', errorOf(error));
    throw error;
  } finally {
    if (hold) {
      try { await hold.release(); } catch { /* the lock is taken over as stale after its TTL; the deploy's own verdict stands */ }
    }
  }
}

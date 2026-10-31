// release-store.mjs - the release record protocol on the manager: /srv/<stack>/releases/<digest16>/{stack.yaml,release.json} behind the
// stable `current` and `previous` pointers, which move only after verification. A JavaScript object over an injected ssh runner:
//   ssh(command, { input }) -> { status, stdout, stderr }     runs a shell command on the manager (remote.mjs provides the real one)
// Every remote command is composed ONLY from a validated release id (16 lowercase hex) and a validated base path, so no free text reaches
// the remote shell. The record holds names and digests, never a secret value. Files travel as text on stdin / stdout.
import fs from 'node:fs';
import path from 'node:path';
import { firstLine, lines as splitLines } from './context.mjs';
import { isReleaseId } from './digest.mjs';
import { failure, refusal } from './errors.mjs';
import { gatedCommand, inlineCommand } from './ssh-gate.mjs';
import type { RemoteResult } from './remote.mjs';
import type { DeployConfig } from './config.mjs';

/** The ssh runner a store runs its commands through. */
export type StoreSsh = (command: string, options: { input?: string | undefined }) => RemoteResult | Promise<RemoteResult>;
/** One stored release and whether it is the current or the previous one. */
export interface ReleaseEntry { id: string; current: boolean; previous: boolean }
/** What a deploy lock is taken for: the trigger of the attempt (a closed set, so no free text reaches the remote shell). */
export type LockTrigger = 'ci' | 'dispatch' | 'urgent';
/** The answer of one try at the deploy lock: taken, or who holds it (a trigger word) and for how long it has gone unrefreshed. */
export type LockAttempt = { acquired: true } | { acquired: false; holder: string; ageSeconds: number };
/** The journal files of one attempt: its document (rewritten at every phase boundary) and the append-only index line. */
export interface AttemptJournal {
  write(document: object): Promise<void>;
  index(entry: object): Promise<void>;
}
/** A stored release read into memory: the stack bytes and the parsed release record. */
export interface StoredRelease { stackYaml: string; release: Record<string, unknown> }
/** The release record protocol on the manager (see createReleaseStore). */
export interface ReleaseStore {
  store(dir: string, id: string): Promise<void>;
  accept(id: string): Promise<void>;
  current(): Promise<string>;
  previous(): Promise<string>;
  fetch(id: string, targetDir: string): Promise<string>;
  list(): Promise<ReleaseEntry[]>;
  /** A stored release read into memory (both files); throws when it is not stored. */
  read(id: string): Promise<StoredRelease>;
  /** One try at /srv/<stack>/deploy.lock for the holder `token` (32 hex): a stale lock (unrefreshed for LOCK_TTL_SECONDS) is taken over. */
  tryLock(token: string, trigger: LockTrigger): Promise<LockAttempt>;
  /** Marks the lock as alive; false when the holder no longer owns it. */
  refreshLock(token: string): Promise<boolean>;
  /** Releases the lock when `token` still owns it; false when it did not. */
  unlock(token: string): Promise<boolean>;
  /** The journal of one attempt under /srv/<stack>/deploys. */
  journal(attempt: string): AttemptJournal;
  /** The newest attempt documents (at most 500), oldest first; a document that is not a JSON object is left out. */
  journals(): Promise<Record<string, unknown>[]>;
}

/** A lock nobody refreshed for this long (its holder died without releasing it) is taken over by the next try. Phases refresh it. */
export const LOCK_TTL_SECONDS = 3600;
const TOKEN = /^[0-9a-f]{32}$/u;
const TRIGGERS: readonly string[] = ['ci', 'dispatch', 'urgent'];
/** An attempt id: UTC compact time and 8 random hex. */
export const ATTEMPT_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/u;

const checkedToken = (token: unknown): string => {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw refusal('STACK_LOCK_TOKEN', 'a lock token is exactly 32 lowercase hex characters');
  return token;
};
const checkedTrigger = (trigger: unknown): LockTrigger => {
  if (typeof trigger !== 'string' || !TRIGGERS.includes(trigger)) throw refusal('STACK_LOCK_TRIGGER', 'a deploy trigger is ci, dispatch or urgent');
  return trigger as LockTrigger; // TRIGGERS holds exactly the LockTrigger members
};
const checkedAttempt = (attempt: unknown): string => {
  if (typeof attempt !== 'string' || !ATTEMPT_ID.test(attempt)) throw refusal('STACK_ATTEMPT_ID', 'an attempt id is a UTC compact time and 8 lowercase hex characters');
  return attempt;
};

/**
 * The remote command of one try at the deploy lock (ssh-gate.mts holds the body): `mkdir` is the atomic claim, the owner file (token, trigger, epoch) is
 * replaced by rename, a lock unrefreshed for `ttl` seconds is moved aside (one rename wins) and claimed anew. Prints `acquired` or `busy <trigger> <age>`.
 * Composed only from a validated base, token and trigger.
 */
export const lockAcquireScript = (base: string, token: string, trigger: string, ttl: number = LOCK_TTL_SECONDS): string => inlineCommand('lock-acquire', [base, checkedToken(token), checkedTrigger(trigger), String(Math.trunc(ttl))]);

/** The remote command that marks the lock alive when `token` owns it: prints `held` or `lost`. */
export const lockRefreshScript = (base: string, token: string): string => inlineCommand('lock-refresh', [base, checkedToken(token)]);

/** The remote command that removes the lock when `token` owns it: prints `released` or `lost`. */
export const lockReleaseScript = (base: string, token: string): string => inlineCommand('lock-release', [base, checkedToken(token)]);

const BASE = /^\/[A-Za-z0-9._/-]+$/u;
const FILES = ['stack.yaml', 'release.json'];

/** Removes every carriage return: a snippet from a Windows checkout must never reach a remote shell with CRLF. */
export const lfOnly = (text: unknown): string => String(text).replaceAll('\r', '');

const checkedId = (id: unknown): string => {
  if (!isReleaseId(id)) throw refusal('STACK_RELEASE_ID', 'a release id is exactly 16 lowercase hex characters');
  return id;
};

const checkedBase = (config: Pick<DeployConfig, 'remote' | 'stack'>): string => {
  const base = config.remote?.releasesBase ?? `/srv/${config.stack}`;
  if (!BASE.test(base) || base.includes('..')) throw refusal('STACK_RELEASE_BASE', `the releases base ${base} must be an absolute path without ..`);
  return base;
};

/**
 * The release store of one stack. `ssh` is the runner; the returned API is async:
 *   store(dir, id) accept(id) current() previous() fetch(id, targetDir) list()
 */
export function createReleaseStore(config: Pick<DeployConfig, 'remote' | 'stack'>, ssh: StoreSsh, options: { gated?: boolean | undefined } = {}): ReleaseStore {
  const base = checkedBase(config);

  /** Runs the named operation: through the forced-command gate (`starci-op <name> <args>`) when the key has one, else as the same body under `sh -c`. */
  async function run(name: string, args: readonly string[], input?: string): Promise<string> {
    const command = options.gated === true ? gatedCommand(name, args) : inlineCommand(name, args);
    const answer = await ssh(lfOnly(command), { input });
    if (answer.status !== 0) throw failure('STACK_RELEASE_SSH', `remote command failed: ${firstLine(answer.stderr)}`);
    return answer.stdout;
  }

  function readLocal(dir: string, name: string): string {
    try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { throw failure('STACK_RELEASE_STORE', `cannot read ${name} in ${dir}`); }
  }

  async function pointer(name: string): Promise<string> {
    const out = await run('pointer', [base, name]);
    const id = out.trim();
    return isReleaseId(id) ? id : '';
  }

  /** Both files of a stored release as [name, text] pairs, framed as base64 lines. */
  async function readFiles(id: string): Promise<[string, string][]> {
    const out = await run('read', [base, checkedId(id)]);
    const frames = out.split('\n');
    if (frames.length !== 3 || frames[2] !== '' || frames.slice(0, 2).some((frame) => !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(frame))) throw failure('STACK_RELEASE_SSH', 'invalid release response framing');
    return FILES.map((name, index): [string, string] => [name, Buffer.from(frames[index] as string, 'base64').toString('utf8')]);
  }

  return {
    /** Uploads stack.yaml and release.json of a rendered release as text; read-only afterwards. */
    async store(dir: string, id: string): Promise<void> {
      checkedId(id);
      const contents = FILES.map((name): [string, string] => [name, readLocal(dir, name)]);
      const input = contents.map(([, text]) => Buffer.from(text, 'utf8').toString('base64')).join('\n') + '\n';
      await run('store', [base, checkedId(id)], input);
    },
    /** The release was verified: previous := current, current := id. */
    async accept(id: string): Promise<void> {
      checkedId(id);
      await run('accept', [base, id]);
    },
    /** The accepted release id, '' when none. */
    current: () => pointer('current'),
    /** The release accepted before the current one, '' when none. */
    previous: () => pointer('previous'),
    /** Downloads a stored release (both files) into `targetDir` for a rollback or an audit. */
    async fetch(id: string, targetDir: string): Promise<string> {
      const files = await readFiles(id);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const [name, text] of files) fs.writeFileSync(path.join(targetDir, name), text);
      return targetDir;
    },
    /** A stored release in memory: the stack bytes and the parsed release record. */
    async read(id: string): Promise<StoredRelease> {
      const [stack, release] = await readFiles(id);
      let record: unknown;
      try { record = JSON.parse((release as [string, string])[1]); } catch { throw failure('STACK_RELEASE_STORE', `release ${id} has a release.json that is not JSON`); }
      return { stackYaml: (stack as [string, string])[1], release: record !== null && typeof record === 'object' && !Array.isArray(record) ? record as Record<string, unknown> : {} };
    },
    async tryLock(token: string, trigger: LockTrigger): Promise<LockAttempt> {
      const answer = (await run('lock-acquire', [base, checkedToken(token), checkedTrigger(trigger), String(LOCK_TTL_SECONDS)])).trim();
      if (answer === 'acquired') return { acquired: true };
      const busy = /^busy ([a-z]+) (-?[0-9]+)$/u.exec(answer);
      if (!busy) throw failure('STACK_RELEASE_SSH', 'the deploy lock script answered something else than acquired or busy');
      return { acquired: false, holder: busy[1] as string, ageSeconds: Number(busy[2]) };
    },
    async refreshLock(token: string): Promise<boolean> { return (await run('lock-refresh', [base, checkedToken(token)])).trim() === 'held'; },
    async unlock(token: string): Promise<boolean> { return (await run('lock-release', [base, checkedToken(token)])).trim() === 'released'; },
    journal(attempt: string): AttemptJournal {
      const id = checkedAttempt(attempt);
      const encoded = (value: object): string => `${Buffer.from(JSON.stringify(value), 'utf8').toString('base64')}
`;
      return {
        async write(document: object): Promise<void> {
          await run('journal-write', [base, id], encoded(document));
        },
        async index(entry: object): Promise<void> {
          await run('journal-index', [base], encoded(entry));
        },
      };
    },
    /** The attempt documents the journal keeps, oldest first. */
    async journals(): Promise<Record<string, unknown>[]> {
      const documents: Record<string, unknown>[] = [];
      for (const frame of (await run('journal-read', [base])).split('\n')) {
        if (frame === '') continue;
        try {
          const parsed: unknown = JSON.parse(Buffer.from(frame, 'base64').toString('utf8'));
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) documents.push(parsed as Record<string, unknown>);
        } catch { /* a document that cannot be read is no evidence either way */ }
      }
      return documents;
    },
    /** The stored releases, newest first: [{ id, current, previous }]. */
    async list(): Promise<ReleaseEntry[]> {
      const response = await run('list', [base]);
      const [current, previous, ...entries] = response.split('\n');
      const now = isReleaseId(current) ? current : '';
      const before = isReleaseId(previous) ? previous : '';
      const out = entries.join('\n');
      return splitLines(out).filter(isReleaseId).map((id) => ({ id, current: id === now, previous: id === before }));
    },
  };
}

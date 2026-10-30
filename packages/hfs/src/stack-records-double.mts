// A double of the deploy records of the release store (lock, journal and in-memory reads) for the specs that run deployRelease over a stubbed store.
// It keeps what the real store writes on the manager: the journal documents by attempt, the index lines and who holds the lock.
import type { AttemptJournal, LockAttempt, ReleaseStore, StoredRelease } from '../stack/release-store.mjs';

/** The records half of a ReleaseStore, plus what it kept. */
export interface RecordsDouble extends Pick<ReleaseStore, 'read' | 'tryLock' | 'refreshLock' | 'unlock' | 'journal'> {
  /** The latest document of each attempt, as the journal wrote it (a copy at each write). */
  documents: Map<string, Record<string, unknown>>;
  /** Every write of every document, in order: the phase boundaries a cancelled job would have left. */
  writes: Record<string, unknown>[];
  /** The append-only index. */
  index: Record<string, unknown>[];
  /** The holder token and trigger of the lock, null when it is free. */
  lock: { token: string; trigger: string } | null;
  /** Lock calls in order: `try:<trigger>`, `refresh`, `unlock`. */
  calls: string[];
}

/** What a double can be told: the release `read` answers, a lock held by someone else, and journal writes that fail. */
export interface RecordsOptions {
  read?: (id: string) => StoredRelease | Promise<StoredRelease>;
  /** The lock is held by another deploy for this many seconds: `tryLock` answers busy until `freeAfterTries` tries have passed. */
  busy?: { holder: string; ageSeconds: number; freeAfterTries?: number } | undefined;
  failJournal?: boolean | undefined;
  /** The journal accepts this many document writes and fails every later one (a manager that drops mid-deploy). */
  failJournalAfter?: number | undefined;
}

export function recordsDouble(options: RecordsOptions = {}): RecordsDouble {
  const documents = new Map<string, Record<string, unknown>>();
  const writes: Record<string, unknown>[] = [];
  const index: Record<string, unknown>[] = [];
  const calls: string[] = [];
  let tries = 0;
  let documentWrites = 0;
  const double: RecordsDouble = {
    documents, writes, index, calls, lock: null,
    read: async (id) => (options.read ? options.read(id) : { stackYaml: 'services: {}\n', release: {} }),
    tryLock: async (token, trigger): Promise<LockAttempt> => {
      calls.push(`try:${trigger}`);
      tries += 1;
      const busy = options.busy;
      if (busy && tries <= (busy.freeAfterTries ?? Number.POSITIVE_INFINITY)) return { acquired: false, holder: busy.holder, ageSeconds: busy.ageSeconds };
      double.lock = { token, trigger };
      return { acquired: true };
    },
    refreshLock: async (token) => { calls.push('refresh'); return double.lock?.token === token; },
    unlock: async (token) => { calls.push('unlock'); if (double.lock?.token !== token) return false; double.lock = null; return true; },
    journal: (attempt): AttemptJournal => ({
      write: async (document) => {
        documentWrites += 1;
        if (options.failJournal || (options.failJournalAfter !== undefined && documentWrites > options.failJournalAfter)) throw new Error('the manager is read-only');
        const copy = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
        documents.set(attempt, copy);
        writes.push(copy);
      },
      index: async (entry) => {
        if (options.failJournal) throw new Error('the manager is read-only');
        index.push(JSON.parse(JSON.stringify(entry)) as Record<string, unknown>);
      },
    }),
  };
  return double;
}

// fake-session.mts - the in-memory CheckSession specs (and the work packages that build on the cache) run families against: a
// tree given as text, trusted records given as a map, and a log of everything the family did. It touches no disk and no clock.
import { hashText } from './hash.mjs';
import type { CacheRecord, CheckSession, ContentIndex, FamilyDecision, FamilyId, FamilyReport, FlushResult, ProgressSink, RunMode, StepProgress } from './types.mjs';

/** One progress event the fake saw. */
export type ProgressEvent =
  | { readonly kind: 'start'; readonly family: FamilyId; readonly name: string; readonly total: number }
  | { readonly kind: 'tick'; readonly family: FamilyId; readonly name: string; readonly done: number; readonly reused: number; readonly checked: number }
  | { readonly kind: 'end'; readonly family: FamilyId; readonly name: string };

export interface FakeSessionOptions {
  /** The work tree: app-relative posix path to text. */
  readonly files?: Readonly<Record<string, string>>;
  /** The trusted records, by folder. */
  readonly records?: Readonly<Record<string, readonly CacheRecord[]>>;
  /** The run mode every family is told; `full` carries `fullReason`. */
  readonly mode?: RunMode;
  readonly fullReason?: string;
}

/** The fake, with the logs a spec asserts on. */
export interface FakeSession extends CheckSession {
  readonly events: ProgressEvent[];
  readonly reports: FamilyReport[];
  readonly replaced: Map<string, readonly CacheRecord[]>;
  /** Edits the fake tree between a run's read and its write (the "edit during the run" case). */
  setFile(path: string, text: string | undefined): void;
  flushed: number;
}

/** A content index over `files`, hashing as the real one does. */
export function createFakeIndex(files: Readonly<Record<string, string>>): ContentIndex & { set(path: string, text: string | undefined): void } {
  const hashes = new Map(Object.entries(files).map(([path, text]) => [path, hashText(text)]));
  return {
    get paths() {
      return [...hashes.keys()].sort();
    },
    hashOf: (path) => hashes.get(path),
    set(path, text) {
      if (text === undefined) hashes.delete(path);
      else hashes.set(path, hashText(text));
    },
  };
}

export function createFakeSession(options: FakeSessionOptions = {}): FakeSession {
  const index = createFakeIndex(options.files ?? {});
  const stored = new Map<string, readonly CacheRecord[]>(Object.entries(options.records ?? {}));
  const events: ProgressEvent[] = [];
  const reports: FamilyReport[] = [];
  const replaced = new Map<string, readonly CacheRecord[]>();
  const decision: FamilyDecision = { mode: options.mode ?? 'diff', reason: options.fullReason ?? (options.mode === 'full' ? 'full run' : 'diff against the cache') };
  const progress: ProgressSink = {
    step(family, name, total): StepProgress {
      events.push({ kind: 'start', family, name, total });
      return {
        tick: (done, reused, checked) => void events.push({ kind: 'tick', family, name, done, reused, checked }),
        end: () => void events.push({ kind: 'end', family, name }),
      };
    },
  };
  const session: FakeSession = {
    root: '/fake/app',
    index,
    events,
    reports,
    replaced,
    flushed: 0,
    decide: () => decision,
    records: (folder) => replaced.get(folder) ?? stored.get(folder) ?? [],
    replace: (folder, records) => void replaced.set(folder, records),
    report: (report) => void reports.push(report),
    progress,
    setFile: (path, text) => index.set(path, text),
    flush(): FlushResult {
      session.flushed += 1;
      return { written: [...replaced.keys()].sort(), removed: [], warnings: [] };
    },
  };
  return session;
}

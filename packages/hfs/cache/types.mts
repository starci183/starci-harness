// types.mts - the vocabulary of the committed app check cache (contexts/project/check-cache.md). Every family, step and spec of
// the cache speaks these types; nothing here reads the disk or the network.

/** The format of the records on disk; a cache of another version is replaced, never read. */
export const CACHE_FORMAT_VERSION = 1;
/** Where the committed cache lives, app-relative and posix. */
export const CACHE_DIR = '.starcistacks/cache';

/** The families a run selects (`app check --<family>`). */
export const FAMILIES = ['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar'] as const;
export type FamilyId = (typeof FAMILIES)[number];

/** Whether a family judged everything (`full`) or only what differs from the trusted cache (`diff`). */
export type RunMode = 'full' | 'diff';

/** Plain JSON, the only thing a record may carry: no undefined, no functions, no dates. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** One finding of a step. Messages carry app-relative posix paths only. */
export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
}

/**
 * One self-contained result: the `step` judged the `path` (or the input set a scoped step names) whose content was `hash`, and
 * found `findings` (none for a clean file). `data` is the step's own extra payload (resolved imports, coverage items).
 */
export interface CacheRecord {
  readonly path: string;
  readonly step: string;
  readonly hash: string;
  readonly findings: readonly Finding[];
  readonly data?: JsonValue;
}

/** One part of the fingerprint: a name and the sha256 of what it stands for. */
export interface FingerprintPart {
  readonly name: string;
  readonly sha256: string;
}

/** What one family reports on its own line: `<family>: <full|diff> (<reason>), checked n, reused n; findings ...`. */
export interface FamilyReport {
  readonly family: FamilyId;
  readonly mode: RunMode;
  readonly reason: string;
  readonly checked: number;
  readonly reused: number;
  /** Findings this run produced that its records did not already hold. */
  readonly newFindings: number;
  /** Findings this run produced that its records already held. */
  readonly knownFindings: number;
  /** Findings the records held that this run no longer produces. */
  readonly fixedFindings: number;
}

/** The tracked files of the app and their normalised content hashes. */
export interface ContentIndex {
  readonly paths: readonly string[];
  /** The hash of `path` now, or undefined when the work tree no longer holds it. */
  hashOf(path: string): string | undefined;
}

/** A running step's progress: `tick` as files complete. */
export interface StepProgress {
  tick(done: number, reused: number, checked: number): void;
  end(): void;
}

/** Where progress goes (stderr in the CLI). Never stdout, which keeps the diagnosis. */
export interface ProgressSink {
  step(family: FamilyId, name: string, total: number): StepProgress;
}

/** How a family decides to run: the global situation (no cache, `--full`, fingerprint, release) already folded in. */
export interface FamilyDecision {
  readonly mode: RunMode;
  readonly reason: string;
}

/** What the session wrote when it was flushed. */
export interface FlushResult {
  readonly written: readonly string[];
  readonly removed: readonly string[];
  /** A disk error is a warning, never an exit code. */
  readonly warnings: readonly string[];
}

/**
 * The cache as one run sees it. A family asks it for its decision and its trusted records, judges, and replaces its records;
 * the session writes them once at the end (`flush`), byte-stable.
 */
export interface CheckSession {
  readonly root: string;
  readonly index: ContentIndex;
  /** Whether the family may read the cache this run, and why not when it may not (no cache, `--full`, fingerprint, release). */
  decide(family: FamilyId): FamilyDecision;
  /** The trusted records of a folder (`lint/be`, `check/format`, `test-coverage`), unfiltered: the step compares hashes itself. */
  records(folder: string): readonly CacheRecord[];
  /** Replaces every record of a folder with `records`; written on `flush`. */
  replace(folder: string, records: readonly CacheRecord[]): void;
  report(report: FamilyReport): void;
  readonly progress: ProgressSink;
  flush(): FlushResult;
}

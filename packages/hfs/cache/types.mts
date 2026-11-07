// types.mts - the vocabulary of the committed app check cache (contexts/project/check-cache.md). Every family, step and spec of
// the cache speaks these types; nothing here reads the disk or the network.

/** The format of the records on disk; a cache of another version is replaced, never read. */
export const CACHE_FORMAT_VERSION = 1;
/** Where the committed cache lives, app-relative and posix. */
export const CACHE_DIR = '.starcistacks/cache';

/** The families a run selects (`app check --<family>`). */
export const FAMILIES = ['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar', 'build', 'audit'] as const;
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

/** The append end of one journal file of a run (journal.mts): created with its header on first use, then appended to line by line. */
export interface JournalSink {
  /** The file entries go to; a child process may append its own lines to it after `open`. */
  readonly file: string;
  /** Creates the file with its header when it does not exist yet. */
  open(): void;
  /** Appends whole lines (no newline in them), flushed to the file before it returns. */
  append(lines: readonly string[]): void;
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
  /** Replaces every record of a folder with `records`; written on `flush`. `depth` is how many folders of a path name its area file (default 2). */
  replace(folder: string, records: readonly CacheRecord[], options?: { readonly depth?: number }): void;
  /**
   * True when none of `paths` changed in the work tree since the run began: a scoped step stores nothing keyed on a file edited during the run.
   * A path the content index does not hold (an untracked program input, generated code) is compared with `captured`, the hash the step's key took
   * of it (`absent` for a missing file); without a captured hash it is compared with the index, so an untracked path is never unchanged.
   */
  unchanged(paths: readonly string[], captured?: Readonly<Record<string, string>>): boolean;
  report(report: FamilyReport): void;
  readonly progress: ProgressSink;
  /**
   * The journal a family appends what it judges to while it runs (journal.mts): `rec` takes record lines, which `records(folder)` serves next run like committed
   * ones, `raw` the family's own lines for its `journaled(folder, context)`. Undefined when this run writes no cache (CI, a bypass, a local package): nothing is
   * journaled then and nothing is read back.
   */
  journal?(folder: string, kind: 'rec' | 'raw', context?: string): JournalSink | undefined;
  /** The `raw` lines of earlier runs of `folder` journaled under `context` and this run's fingerprint, torn lines dropped; none when journals are off. */
  journaled?(folder: string, context: string): readonly unknown[];
  flush(): FlushResult;
}

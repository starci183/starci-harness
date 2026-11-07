// session.mts - the disk-backed CheckSession of `starci app check`. It decides per family whether a run is full or diff
// (the rules of contexts/project/check-cache.md "When a run is full"), serves the trusted records of a folder, takes the records a family
// replaces and writes them once on flush: one JSON Lines file per area, byte-stable, only the files whose bytes changed, each by a temp file and a rename.
// A host run also journals (journal.mts): a family appends what it judges while it runs, `replace` journals the family's whole record set the moment the
// family finishes, and the next run serves those entries like records when their fingerprint and content key still match, so a killed run loses only
// what was not judged yet; flush compacts a folder's journal into the committed files and removes it. In CI it writes nothing and compares the
// committed cache with what it inherited or computed instead.
import fs from 'node:fs';
import path from 'node:path';
import { createContentIndex } from './content-index.mjs';
import { computeFingerprint, differencesByFamily, familiesOfPart, familyOfFolder, fingerprintDifferences, parseFingerprint, serializeFingerprint, type Fingerprint } from './fingerprint.mjs';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { createSink, hasJournal, journaledRaw, journaledRecords, journalFolder, journalFolders, pruneJournal, removeJournal, writeAtomic, writeLinesAtomic } from './journal.mjs';
import { groupByArea, parseRecords, recordLine, serializeRecords, sortRecords } from './jsonl.mjs';
import { toolCacheDir } from './run-log.mjs';
import { SECRETS_FOLDER, safeSecretRecords } from './secret-records.mjs';
import { readCacheDir, resolveTrust, verifyCommitted, type CacheVerdict, type TrustSource } from './trust.mjs';
import { CACHE_DIR, type CacheRecord, type CheckSession, type ContentIndex, type FamilyDecision, type FamilyId, type FamilyReport, type FlushResult, type JournalSink, type ProgressSink } from './types.mjs';

const FINGERPRINT_FILE = 'fingerprint.jsonl';
/** The folders whose records are held as their lines and parsed only when read (jsonl.mts lazyRecord): the per-spec coverage of the test family. */
const LAZY_FOLDERS: ReadonlySet<string> = new Set(['test-coverage']);

export interface DiskSessionOptions {
  readonly root: string;
  readonly tracked: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly progress: ProgressSink;
  /** The families `--fresh` recomputes from scratch, ignoring their records (they are written back). */
  readonly full?: ReadonlySet<FamilyId> | undefined;
  /** A run that neither reads nor writes the cache (a coverage report judged on its own). */
  readonly bypass?: boolean | undefined;
  /** The folder of the journals (default: `journal/` of the app's untracked tool cache); false turns journaling off. */
  readonly journalRoot?: string | false | undefined;
  /** Seams for specs. */
  readonly trust?: TrustSource | undefined;
  readonly fingerprint?: Fingerprint | undefined;
  readonly hfsDir?: string | undefined;
}

/** What the disk session adds to the contract: the fingerprint and trust it works under, and the CI verdicts. */
export interface DiskSession extends CheckSession {
  readonly fingerprint: Fingerprint;
  readonly trust: TrustSource;
  readonly reports: readonly FamilyReport[];
  /** Whether this run may write the cache folder (a host run with a portable fingerprint that is not a bypass run). */
  readonly writes: boolean;
  /** In CI after `flush`: the committed cache compared with what the run inherited or computed. */
  verdicts(): readonly CacheVerdict[];
}

const dirOf = (root: string, folder: string): string => path.join(root, ...CACHE_DIR.split('/'), ...folder.split('/'));

function removeEmptyDirs(dir: string, stop: string): void {
  for (let at = dir; at.startsWith(stop) && at !== stop; at = path.dirname(at)) {
    try { fs.rmdirSync(at); } catch { return; }
  }
}

function writeIfChanged(file: string, text: string, written: string[]): void {
  let current: string | undefined;
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = undefined; }
  if (current === text) return;
  writeAtomic(file, text);
  written.push(file);
}

/** The temp files an interrupted atomic write left beside the cache's own files. */
const TEMP_FILE = /.tmp-d+$/u;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(at, entry.name));
      else out.push(path.join(at, entry.name));
    }
  };
  walk(dir);
  return out;
}

export function createDiskSession(options: DiskSessionOptions): DiskSession {
  const { root, env, tracked } = options;
  const index: ContentIndex = createContentIndex(root, tracked);
  const fingerprint = options.fingerprint ?? computeFingerprint({ root, tracked, hfsDir: options.hfsDir });
  const trust = options.trust ?? resolveTrust({ root, env });
  const forcedFull = options.bypass === true;
  const reports: FamilyReport[] = [];
  const replaced = new Map<string, { records: readonly CacheRecord[]; depth: number }>();
  const parsed = new Map<string, readonly CacheRecord[]>();
  const trustedCache = (): ReadonlyMap<string, string> => trust.files();
  const trustedRecords = (folder: string): readonly CacheRecord[] => {
    const hit = parsed.get(folder);
    if (hit !== undefined) return hit;
    const prefix = `${folder}/`;
    // Duplicates (a union merge's) are told apart by the digest of their line, never by keeping every line: the lines of a large folder are hundreds of MB.
    const seen = new Set<string>();
    const lazy = LAZY_FOLDERS.has(folder);
    const records: CacheRecord[] = [];
    for (const [file, text] of [...trustedCache()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!file.startsWith(prefix) || !file.endsWith('.jsonl')) continue;
      for (const record of parseRecords(text, { lazy }).records) {
        const digest = hashText(recordLine(record));
        if (seen.has(digest)) continue;
        seen.add(digest);
        records.push(record);
      }
    }
    parsed.set(folder, records);
    return records;
  };
  const cachedFingerprint = parseFingerprint(trustedCache().get(FINGERPRINT_FILE) ?? '');
  const differences = cachedFingerprint.length === 0 ? [] : fingerprintDifferences(cachedFingerprint, fingerprint.parts);
  const invalidated = differencesByFamily(differences);
  /** Whether the records of a folder were computed under parts that differ now (every folder when there is no cached fingerprint). */
  const folderInvalid = (folder: string): boolean => {
    if (cachedFingerprint.length === 0) return true;
    const family = familyOfFolder(folder);
    return family === null ? differences.length > 0 : invalidated.has(family);
  };
  let verdictList: CacheVerdict[] = [];

  const global = (family: FamilyId): FamilyDecision | undefined => {
    if (forcedFull) return { mode: 'full', reason: 'a bypass run never reads the cache' };
    if (!fingerprint.portable) return { mode: 'full', reason: `no portable fingerprint, nothing is written (${fingerprint.localReasons[0] ?? 'a local package'})` };
    if (trust.kind === 'none') return { mode: 'full', reason: `no trusted base (${trust.reason})` };
    if (cachedFingerprint.length === 0) return { mode: 'full', reason: trust.kind === 'base' ? 'no cache at the trusted base' : 'no cache in the tree' };
    const parts = invalidated.get(family);
    if (parts !== undefined) return { mode: 'full', reason: `the ${family} parts of the fingerprint differ (${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ', ...' : ''})` };
    return undefined;
  };

  const writes = !forcedFull && fingerprint.portable && trust.kind === 'worktree';

  // ---- the journal (journal.mts): host runs only, since a run that writes no cache has nothing to keep and trusts nothing it did not compute
  const journalBase = options.journalRoot === false ? undefined : (options.journalRoot ?? path.join(toolCacheDir(root, env), 'journal'));
  const journalsOn = writes && journalBase !== undefined;
  const runId = `${Date.now().toString(36).padStart(9, '0')}-${String(process.pid)}`;
  const journalDir = (folder: string): string => journalFolder(journalBase ?? '', folder);
  /** The digest of the fingerprint parts `family` reads: a journal entry is read only under the digest it was written under. */
  const digests = new Map<FamilyId, string>();
  const digestOf = (family: FamilyId): string => {
    const known = digests.get(family);
    if (known !== undefined) return known;
    const digest = combineHashes(Object.fromEntries(fingerprint.parts.filter((part) => familiesOfPart(part.name).includes(family)).map((part) => [part.name, part.sha256])));
    digests.set(family, digest);
    return digest;
  };
  const journalWarnings: string[] = [];
  const sinks = new Map<string, JournalSink>();
  const isFresh = (family: FamilyId): boolean => options.full?.has(family) === true;
  /** Whether an earlier run left readable entries for some folder of `family` under this run's fingerprint. */
  const hasFamilyJournal = (family: FamilyId): boolean => journalsOn && journalFolders(journalBase ?? '').some((folder) => familyOfFolder(folder) === family && hasJournal(journalDir(folder), digestOf(family)));
  const plans = new Map<FamilyId, { readonly decision: FamilyDecision; readonly rescued: boolean }>();
  /**
   * The decision for a family, once per run. A family the fingerprint would run in full (no cache in the tree, a part it reads differs) runs against the
   * journal instead when an earlier run left entries written under today's parts: they are what a full run computes now, so they are served and the
   * committed records, computed under the old parts, are not (`rescued`).
   */
  const planOf = (family: FamilyId): { readonly decision: FamilyDecision; readonly rescued: boolean } => {
    const known = plans.get(family);
    if (known !== undefined) return known;
    let plan: { readonly decision: FamilyDecision; readonly rescued: boolean };
    if (isFresh(family)) plan = { decision: { mode: 'full', reason: '--fresh' }, rescued: false };
    else {
      const base = global(family);
      if (base === undefined) plan = { decision: { mode: 'diff', reason: `against ${trust.reason}` }, rescued: false };
      else if (hasFamilyJournal(family)) plan = { decision: { mode: 'diff', reason: `against the entries an interrupted run of this tree journaled (${base.reason})` }, rescued: true };
      else plan = { decision: base, rescued: false };
    }
    plans.set(family, plan);
    return plan;
  };
  const served = new Map<string, readonly CacheRecord[]>();
  /** The records of a folder a family reads: the trusted committed ones (none when the family is rescued and its committed records are from other parts) overlaid by the journaled ones, one per key. */
  const servedRecords = (folder: string): readonly CacheRecord[] => {
    const hit = served.get(folder);
    if (hit !== undefined) return hit;
    const family = familyOfFolder(folder);
    const committed = family !== null && planOf(family).rescued && folderInvalid(folder) ? [] : (folder === SECRETS_FOLDER ? safeSecretRecords(trustedRecords(folder)) : trustedRecords(folder));
    let out = committed;
    if (journalsOn && family !== null && !isFresh(family)) {
      const entries = journaledRecords(journalDir(folder), digestOf(family), LAZY_FOLDERS.has(folder));
      if (entries.length > 0) {
        const byKey = new Map(committed.map((record) => [`${record.path}\0${record.step}`, record] as const));
        for (const record of entries) byKey.set(`${record.path}\0${record.step}`, record);
        out = [...byKey.values()];
      }
    }
    served.set(folder, out);
    return out;
  };
  /** A file edited while the run read it gets no record: the records that still match the tree. */
  const settledRecords = (records: readonly CacheRecord[]): CacheRecord[] => records.filter((record) => index.hashOf(record.path) === undefined || hashFile(path.join(root, record.path)) === index.hashOf(record.path));
  /** Journals the whole record set of a folder the moment its family has judged it, atomically: a run killed afterwards still has it. */
  const checkpoint = (folder: string, records: readonly CacheRecord[]): void => {
    const family = familyOfFolder(folder);
    if (!journalsOn || family === null) return;
    try {
      const lines = sortRecords(settledRecords(records)).map(recordLine);
      writeLinesAtomic(path.join(journalDir(folder), `${runId}-snap.jsonl`), { journal: 1, kind: 'rec', fp: digestOf(family), ctx: '' }, lines);
    } catch (error) {
      journalWarnings.push(`the journal of ${folder} could not be written: ${String((error as Error).message ?? error).split('\n')[0]}`);
    }
  };

  const session: DiskSession = {
    root,
    index,
    fingerprint,
    trust,
    writes,
    progress: options.progress,
    get reports() {
      return reports;
    },
    decide(family: FamilyId): FamilyDecision {
      return planOf(family).decision;
    },
    records(folder: string): readonly CacheRecord[] {
      return replaced.get(folder)?.records ?? servedRecords(folder);
    },
    replace(folder, records, replaceOptions): void {
      // The secrets family never stores secret material, whoever produced the records (secret-records.mts).
      const held = folder === SECRETS_FOLDER ? safeSecretRecords(records) : records;
      replaced.set(folder, { records: held, depth: replaceOptions?.depth ?? 2 });
      checkpoint(folder, held);
    },
    journal(folder, kind, context = '', part = 0): JournalSink | undefined {
      const family = familyOfFolder(folder);
      if (!journalsOn || family === null) return undefined;
      const writer = part === 0 ? '' : `-p${String(part)}`;
      const name = kind === 'rec' ? `${runId}-inc${writer}.jsonl` : `${runId}-raw-${hashText(context).slice(0, 12)}${writer}.jsonl`;
      const key = `${folder}\0${name}`;
      let sink = sinks.get(key);
      if (sink === undefined) {
        sink = createSink(path.join(journalDir(folder), name), { journal: 1, kind, fp: digestOf(family), ctx: context });
        sinks.set(key, sink);
      }
      return sink;
    },
    journaled(folder, context): readonly unknown[] {
      const family = familyOfFolder(folder);
      return journalsOn && family !== null && !isFresh(family) ? journaledRaw(journalDir(folder), digestOf(family), context) : [];
    },
    unchanged: (paths, captured) => paths.every((file) => {
      const now = hashFile(path.join(root, file));
      const taken = captured?.[file];
      return taken === undefined ? now === index.hashOf(file) : (now ?? 'absent') === taken;
    }),
    report: (report) => void reports.push(report),
    verdicts: () => verdictList,
    flush(): FlushResult {
      const written: string[] = [];
      const removed: string[] = [];
      const warnings: string[] = [];
      // A file edited while the run read it gets no record.
      const settled = new Map<string, readonly CacheRecord[]>();
      for (const [folder, { records }] of replaced) settled.set(folder, settledRecords(records));
      if (trust.kind === 'base') {
        const committed = new Map<string, CacheRecord[]>();
        for (const [file, text] of readCacheDir(root)) {
          if (!file.endsWith('.jsonl')) continue;
          for (const folderName of settled.keys()) {
            if (file.startsWith(`${folderName}/`)) committed.set(folderName, [...(committed.get(folderName) ?? []), ...parseRecords(text).records]);
          }
        }
        const trusted = new Map([...settled.keys()].map((folder) => [folder, trustedRecords(folder)] as const));
        const computed = new Map(settled);
        verdictList = verifyCommitted({ trusted, computed, committed });
        return { written, removed, warnings };
      }
      if (!writes) return { written, removed, warnings };
      try {
        const base = path.join(root, ...CACHE_DIR.split('/'));
        // A write a kill interrupted leaves its temp file beside the records; it is no record and no part of the cache.
        for (const file of filesUnder(base)) if (TEMP_FILE.test(file)) fs.rmSync(file, { force: true });
        const stalePrint = cachedFingerprint.length === 0 || differences.length > 0;
        if (stalePrint) {
          // A part that differs invalidates the folders of the families that read it which this run did not rewrite: they were computed under the old part.
          for (const file of filesUnder(base)) {
            const rel = path.relative(base, file).split(path.sep).join('/');
            if (rel === FINGERPRINT_FILE || [...settled.keys()].some((folder) => rel.startsWith(`${folder}/`))) continue;
            if (!folderInvalid(rel.split('/').slice(0, rel.startsWith('check/') || rel.startsWith('lint/') ? 2 : 1).join('/'))) continue;
            fs.rmSync(file);
            removed.push(file);
            removeEmptyDirs(path.dirname(file), base);
          }
        }
        for (const [folder, records] of settled) {
          const depth = replaced.get(folder)?.depth ?? 2;
          const dir = dirOf(root, folder);
          const wanted = new Map([...groupByArea(records, depth)].map(([file, group]) => [path.join(dir, ...file.split('/')), serializeRecords(group)]));
          for (const [file, text] of wanted) writeIfChanged(file, text, written);
          for (const file of filesUnder(dir)) {
            if (wanted.has(file)) continue;
            fs.rmSync(file);
            removed.push(file);
            removeEmptyDirs(path.dirname(file), base);
          }
          // The folder is committed as the run judged it: its journal is compacted into the files above and is not read again.
          if (journalsOn) removeJournal(journalDir(folder));
        }
        if (replaced.size > 0 || stalePrint) writeIfChanged(path.join(base, FINGERPRINT_FILE), serializeFingerprint(fingerprint.parts), written);
      } catch (error) {
        warnings.push(`the cache could not be written: ${String((error as Error).message ?? error).split('\n')[0]}`);
      }
      if (journalsOn) {
        // What a folder this run did not finish keeps is what the next run resumes from, unless its parts moved on since.
        for (const folder of journalFolders(journalBase ?? '')) {
          if (settled.has(folder)) continue;
          const family = familyOfFolder(folder);
          if (family === null) removeJournal(journalDir(folder));
          else pruneJournal(journalDir(folder), digestOf(family));
        }
      }
      warnings.push(...journalWarnings);
      return { written: written.map((file) => path.relative(root, file).split(path.sep).join('/')), removed: removed.map((file) => path.relative(root, file).split(path.sep).join('/')), warnings };
    },
  };
  return session;
}

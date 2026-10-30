// session.mts - the disk-backed CheckSession of `starci app check` and `starci app lint`. It decides per family whether a run is full or diff
// (the rules of contexts/project/check-cache.md "When a run is full"), serves the trusted records of a folder, takes the records a family
// replaces and writes them once on flush: one JSON Lines file per area, byte-stable, only the files whose bytes changed. In CI it writes
// nothing and compares the committed cache with what it inherited or computed instead.
import fs from 'node:fs';
import path from 'node:path';
import { createContentIndex } from './content-index.mjs';
import { computeFingerprint, fingerprintDifferences, parseFingerprint, serializeFingerprint, type Fingerprint } from './fingerprint.mjs';
import { hashFile } from './hash.mjs';
import { groupByArea, parseRecords, serializeRecords } from './jsonl.mjs';
import { readCacheDir, resolveTrust, verifyCommitted, type CacheVerdict, type TrustSource } from './trust.mjs';
import { CACHE_DIR, type CacheRecord, type CheckSession, type ContentIndex, type FamilyDecision, type FamilyId, type FamilyReport, type FlushResult, type ProgressSink } from './types.mjs';

/** `STARCI_APP_CHECK_CACHE`: `full` ignores the cache (the release gate sets it), `verify` is read by the caller (runs diff, then full, compares). */
export const CACHE_ENV = 'STARCI_APP_CHECK_CACHE';
const FINGERPRINT_FILE = 'fingerprint.jsonl';

export interface DiskSessionOptions {
  readonly root: string;
  readonly tracked: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly progress: ProgressSink;
  readonly cliVersion?: string | undefined;
  /** The families `--full` selects. */
  readonly full?: ReadonlySet<FamilyId> | undefined;
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
  /** Whether this run may write the cache folder (a host run with a portable fingerprint that is not a forced-full release run). */
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  written.push(file);
}

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
  const fingerprint = options.fingerprint ?? computeFingerprint({ root, tracked, cliVersion: options.cliVersion, hfsDir: options.hfsDir });
  const trust = options.trust ?? resolveTrust({ root, env });
  const forcedFull = env[CACHE_ENV] === 'full';
  const reports: FamilyReport[] = [];
  const replaced = new Map<string, { records: readonly CacheRecord[]; depth: number }>();
  const parsed = new Map<string, readonly CacheRecord[]>();
  const trustedCache = (): ReadonlyMap<string, string> => trust.files();
  const cachedFingerprint = parseFingerprint(trustedCache().get(FINGERPRINT_FILE) ?? '');
  const differences = cachedFingerprint.length === 0 ? [] : fingerprintDifferences(cachedFingerprint, fingerprint.parts);
  let verdictList: CacheVerdict[] = [];

  const global = (): FamilyDecision | undefined => {
    if (forcedFull) return { mode: 'full', reason: `${CACHE_ENV}=full, the release gate never reads the cache` };
    if (!fingerprint.portable) return { mode: 'full', reason: `no portable fingerprint, nothing is written (${fingerprint.localReasons[0] ?? 'a local package'})` };
    if (trust.kind === 'none') return { mode: 'full', reason: `no trusted base (${trust.reason})` };
    if (cachedFingerprint.length === 0) return { mode: 'full', reason: trust.kind === 'base' ? 'no cache at the trusted base' : 'no cache in the tree' };
    if (differences.length > 0) return { mode: 'full', reason: `the fingerprint differs (${differences.slice(0, 3).join(', ')}${differences.length > 3 ? ', ...' : ''})` };
    return undefined;
  };

  const writes = !forcedFull && fingerprint.portable && trust.kind === 'worktree';

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
      if (options.full?.has(family) === true) return { mode: 'full', reason: '--full' };
      return global() ?? { mode: 'diff', reason: `against ${trust.reason}` };
    },
    records(folder: string): readonly CacheRecord[] {
      const own = replaced.get(folder);
      if (own !== undefined) return own.records;
      const hit = parsed.get(folder);
      if (hit !== undefined) return hit;
      const prefix = `${folder}/`;
      const seen = new Set<string>();
      const records: CacheRecord[] = [];
      for (const [file, text] of [...trustedCache()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (!file.startsWith(prefix) || !file.endsWith('.jsonl')) continue;
        for (const record of parseRecords(text).records) {
          const line = JSON.stringify(record);
          if (seen.has(line)) continue;
          seen.add(line);
          records.push(record);
        }
      }
      parsed.set(folder, records);
      return records;
    },
    replace(folder, records, replaceOptions): void {
      replaced.set(folder, { records, depth: replaceOptions?.depth ?? 2 });
    },
    unchanged: (paths) => paths.every((file) => hashFile(path.join(root, file)) === index.hashOf(file)),
    report: (report) => void reports.push(report),
    verdicts: () => verdictList,
    flush(): FlushResult {
      const written: string[] = [];
      const removed: string[] = [];
      const warnings: string[] = [];
      // A file edited while the run read it gets no record.
      const settled = new Map<string, readonly CacheRecord[]>();
      for (const [folder, { records }] of replaced) {
        settled.set(folder, records.filter((record) => index.hashOf(record.path) === undefined || hashFile(path.join(root, record.path)) === record.hash));
      }
      if (trust.kind === 'base') {
        const committed = new Map<string, CacheRecord[]>();
        for (const [file, text] of readCacheDir(root)) {
          if (!file.endsWith('.jsonl')) continue;
          for (const folderName of settled.keys()) {
            if (file.startsWith(`${folderName}/`)) committed.set(folderName, [...(committed.get(folderName) ?? []), ...parseRecords(text).records]);
          }
        }
        const trusted = new Map([...settled.keys()].map((folder) => [folder, session.records(folder)] as const));
        const computed = new Map(settled);
        verdictList = verifyCommitted({ trusted, computed, committed });
        return { written, removed, warnings };
      }
      if (!writes) return { written, removed, warnings };
      try {
        const base = path.join(root, ...CACHE_DIR.split('/'));
        const stalePrint = cachedFingerprint.length === 0 || differences.length > 0;
        if (stalePrint) {
          // A new fingerprint invalidates every folder this run did not rewrite: they were computed under the old one.
          for (const file of filesUnder(base)) {
            const rel = path.relative(base, file).split(path.sep).join('/');
            if (rel === FINGERPRINT_FILE || [...settled.keys()].some((folder) => rel.startsWith(`${folder}/`))) continue;
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
        }
        if (replaced.size > 0 || stalePrint) writeIfChanged(path.join(base, FINGERPRINT_FILE), serializeFingerprint(fingerprint.parts), written);
      } catch (error) {
        warnings.push(`the cache could not be written: ${String((error as Error).message ?? error).split('\n')[0]}`);
      }
      return { written: written.map((file) => path.relative(root, file).split(path.sep).join('/')), removed: removed.map((file) => path.relative(root, file).split(path.sep).join('/')), warnings };
    },
  };
  return session;
}

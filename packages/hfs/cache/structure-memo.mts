// structure-memo.mts - the result cache of the content rules of the structure pass (`--gate hfs`, `--gate secrets`). The rules of the pass used to run over every tracked
// file on every run. Two kinds are now reused (contexts/project/check-cache.md "Which step reuses what"):
//   - a per-file rule (`FileRule`: plaintext secrets, bypass markers, soft size): one record per file, `file-rules`, keyed on the file's content hash, the hashes of the
//     other files the rule declares it reads (`deps`) and the names of the rules; it holds each rule's findings for the file. The cache folder is the only place a verdict is kept.
//   - a cross-file rule (`memoKeyed`: the documentation freshness): one record per scope, `rule:<id>`, keyed on the exact set of files the rule read through `readText` /
//     `readJson` (recorded when it ran, each with the hash it had then) and on the digest of the tracked path list, which every such rule derives its file sets from.
// Everything else the pass runs (the slots, the tree, the pins, the managed files, the rules that stat or walk the work tree, git state, untracked entries) stays always-run.
// A rule that must be judged on the work tree is never given to this memo; a finding that does not carry the path of the file it judges makes the whole batch uncacheable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { FileRule, RuleMemo } from '../runtime/scripts/hfs/rule-memo.mjs';
import { recordReads } from '../runtime/scripts/hfs/rules/read.mjs';
import { inCacheDir } from './content-index.mjs';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import type { RecordSet } from './records.mjs';
import type { CacheRecord, CheckSession, Finding, JsonValue } from './types.mjs';

export const FILE_RULES_STEP = 'file-rules';
export const RULE_STEP_PREFIX = 'rule:';
export const UNIT_STEP_PREFIX = 'unit:';

/** What the memo did, for the family's diagnosis line. */
export interface MemoCounts {
  /** Files whose per-file rules were judged afresh / taken from a record. */
  filesChecked: number;
  filesReused: number;
  /** Cross-file rules run afresh / taken from a record. */
  keyedChecked: number;
  keyedReused: number;
  /** Per-file units of cross-file rules judged afresh / taken from a record. */
  unitsChecked: number;
  unitsReused: number;
}

export interface StructureMemo {
  readonly memo: RuleMemo;
  readonly counts: MemoCounts;
  /** The app paths whose per-file records this run holds (the rest are dropped with their files). */
  readonly files: Set<string>;
  /** The app paths whose unit records this run holds, by unit step. */
  readonly units: Map<string, Set<string>>;
}

const posix = (value: string): string => value.split(path.sep).join('/');

const compact = (finding: CheckFinding): Finding => ({
  path: finding.path ?? '.', line: finding.line ?? 0, column: finding.column ?? 0, rule: finding.code, message: String(finding.message ?? ''),
});

const plain = <T,>(value: T): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** The memo of one structure pass over the app at `root`. `reuse` is false when the family runs in full: the records are then written and never read. */
export function createStructureMemo(input: { session: CheckSession; records: RecordSet; reuse: boolean; root: string; tracked: readonly string[] }): StructureMemo {
  const { session, records, reuse, root } = input;
  const counts: MemoCounts = { filesChecked: 0, filesReused: 0, keyedChecked: 0, keyedReused: 0, unitsChecked: 0, unitsReused: 0 };
  const files = new Set<string>();
  const units = new Map<string, Set<string>>();
  // What this run already judged, so a rule asked twice about one file in one run (the schedule scan is) answers from the first judgement.
  const judged = new Map<string, JsonValue>();
  const textHashes = new Map<string, string>();
  // The hash of an app path now: the index's for a tracked file (the snapshot of this run), the work tree's for anything else, `absent` for a missing one.
  const hashNow = (appPath: string): string => session.index.hashOf(appPath) ?? hashFile(path.join(root, appPath)) ?? 'absent';
  // What every cross-file rule derives its file sets and its parsing from: the tracked path list, and the TypeScript the rules parse with (the lockfile is a fingerprint part, but an app
  // with no install resolves the compiler from the harness instead).
  let trackedDigest: string | undefined;
  const typescriptVersion = (): string => loadTypescript(root, path.dirname(fileURLToPath(import.meta.url)))?.version ?? 'none';
  const digestOfTracked = (): string => (trackedDigest ??= hashText(`${[...input.tracked].sort().join('\n')}\0typescript=${typescriptVersion()}`));
  const prefixOf = (scopeRoot: string): string => {
    const relative = posix(path.relative(root, scopeRoot));
    return relative === '' ? '' : `${relative}/`;
  };

  const filesStep = (scopeRoot: string, list: readonly string[], rules: readonly FileRule[]): CheckFinding[] => {
    const prefix = prefixOf(scopeRoot);
    const names = rules.map((rule) => rule.id).join('+');
    // The cache folder is rewritten by every run and is outside every step's file set: its files are judged live and never keyed.
    const live = list.filter((file) => inCacheDir(`${prefix}${file}`));
    const liveOut = live.length === 0 ? [] : rules.map((rule) => rule.run([...live]));
    const entries = list.filter((file) => !inCacheDir(`${prefix}${file}`)).map((file) => {
      const deps = [...new Set(rules.flatMap((rule) => rule.deps?.(file) ?? []))].sort().map((dep) => `${prefix}${dep}`);
      const parts: Record<string, string> = { rules: names, self: hashNow(`${prefix}${file}`) };
      const captured: Record<string, string> = { [`${prefix}${file}`]: parts['self'] as string };
      for (const dep of deps) { parts[`dep:${dep}`] = hashNow(dep); captured[dep] = parts[`dep:${dep}`] as string; }
      return { file, app: `${prefix}${file}`, deps, captured, key: combineHashes(parts) };
    });
    const held = new Map<string, Record<string, CheckFinding[]>>();
    for (const entry of entries) {
      const record = reuse ? records.matching(entry.app, FILE_RULES_STEP, entry.key) : undefined;
      if (record?.data !== undefined) held.set(entry.file, record.data as unknown as Record<string, CheckFinding[]>);
    }
    const missing = entries.filter((entry) => !held.has(entry.file));
    counts.filesReused += entries.length - missing.length;
    counts.filesChecked += missing.length;
    const computed = new Map<string, Record<string, CheckFinding[]>>(missing.map((entry) => [entry.file, {}]));
    if (missing.length > 0) {
      const names = new Set(missing.map((entry) => entry.file));
      for (const rule of rules) {
        for (const finding of rule.run(missing.map((entry) => entry.file))) {
          const own = finding.path !== undefined && names.has(finding.path) ? computed.get(finding.path) : undefined;
          // A finding on a file the batch did not hold is a rule that is not per-file: nothing of it can be kept per file.
          if (own === undefined) return rules.flatMap((each) => each.run([...list]));
          (own[rule.id] ??= []).push(finding);
        }
      }
      for (const entry of missing) {
        const result = computed.get(entry.file) as Record<string, CheckFinding[]>;
        if (!session.unchanged(Object.keys(entry.captured), entry.captured)) continue;
        records.put({ path: entry.app, step: FILE_RULES_STEP, hash: entry.key, findings: Object.values(result).flat().map(compact), data: plain(result) });
      }
    }
    for (const entry of entries) files.add(entry.app);
    const out: CheckFinding[] = [];
    rules.forEach((rule, at) => {
      for (const entry of entries) out.push(...((held.get(entry.file) ?? computed.get(entry.file))?.[rule.id] ?? []));
      out.push(...(liveOut[at] ?? []));
    });
    return out;
  };

  const keyedStep = (scopeRoot: string, id: string, run: () => CheckFinding[]): CheckFinding[] => {
    const at = prefixOf(scopeRoot).replace(/\/$/, '') || '.';
    const step = `${RULE_STEP_PREFIX}${id}`;
    const digest = digestOfTracked();
    const record = reuse ? records.get(at, step) : undefined;
    const data = record?.data as { tracked?: string; reads?: Record<string, string>; findings?: CheckFinding[] } | undefined;
    if (data?.tracked === digest && data.reads !== undefined && data.findings !== undefined && Object.entries(data.reads).every(([file, hash]) => hashNow(file) === hash)) {
      counts.keyedReused += 1;
      return data.findings;
    }
    counts.keyedChecked += 1;
    const reads: Record<string, string> = {};
    const findings = recordReads((from, rel) => {
      const app = posix(path.relative(root, path.join(from, rel)));
      if (app.startsWith('..') || path.isAbsolute(app) || app in reads) return;
      reads[app] = hashNow(app);
    }, run);
    if (session.unchanged(Object.keys(reads), reads)) {
      const stored: CacheRecord = { path: at, step, hash: combineHashes({ tracked: digest, ...Object.fromEntries(Object.entries(reads).map(([file, hash]) => [`read:${file}`, hash])) }), findings: findings.map(compact), data: plain({ tracked: digest, reads, findings }) };
      records.put(stored);
    }
    return findings;
  };

  const unitStep = <T,>(scopeRoot: string, id: string, file: string, extra: string, empty: T, compute: () => T): T => {
    const app = `${prefixOf(scopeRoot)}${file}`;
    const step = `${UNIT_STEP_PREFIX}${id}`;
    let extraHash = textHashes.get(extra);
    if (extraHash === undefined) textHashes.set(extra, (extraHash = hashText(extra)));
    const self = hashNow(app);
    const key = combineHashes({ unit: id, extra: extraHash, self, typescript: typescriptVersion() });
    (units.get(step) ?? units.set(step, new Set()).get(step))?.add(app);
    const memory = judged.get(JSON.stringify([step, app, key]));
    if (memory !== undefined) return memory as T;
    const record = reuse ? records.matching(app, step, key) : undefined;
    let value: T;
    if (record !== undefined) {
      counts.unitsReused += 1;
      value = (record.data ?? empty) as T;
    } else {
      counts.unitsChecked += 1;
      value = compute();
      const empties = JSON.stringify(empty) === JSON.stringify(value);
      if (session.unchanged([app], { [app]: self })) records.put({ path: app, step, hash: key, findings: [], ...(empties ? {} : { data: plain(value) }) });
    }
    judged.set(JSON.stringify([step, app, key]), value as unknown as JsonValue);
    return value;
  };

  return { memo: { files: filesStep, keyed: keyedStep, unit: unitStep }, counts, files, units };
}

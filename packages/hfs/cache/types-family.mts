// types-family.mts - the `--types` family of the app check cache (contexts/project/check-cache.md, "Which step reuses what"): each workspace's `tsc --noEmit` through the
// app's own TypeScript, one program at a time. A program's key is the sha256 of everything the program reads: the hash of each tracked path it covers (`absent` for one the
// work tree lost), the entries staged for it and the untracked files its TypeScript reads (generated code). An unchanged key reuses the program's recorded diagnostics; a
// changed one runs that program's `tsc` in full. TypeScript's `.tsbuildinfo` speeds that run but is host state, not a result: it lives in the untracked tool cache and is
// never written into the app, so never committed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { CACHE_DIR } from './types.mjs';
import { combineHashes, hashFile } from './hash.mjs';
import { sortFindings } from './jsonl.mjs';
import type { CacheRecord, CheckSession, FamilyReport, Finding } from './types.mjs';

/** The folder of the session that holds the records of this family. */
export const TYPES_FOLDER = 'check/types';
/** The step of a program's record. */
export const TSC_STEP = 'tsc';

/** One workspace program: `tsc -p <tsconfig> --noEmit`. Paths are app-relative posix. */
export interface TypesProgram {
  /** The record key, unique in the app (`be`, `fe/apps/web`). */
  readonly name: string;
  /** The tsconfig the program is built from. */
  readonly tsconfig: string;
  /** The folders (or files) the program reads, whose tracked paths make its key; defaults to the tsconfig's folder. */
  readonly reads?: readonly string[];
}

/** What the program reads that the content index does not hold. */
export interface ProgramInputs {
  /** Staged entries for the program's paths, as `path:blob` pairs (the machine reads the index). */
  readonly staged?: readonly string[];
  /** Untracked files its TypeScript program reads (what its tsconfig includes or an import resolves to that git does not track), app-relative. */
  readonly untracked?: readonly string[];
}

/** What one `tsc` run came to. */
export interface TscOutcome {
  readonly status: number;
  /** tsc's output, `--pretty false`. */
  readonly output: string;
}

export interface TypesFamilyOptions {
  readonly session: CheckSession;
  readonly programs: readonly TypesProgram[];
  /** Runs one program's `tsc`; `buildInfo` is where its `.tsbuildinfo` goes (the untracked tool cache). */
  readonly run: (program: TypesProgram, buildInfo: string) => TscOutcome;
  /** The untracked tool cache of slot `app.tool-cache` (`<STARCI_CACHE_HOME>/<repo>/app-check`). */
  readonly toolCacheDir: string;
  readonly inputsOf?: (program: TypesProgram) => ProgramInputs;
}

export interface TypesFamilyResult {
  readonly ok: boolean;
  readonly ran: readonly string[];
  readonly reused: readonly string[];
  /** Programs whose `tsc` did not complete (no diagnostics and a failing status): nothing of theirs is stored. */
  readonly incomplete: readonly string[];
  readonly findings: readonly Finding[];
  readonly report: FamilyReport;
}

const posix = (file: string): string => file.split(path.sep).join('/');
const within = (file: string, prefix: string): boolean => prefix === '.' || prefix === '' || file === prefix || file.startsWith(`${prefix}/`);

/** The folders a program reads, app-relative: its `reads`, else the folder of its tsconfig. */
export function readsOf(program: TypesProgram): readonly string[] {
  return program.reads ?? [path.posix.dirname(program.tsconfig)];
}

/**
 * The key of a program: its tsconfig and every tracked path under what it reads by content hash (`absent` for a tracked path the work tree no longer holds), the staged
 * entries and the untracked inputs. Equal on every host for one commit; a program that reads nothing that changed keeps its key.
 */
export function programKey(program: TypesProgram, session: CheckSession, inputs: ProgramInputs = {}): string {
  const parts: Record<string, string> = {};
  const reads = readsOf(program);
  for (const file of session.index.paths) if (reads.some((prefix) => within(file, prefix)) || file === program.tsconfig) parts[`tracked:${file}`] = session.index.hashOf(file) ?? 'absent';
  for (const entry of inputs.staged ?? []) parts[`staged:${entry}`] = '1';
  for (const file of inputs.untracked ?? []) parts[`untracked:${file}`] = hashFile(path.join(session.root, file)) ?? 'absent';
  return combineHashes(parts);
}

/**
 * Where a program's `.tsbuildinfo` goes. It must be outside the app's committed cache, so a tool-cache folder configured inside `.starcistacks/cache` is refused: a
 * `.tsbuildinfo` holds versions and signatures, not results, and is never committed.
 */
export function tsBuildInfoPath(toolCacheDir: string, appRoot: string, program: TypesProgram): string {
  const file = path.join(path.resolve(toolCacheDir), 'tsbuildinfo', `${program.name.replaceAll('/', '__')}.tsbuildinfo`);
  const committed = path.resolve(appRoot, CACHE_DIR);
  if (file === committed || file.startsWith(`${committed}${path.sep}`)) throw new Error(`the tool cache ${toolCacheDir} is inside ${CACHE_DIR}: a .tsbuildinfo is host state and is never committed`);
  return file;
}

/** `text` with every occurrence of the app's absolute path removed, so a message carries app-relative posix paths only. */
export function relativise(text: string, appRoot: string): string {
  const root = path.resolve(appRoot);
  let out = text;
  for (const variant of new Set([root, root.split(path.sep).join('/')])) out = out.split(`${variant}/`).join('').split(`${variant}${path.sep}`).join('').split(variant).join('.');
  return out;
}

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/u;
const GLOBAL_DIAGNOSTIC = /^(?:error|warning) (TS\d+): (.*)$/u;

/** The findings in tsc's `--pretty false` output: `file(line,col): error TS1234: message`, continuation lines joined to their message. Run from the app root. */
export function parseTscOutput(output: string, appRoot: string, fallbackPath: string): Finding[] {
  const findings: Finding[] = [];
  let last: { -readonly [K in keyof Finding]: Finding[K] } | undefined;
  for (const raw of output.split(/\r?\n/u)) {
    const line = relativise(raw, appRoot);
    const match = DIAGNOSTIC.exec(line);
    const global = match ? null : GLOBAL_DIAGNOSTIC.exec(line);
    if (match) {
      last = { path: (match[1] ?? '').replaceAll('\\', '/').replace(/^\.\//u, ''), line: Number(match[2]), column: Number(match[3]), rule: match[4] ?? '', message: match[5] ?? '' };
      findings.push(last);
    } else if (global) {
      last = { path: fallbackPath, line: 1, column: 1, rule: global[1] ?? '', message: global[2] ?? '' };
      findings.push(last);
    } else if (last !== undefined && /^\s+\S/u.test(line)) {
      last.message += `\n${line.trim()}`;
    }
  }
  return sortFindings(findings);
}

const identity = (finding: Finding): string => `${finding.path}\0${finding.rule}\0${finding.message}`;

/**
 * Runs the type check of every program against the cache. A program whose key is unchanged takes its recorded diagnostics; a changed one runs in full (all of them
 * under `--full`). A run that produced no diagnostics and failed (tsc itself could not complete) stores nothing, and so does a program whose files changed while it ran.
 */
export function runTypesFamily(options: TypesFamilyOptions): TypesFamilyResult {
  const { session, programs, run, toolCacheDir } = options;
  const decision = session.decide('types');
  const previous = new Map(session.records(TYPES_FOLDER).filter((record) => record.step === TSC_STEP).map((record) => [record.path, record]));
  const progress = session.progress.step('types', 'tsc', programs.length);
  const records: CacheRecord[] = [];
  const ran: string[] = [];
  const reused: string[] = [];
  const incomplete: string[] = [];
  const findings: Finding[] = [];
  let known = 0;
  let added = 0;
  let fixed = 0;
  for (const program of programs) {
    const inputs = options.inputsOf?.(program) ?? {};
    const key = programKey(program, session, inputs);
    const before = previous.get(program.name);
    let current: readonly Finding[];
    if (decision.mode === 'diff' && before !== undefined && before.hash === key) {
      current = before.findings;
      records.push(before);
      reused.push(program.name);
    } else {
      const outcome = run(program, tsBuildInfoPath(toolCacheDir, session.root, program));
      ran.push(program.name);
      current = parseTscOutput(outcome.output, session.root, program.tsconfig);
      if (current.length === 0 && outcome.status !== 0) incomplete.push(program.name);
      else if (programKey(program, session, inputs) === key) records.push({ path: program.name, step: TSC_STEP, hash: key, findings: current });
      else incomplete.push(program.name);
    }
    const had = new Set((before?.findings ?? []).map(identity));
    const now = new Set(current.map(identity));
    for (const finding of current) if (had.has(identity(finding))) known += 1; else added += 1;
    for (const id of had) if (!now.has(id)) fixed += 1;
    findings.push(...current);
    progress.tick(reused.length + ran.length, reused.length, ran.length);
  }
  progress.end();
  session.replace(TYPES_FOLDER, records);
  const report: FamilyReport = { family: 'types', mode: decision.mode, reason: decision.reason, checked: ran.length, reused: reused.length, newFindings: added, knownFindings: known, fixedFindings: fixed };
  session.report(report);
  return { ok: findings.length === 0 && incomplete.length === 0, ran, reused, incomplete, findings: sortFindings(findings), report };
}

/**
 * The real `tsc` of an app: the program's own TypeScript (resolved from its folder, so the version the lockfile pins), `--noEmit` with an incremental build info in the
 * tool cache, run from the app root so paths in the output are app-relative.
 */
export function createTscRunner({ appRoot, typescriptFrom }: { appRoot: string; typescriptFrom?: string }): TypesFamilyOptions['run'] {
  return (program, buildInfo) => {
    const folder = path.resolve(appRoot, path.posix.dirname(program.tsconfig));
    const tsc = path.join(path.dirname(createRequire(typescriptFrom ?? path.join(folder, 'package.json')).resolve('typescript/package.json')), 'bin', 'tsc');
    fs.mkdirSync(path.dirname(buildInfo), { recursive: true });
    const result = spawnSync(process.execPath, [tsc, '-p', posix(path.relative(appRoot, path.resolve(appRoot, program.tsconfig))), '--noEmit', '--incremental', '--tsBuildInfoFile', buildInfo, '--pretty', 'false'], {
      cwd: appRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
  };
}

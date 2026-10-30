// format.mjs - HFS_FORMAT (R19): Prettier is the only formatter, and every tracked file it formats is formatted.
// The check is `prettier --check` over the tracked files through the repository's OWN prettier (resolved from the repository,
// with the repository's prettier config and .prettierignore), so it judges what the repository's pre-commit and CI judge. A
// repository with no installed prettier is a refusal (HFS_FORMAT_TOOL_MISSING), never a pass. Prettier runs in batches: the files are cut into
// batches of FORMAT_BATCH, and a long list is spread over worker threads that each load the repository's prettier once (one process or one
// config lookup per file was 16 of the 35 minutes of a full app check). Configuration is resolved once per directory, not once per file.
import os from 'node:os';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { SyncError } from './index.mjs';

export const FORMAT = 'HFS_FORMAT';
const IGNORE_FILE = '.prettierignore';

/** The slice of the repository's own prettier module this check calls. */
export interface Prettier {
  getFileInfo(file: string, options: { ignorePath: string | undefined; resolveConfig: boolean }): Promise<{ ignored: boolean; inferredParser: string | null }> | { ignored: boolean; inferredParser: string | null };
  resolveConfig(file: string, options?: { editorconfig?: boolean; useCache?: boolean }): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  check(text: string, options: Record<string, unknown>): Promise<boolean> | boolean;
  format(text: string, options: Record<string, unknown>): Promise<string> | string;
}

/** One HFS_FORMAT finding. */
export type FormatFinding = { code: string; level: 'error'; path: string; message: string };
/** Lockfiles are written by npm, not by people: they are never formatted. */
const LOCKFILES = new Set(['package-lock.json']);

/** The repository's own prettier, or a SyncError when it is not installed. */
export function loadPrettier(repoRoot: string): Prettier {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  try {
    return require('prettier') as Prettier;
  } catch {
    throw new SyncError('HFS_FORMAT_TOOL_MISSING', `prettier is not installed under ${repoRoot}; install the version knowledge/hfs/canon-pins.yaml pins, so the format check judges what the repository's own gates judge`);
  }
}

/** Files per batch: one message to a worker, one progress step. */
export const FORMAT_BATCH = 64;
/** Fewer files than this run in this thread: starting workers would cost more than it saves. */
const WORKER_MIN_FILES = 256;

/** The formattable files of `files`: lockfiles are written by npm and never formatted. */
export const formattable = (files: readonly string[]): string[] => files.filter((f) => !LOCKFILES.has(path.posix.basename(f)));

/**
 * The HFS_FORMAT findings of one batch of `files`, in this thread. The ignore file is read by prettier once per call and the configuration is
 * resolved with prettier's own cache, so a batch costs one lookup per directory.
 */
export async function checkBatch({ repoRoot, files, prettier }: { repoRoot: string; files: readonly string[]; prettier: Prettier }): Promise<FormatFinding[]> {
  const ignorePath = path.join(repoRoot, IGNORE_FILE);
  const ignoreFile = fs.existsSync(ignorePath) ? ignorePath : undefined;
  const findings: FormatFinding[] = [];
  for (const file of formattable(files)) {
    const absolute = path.join(repoRoot, file);
    let text: string;
    try { text = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    const info = await prettier.getFileInfo(absolute, { ignorePath: ignoreFile, resolveConfig: true });
    if (info.ignored || !info.inferredParser) continue;
    const options = (await prettier.resolveConfig(absolute, { editorconfig: true, useCache: true })) ?? {};
    try {
      if (!(await prettier.check(text, { ...options, filepath: absolute }))) findings.push({ code: FORMAT, level: 'error', path: file, message: `${file} is not formatted by prettier; run \`npm run format\`` });
    } catch (error) {
      findings.push({ code: FORMAT, level: 'error', path: file, message: `${file} cannot be formatted: ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}` });
    }
  }
  return findings;
}

/** Cuts `files` into batches of `size`. */
export function batches<T>(files: readonly T[], size = FORMAT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < files.length; i += size) out.push(files.slice(i, i + size));
  return out;
}

/** How many worker threads a list of `count` files gets: none below WORKER_MIN_FILES, else up to the cores left over, at most 8. */
export function workerCount(count: number, cores = os.availableParallelism()): number {
  if (count < WORKER_MIN_FILES) return 0;
  return Math.max(0, Math.min(8, cores - 1, Math.ceil(count / (FORMAT_BATCH * 2))));
}

function inWorkers({ repoRoot, files, workers, onProgress }: { repoRoot: string; files: readonly string[]; workers: number; onProgress: ((done: number) => void) | undefined }): Promise<FormatFinding[]> {
  const queue = batches(files);
  const findings: FormatFinding[] = [];
  let done = 0;
  return new Promise((resolve, reject) => {
    let running = 0;
    let failed = false;
    const pool: Worker[] = [];
    const next = (worker: Worker): void => {
      const batch = queue.shift();
      if (batch === undefined) {
        void worker.terminate();
        if (running === 0 && !failed) resolve(findings);
        return;
      }
      running += 1;
      worker.postMessage({ repoRoot, files: batch });
    };
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      for (const worker of pool) void worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    for (let i = 0; i < workers; i += 1) {
      const worker = new Worker(new URL('./format-worker.mjs', import.meta.url));
      pool.push(worker);
      worker.on('message', (message: { findings?: FormatFinding[]; count?: number; error?: string; code?: string }) => {
        if (message.error !== undefined) {
          fail(message.code === 'HFS_FORMAT_TOOL_MISSING' ? new SyncError('HFS_FORMAT_TOOL_MISSING', message.error) : new Error(message.error));
          return;
        }
        running -= 1;
        findings.push(...(message.findings ?? []));
        done += message.count ?? 0;
        onProgress?.(done);
        next(worker);
      });
      worker.on('error', fail);
      next(worker);
    }
  });
}

/**
 * The HFS_FORMAT findings over the tracked `files` of `repoRoot`: one per file prettier would change, or cannot parse, sorted by path.
 * `prettier` is a seam for specs (and keeps the run in this thread); the default is the repository's own, in worker threads for a long list.
 */
export async function formatFindings({ repoRoot, files, prettier, onProgress }: { repoRoot: string; files: readonly string[]; prettier?: Prettier | undefined; onProgress?: ((done: number) => void) | undefined }): Promise<FormatFinding[]> {
  const list = formattable(files);
  const mine = prettier ?? loadPrettier(repoRoot);
  const workers = prettier === undefined ? workerCount(list.length) : 0;
  let findings: FormatFinding[];
  if (workers > 0) findings = await inWorkers({ repoRoot, files: list, workers, onProgress });
  else {
    findings = [];
    let done = 0;
    for (const batch of batches(list)) {
      findings.push(...await checkBatch({ repoRoot, files: batch, prettier: mine }));
      done += batch.length;
      onProgress?.(done);
    }
  }
  return findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

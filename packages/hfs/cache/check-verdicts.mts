// check-verdicts.mts - the verdicts of the project checks (cache/project-checks.mts) and of the nivoos package checks (cache/nivoos-package-check.mts), kept in the records of `check/build`
// beside the CI-parity verdicts, each under its own step, so a check that declares what it reads is judged again only when something it reads changed. A verdict is keyed on the tracked
// files the check reads (by content hash), what else decides it (the Node major, the harness version, the lockfile, the commit a ref names), and is stored only when the check ran to its own
// exit and none of what it read changed during the run. A check that declares nothing it reads has no key and runs every time, as before (R402).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './git.mjs';
import { combineHashes, hashFile } from './hash.mjs';
import { RecordSet } from './records.mjs';
import type { CacheRecord, CheckSession, JsonValue } from './types.mjs';

/** The version of the @starci/hfs that runs: a verdict of another harness is no answer. */
const HFS_VERSION = String((JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown }).version ?? 'unknown');

/** The folder of the verdicts: the build family's, whose other records (the CI-parity steps) this book keeps. */
export const VERDICT_FOLDER = 'check/build';

/** What a verdict is keyed on. */
export interface VerdictKey {
  /** The sha256 of every input. */
  readonly key: string;
  /** The tracked paths the check reads, for the "unchanged during the run" test, and the hash the key took of each. */
  readonly inputs: readonly string[];
  readonly captured: Readonly<Record<string, string>>;
}

/** Whether `file` lies at or under `prefix` (a folder or a file, app-relative posix). */
export const under = (file: string, prefix: string): boolean => prefix === '.' || prefix === '' || file === prefix || file.startsWith(`${prefix.replace(/\/$/u, '')}/`);

/**
 * The key of a check that reads `reads` (tracked files or folders, app-relative): the content hash of every tracked path at or under them (`absent` for none), `extra` (named
 * inputs: the check's own file, the Node major, a ref's commit), and the app lockfile. A read that matches no tracked path is itself part of the key, so adding the first file re-keys.
 */
export function verdictKey(session: CheckSession, reads: readonly string[], extra: Readonly<Record<string, string>>): VerdictKey {
  const captured: Record<string, string> = {};
  for (const file of session.index.paths) if (reads.some((prefix) => under(file, prefix))) captured[file] = session.index.hashOf(file) ?? 'absent';
  const parts: Record<string, string> = { '#reads': reads.join('\0'), '#hfs': HFS_VERSION, '#node': process.versions.node.split('.')[0] ?? '', '#lock': hashFile(path.join(session.root, 'package-lock.json')) ?? 'absent', ...extra };
  for (const [file, hash] of Object.entries(captured)) parts[`path:${file}`] = hash;
  return { key: combineHashes(parts), inputs: Object.keys(captured), captured };
}

/** The verdict a check recorded: green, or red with the message its finding carries. */
export interface Verdict { readonly red: boolean; readonly message: string }

/** The verdicts of one step (`project-check`, `nivoos-package`) of the folder, read at the start of a run and written back whole, every other step's record kept. */
export class VerdictBook {
  private readonly records: RecordSet;
  private readonly live = new Set<string>();
  private readonly session: CheckSession;
  private readonly step: string;
  private readonly reuse: boolean;

  constructor(session: CheckSession, step: string, reuse: boolean) {
    this.session = session;
    this.step = step;
    this.reuse = reuse;
    this.records = new RecordSet(session.records(VERDICT_FOLDER));
  }

  /** The verdict recorded for `id` under exactly this key, when the run may read the cache. */
  held(id: string, key: VerdictKey): Verdict | undefined {
    this.live.add(id);
    const record = this.reuse ? this.records.matching(id, this.step, key.key) : undefined;
    const data = record?.data as { red?: unknown; message?: unknown } | undefined;
    return record === undefined || data === undefined ? undefined : { red: data.red === true, message: typeof data.message === 'string' ? data.message : '' };
  }

  /** Records the verdict of a check that ran to its own exit, when nothing it read changed while it ran. */
  put(id: string, key: VerdictKey, verdict: Verdict): void {
    this.live.add(id);
    if (!this.session.unchanged(key.inputs, key.captured)) return;
    const record: CacheRecord = { path: id, step: this.step, hash: key.key, findings: [], data: { red: verdict.red, message: verdict.message } as JsonValue };
    this.records.put(record);
  }

  /** Writes the folder back: the verdicts of this step for the checks that exist now, every other step's records as they were. */
  finish(): void {
    this.records.retain(this.step, this.live);
    this.session.replace(VERDICT_FOLDER, this.records.toArray());
  }
}

/** The object a git revision names, `origin/dev:packages/x/seed` (a ref and a path: the tree or blob of that path at the ref), as its sha; null when git cannot name it (no such ref or path). */
export function revisionSha(root: string, revision: string): string | null {
  const answer = git(root, ['rev-parse', '--verify', '--quiet', revision]);
  const sha = answer.stdout.trim();
  return answer.ok && /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null;
}

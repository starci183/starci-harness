// content-index.mts - the tracked files of the app and their content hashes, hashed again on every run. The cache folder itself is outside
// the index: it never keys a step and is never a step's file set.
import path from 'node:path';
import { hashFile } from './hash.mjs';
import { CACHE_DIR, type ContentIndex } from './types.mjs';

/** Whether `file` is inside the committed cache folder. */
export const inCacheDir = (file: string): boolean => file === CACHE_DIR || file.startsWith(`${CACHE_DIR}/`);

/** The index of `tracked` (app-relative posix paths) read from the work tree at `root`. A path the work tree no longer holds has no hash. */
export function createContentIndex(root: string, tracked: readonly string[]): ContentIndex {
  const hashes = new Map<string, string>();
  const paths: string[] = [];
  for (const file of tracked) {
    if (inCacheDir(file)) continue;
    paths.push(file);
    const hash = hashFile(path.join(root, file));
    if (hash !== undefined) hashes.set(file, hash);
  }
  paths.sort();
  return { paths, hashOf: (file) => hashes.get(file) };
}

/** What differs between the work tree and a trusted record set: `modified` (hash differs), `added` (no record), `deleted` (a record, no file). */
export interface IndexDiff {
  readonly modified: readonly string[];
  readonly added: readonly string[];
  readonly deleted: readonly string[];
}

/** The diff of the index against `recorded` (path to the hash a trusted record holds). A rename is a deletion and an addition. */
export function diffIndex(index: ContentIndex, recorded: ReadonlyMap<string, string>): IndexDiff {
  const modified: string[] = [];
  const added: string[] = [];
  for (const file of index.paths) {
    const had = recorded.get(file);
    if (had === undefined) added.push(file);
    else if (had !== index.hashOf(file)) modified.push(file);
  }
  const live = new Set(index.paths);
  const deleted = [...recorded.keys()].filter((file) => !live.has(file)).sort();
  return { modified, added, deleted };
}

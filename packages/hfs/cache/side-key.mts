// side-key.mts - the key of a side for the steps that read its whole program (the architecture machine, the contract emit, the boot proof,
// the type-aware lint rules, tsc). It is the sha256 of the hash of each tracked path of the side (`absent` for one deleted in the work tree),
// its staged entries (the machine reads the index), and the untracked files its TypeScript program reads: what its tsconfig includes that git
// does not track, generated code included. One edit anywhere in the side changes the key, so a scoped step re-runs the whole side.
import fs from 'node:fs';
import path from 'node:path';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { git } from './git.mjs';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import type { ContentIndex } from './types.mjs';

export interface SideKey {
  readonly key: string;
  /** Every path the key covers: tracked paths of the side and the untracked program inputs. */
  readonly inputs: readonly string[];
}

/** The untracked files the side's TypeScript program includes (generated code), side-relative paths prefixed with `side/`. */
export function untrackedProgramInputs(root: string, side: string, tracked: ReadonlySet<string>): string[] {
  const ts = loadTypescript(root);
  const tsconfig = path.join(root, side, 'tsconfig.json');
  if (ts === null || !fs.existsSync(tsconfig)) return [];
  try {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (read.error !== undefined) return [];
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.join(root, side));
    const found: string[] = [];
    for (const name of parsed.fileNames) {
      const rel = path.relative(root, name).split(path.sep).join('/');
      if (rel.startsWith('..') || rel.includes('/node_modules/') || tracked.has(rel)) continue;
      found.push(rel);
    }
    return found.sort();
  } catch {
    return [];
  }
}

/** The key of `side` (`be` or `fe`) of the app at `root`. */
export function sideKey(root: string, index: ContentIndex, side: string): SideKey {
  const prefix = `${side}/`;
  const trackedPaths = index.paths.filter((file) => file.startsWith(prefix));
  const parts: Record<string, string> = {};
  for (const file of trackedPaths) parts[`tracked:${file}`] = index.hashOf(file) ?? 'absent';
  const staged = git(root, ['ls-files', '-s', '-z', '--', prefix]);
  parts['staged'] = hashText(staged.stdout);
  const untracked = untrackedProgramInputs(root, side, new Set(index.paths));
  for (const file of untracked) parts[`untracked:${file}`] = hashFile(path.join(root, file)) ?? 'absent';
  return { key: combineHashes(parts), inputs: [...trackedPaths, ...untracked] };
}

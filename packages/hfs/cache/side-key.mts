// side-key.mts - the key of a side for the steps that read its whole program (the architecture machine, the contract emit, the boot proof,
// the type-aware lint rules, tsc). It is the sha256 of the hash of each tracked path of the side (`absent` for one deleted in the work tree),
// its staged entries (the machine reads the index), and the untracked files its TypeScript program reads: what its tsconfig includes that git
// does not track, generated code included. One edit anywhere in the side changes the key, so a scoped step re-runs the whole side. A build artifact the
// tsconfig's globs reach (git ignores it and it is no generated code: a framework's environment declaration, its build folder's types, a dist) is no input:
// a clean checkout has none, and the programs the key stands for do not read it (runtime/scripts/hfs/program-artifacts.mts).
// Generated output (a gitignored `__generated__` folder, codegen.mts) is keyed by what generates it, never by its bytes: the gate's own `types` step runs
// `npm run codegen` mid-run and rewrites those files, so a key that hashed them drifted between the start of the run and its record (HFS_CHECK_CACHE_UNWARMED
// on a GraphQL app). The output is a function of the tracked codegen inputs (the schema, its `.schema-sha256`, the codegen config, the lockfile), so an app
// that declares `codegen` keys its side on `codegenInputKey` instead, and a run that regenerates the same inputs keeps the key it started with. An app that
// declares no `codegen` keeps hashing such files by content: no step of the gate rewrites them, and nothing else stands for them.
import fs from 'node:fs';
import path from 'node:path';
import { combineHashes, hashFile, hashText } from './hash.mjs';
import { git } from './git.mjs';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { buildArtifacts } from '../runtime/scripts/hfs/program-artifacts.mjs';
import { codegenInputKey, codegenScript, isGeneratedOutput } from './codegen.mjs';
import type { ContentIndex } from './types.mjs';

export interface SideKey {
  readonly key: string;
  /** Every path the key covers: tracked paths of the side and the untracked program inputs. */
  readonly inputs: readonly string[];
  /** The hash each input had when the key was computed (`absent` for a missing one): the baseline `session.unchanged` compares an edit-during-the-run against. */
  readonly hashes: Readonly<Record<string, string>>;
}

/** The untracked files the side's TypeScript program (`<side>/<tsconfig>`, `tsconfig.json` by default) includes (generated code, never a build artifact), app-relative posix paths. */
export function untrackedProgramInputs(root: string, side: string, tracked: ReadonlySet<string>, tsconfigName = 'tsconfig.json'): string[] {
  const ts = loadTypescript(root);
  const tsconfig = path.join(root, side, tsconfigName);
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
    const artifacts = buildArtifacts(root, found);
    return found.filter((file) => !artifacts.has(file)).sort();
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
  // The output of a declared codegen stands in the key as its inputs (the header): never its bytes, which the run's own codegen rewrites. Without a declared
  // `codegen` nothing of the gate writes a `__generated__` file, so its bytes stay the key: whoever generated it, an edit re-runs the side.
  const codegen = codegenScript(root) !== undefined;
  const untracked = untrackedProgramInputs(root, side, new Set(index.paths)).filter((file) => !(codegen && isGeneratedOutput(file)));
  for (const file of untracked) parts[`untracked:${file}`] = hashFile(path.join(root, file)) ?? 'absent';
  if (codegen) parts['codegen'] = codegenInputKey(index);
  const hashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(parts)) if (name.startsWith('tracked:') || name.startsWith('untracked:')) hashes[name.slice(name.indexOf(':') + 1)] = hash;
  return { key: combineHashes(parts), inputs: [...trackedPaths, ...untracked], hashes };
}

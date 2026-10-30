// is-main.mjs - is this module the process entry point (`node file.mjs`, not an import)? Compared by real path.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** The real path of a file, or its resolved path when it cannot be read (a missing file is never the entry module). */
const realPathOf = (file: string): string => { try { return fs.realpathSync.native(path.resolve(file)); } catch { return path.resolve(file); } };
/**
 * True when the module at `metaUrl` is the process entry point. Both sides are compared as REAL paths: Node gives a module
 * its symlink-resolved URL, while argv[1] keeps the path it was started with, so an entry reached through a node_modules
 * junction or symlink (a lane worktree, an npx shim) would otherwise look like an import and silently do nothing.
 */
export const isMain = (metaUrl: string, argv: readonly (string | undefined)[] = process.argv): boolean => {
  const entry = argv[1];
  return Boolean(entry) && realPathOf(entry as string) === realPathOf(fileURLToPath(metaUrl));
};

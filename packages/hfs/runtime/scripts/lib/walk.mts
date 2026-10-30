// walk.mjs - filesystem walking helpers: isInside (containment) and walkFiles (depth-first file listing).
import fs from 'node:fs';
import path from 'node:path';

/** Whether `target` is `root` itself or inside it (filesystem paths, either separator). `includeSelf: false` excludes `target === root`. */
export function isInside(root: string, target: string, { includeSelf = true }: { includeSelf?: boolean } = {}): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return includeSelf;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
/** The options of walkFiles. */
export interface WalkOptions {
  filter?: (name: string, full: string) => boolean;
  sorted?: boolean;
  exclude?: (name: string, full: string, entry: fs.Dirent) => boolean;
  maxDepth?: number;
  ignoreReadErrors?: boolean;
}

/**
 * Every entry under `dir` that is not a directory, depth-first; `filter` sees the entry name and full
 * path. `sorted` sorts each directory's entries by name (default: readdir order). `exclude`
 * applies to files and directories before descent; `maxDepth` counts from the starting dir.
 */
export function walkFiles(dir: string, {filter = () => true, sorted = false, exclude = () => false,
  maxDepth = Infinity, ignoreReadErrors = false}: WalkOptions = {}): string[] {
  const out: string[] = [];
  const visit = (current: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, {withFileTypes: true}); }
    catch (error) {
      if (ignoreReadErrors) {
        return;
      }
      throw error;
    }
    if (sorted) entries = entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (exclude(entry.name, full, entry)) continue;
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (filter(entry.name, full)) out.push(full);
    }
  };
  visit(dir, 0);
  return out;
}

import fs from 'node:fs';
import path from 'node:path';

/** Folders no codemod enters: installed packages, build output and caches. */
export const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', 'out', 'coverage', '.git', 'storybook-static']);

/** The folders of an app a codemod reads source from: the `be` and `fe` sides, else `src` of a single-side app, as absolute paths. */
export function sideFolders(root: string): string[] {
  const isFolder = (folder: string): boolean => fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true;
  const sides = ['be', 'fe'].map(name => path.join(root, name)).filter(isFolder);
  if (sides.length) return sides;
  return ['src'].map(name => path.join(root, name)).filter(isFolder);
}

/** Every file under `directory` whose name matches `pattern`, sorted, without descending into generated folders. */
export function filesUnder(directory: string, pattern: RegExp): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : filesUnder(target, pattern);
    return entry.isFile() && pattern.test(entry.name) ? [target] : [];
  }).sort();
}

/** The posix path of `target` relative to `root`, the way a report names a file. */
export const relativePosix = (root: string, target: string): string => path.relative(root, target).split(path.sep).join('/');

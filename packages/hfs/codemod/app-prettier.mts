import fs from 'node:fs';
import path from 'node:path';
import { loadPrettier, type Prettier } from '../sync/format.mjs';

/** The app's own Prettier, from the first side or the root that installs one, or undefined. */
export function prettierOf(root: string, folders: readonly string[]): Prettier | undefined {
  for (const folder of [...folders, root]) {
    try { return loadPrettier(folder); } catch { /* the next folder */ }
  }
  return undefined;
}

/** `text` formatted by the app's Prettier the way `app check --format` judges it, or unchanged when the file is ignored or cannot be formatted. */
export async function formatted(prettier: Prettier, root: string, file: string, text: string): Promise<string> {
  const ignorePath = path.join(root, '.prettierignore');
  try {
    const info = await prettier.getFileInfo(file, { ignorePath: fs.existsSync(ignorePath) ? ignorePath : undefined, resolveConfig: true });
    if (info.ignored || !info.inferredParser) return text;
    const options = (await prettier.resolveConfig(file, { editorconfig: true, useCache: true })) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

// The Work boundary for readers: an app keeps workspace identity, brand records with their authored assets, and the concept records.
import fs from 'node:fs';
import path from 'node:path';
import { isLiteProductPath } from './starciwork-boundary.mjs';
import { foldCase } from './path-key.mjs';
import { WORK_DIR_NAME } from './roots.mjs';

const appTemplatesRoot = path.resolve(import.meta.dirname, '..', '..', 'packages', 'hfs', 'templates', 'app');

/** Unrendered Work seeds in this runtime's app skeletons are templates, not product records. */
export function isWorkTemplatePath(file: string): boolean {
  const [skeleton, work] = foldCase(path.relative(appTemplatesRoot, path.resolve(file))).replaceAll('\\', '/').split('/');
  return skeleton === 'skeleton' && work === WORK_DIR_NAME;
}

/** Whether this Work root belongs to an app (an hfs.json of kind app beside it). */
export function isAppWorkRoot(workRoot: string | null | undefined): boolean {
  if (!workRoot) return false;
  try {
    // reason: hfs.json is parsed from disk; only `kind` is read.
    const declaration: { kind?: unknown } | null = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(workRoot)), 'hfs.json'), 'utf8'));
    return declaration?.kind === 'app';
  } catch { return false; }
}

/** Whether a reader may open `file`: external files are unaffected; app Work paths keep workspace.yaml, brand/** and the concept records. */
export function workPathAllowed(workRoot: string | null | undefined, file: string, { dir = false }: { dir?: boolean } = {}): boolean {
  if (!isAppWorkRoot(workRoot)) return true;
  const rel = path.relative(path.resolve(workRoot as string), path.resolve(file)).replaceAll('\\', '/');
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return true;
  return !rel || isLiteProductPath(rel, { dir });
}

/** Every forbidden entry directly below an app Work root, including empty directories. Never read their contents. */
export function workForbiddenPaths(workRoot: string): string[] {
  if (!isAppWorkRoot(workRoot)) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(workRoot, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => !isLiteProductPath(entry.name, { dir: entry.isDirectory() }))
    .map(entry => path.join(workRoot, entry.name));
}

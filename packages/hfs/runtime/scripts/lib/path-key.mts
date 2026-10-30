// path-key.mjs — spelling and comparing paths the way this host's filesystem does.
import fs from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';

/** `p` with every backslash turned into a forward slash; null and undefined read as ''. */
export const slash = (p?: unknown): string => String(p ?? '').replaceAll('\\', '/');
/** `text` without its trailing '/' run (a loop: a trailing-run pattern backtracks super-linearly). */
export const trimTrailingSlashes = (text: string): string => {
  for (let end = text.length; ; end -= 1) if (end === 0 || text[end - 1] !== '/') return text.slice(0, end);
};
// A trailing '*' run with the one '/' before it (the glob suffix of 'dir/**'); text without a trailing '*' is unchanged.
const stripTrailingStars = (text: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === '*') end -= 1;
  if (end === text.length) return text;
  return text.slice(0, end > 0 && text[end - 1] === '/' ? end - 1 : end);
};
/** A relative path in git's spelling: forward slashes, no leading './'. */
export const posixPath = (p?: unknown): string => slash(p).replace(/^\.\//, '');
/** Whether posix `file` is `prefix` itself or under it (`file === prefix || file` starts with `prefix/`). */
export const sameOrUnder = (file: string, prefix: string): boolean => file === prefix || file.startsWith(`${prefix}/`);
/** `p` case-folded where the filesystem ignores case (Windows). */
export const foldCase = (p: string): string => (WIN ? p.toLowerCase() : p);
/** Whether two spellings name the same path on this host's filesystem. */
export const samePath = (a: string, b: string): boolean => foldCase(a) === foldCase(b);
/**
 * A path's comparable identity: absolute, forward slashes, no trailing slash, case-folded on Windows.
 * `fold: true` folds case on every platform (a comparison against a lowercase-stored root needs it).
 */
export const pathKey = (p: string, { fold = WIN }: { fold?: boolean } = {}): string => {
  const key = trimTrailingSlashes(slash(path.resolve(p)));
  return fold ? key.toLowerCase() : key;
};
/** `a` is `b` or under it, or the reverse: two path spellings whose trees touch. */
export const pathsOverlap = (a: string, b: string): boolean => sameOrUnder(a, b) || sameOrUnder(b, a);
/**
 * A path-ish string in compare form, options in spelling order:
 * `trim` blanks at the ends, `collapse` folds '//' runs to '/', `dot` drops a leading './',
 * `glob` strips a trailing glob ('star': '*'/'**' with their slash, 'double': a '/**' only),
 * `fold` lowercases. A trailing '/' always goes. Null reads as ''.
 * @param {string|number|null|undefined} p
 * @param {{trim?: boolean, collapse?: boolean, dot?: boolean, glob?: string|null, fold?: boolean}} [options]
 */
export const normPath = (p: string | number | null | undefined, { trim = false, collapse = false, dot = false, glob = null, fold = false }: { trim?: boolean; collapse?: boolean; dot?: boolean; glob?: string | null; fold?: boolean } = {}): string => {
  let s = p == null ? '' : String(p);
  if (trim) s = s.trim();
  s = slash(s);
  if (collapse) s = s.replace(/\/{2,}/g, '/');
  if (dot) s = s.replace(/^\.\//, '');
  if (glob === 'star') s = stripTrailingStars(s);
  else if (glob === 'double') s = s.replace(/\/\*\*$/, '');
  s = trimTrailingSlashes(s);
  return fold ? s.toLowerCase() : s;
};
/** A work-relative path in one spelling: forward slashes, no leading ./, no trailing slash. */
export const normWork = (p?: unknown): string => trimTrailingSlashes(String(p ?? '').trim().replaceAll('\\', '/').replace(/^\.\/+/, ''));

/** `p` resolved and dereferenced (realpath where the path exists) — the canonical spelling of a checkout dir. */
export const realPath = (p: string): string => {
  const resolved = path.resolve(p);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
};
/** `p` with its nearest existing ancestor dereferenced and the not-yet-created rest appended: a root's canonical spelling before it exists. */
export const canonicalPath = (p: string): string => {
  const rest: string[] = [];
  for (let at = path.resolve(p); ; at = path.dirname(at)) {
    try { return path.join(fs.realpathSync.native(at), ...rest); } catch { /* not created yet */ }
    if (path.dirname(at) === at) return path.resolve(p);
    rest.unshift(path.basename(at));
  }
};
/** `p` resolved and case-folded where the filesystem ignores case — the Map key of an absolute path. */
export const resolvedKey = (p: string): string => foldCase(path.resolve(p));
/** Whether `a` and `b` resolve to the same path (always case-folded, so differently-cased spellings count). */
export const sameResolvedPath = (a: string, b: string): boolean => pathKey(a, { fold: true }) === pathKey(b, { fold: true });
/**
 * Whether `file` sits under `root`; `includeSelf` also admits the root itself. `key` normalizes
 * both sides first (e.g. the registry's realpath-folded treeKey) when their spellings need it.
 */
export const insidePath = (root: string, file: string, { key = (p: string) => p, includeSelf = false }: { key?: (p: string) => string; includeSelf?: boolean } = {}): boolean => {
  const rel = path.relative(key(root), key(file));
  return (includeSelf || Boolean(rel)) && !rel.startsWith('..') && !path.isAbsolute(rel);
};
/**
 * `candidate` (absolute, or relative to `base`) resolved and dereferenced, required to sit under `base` (or be it):
 * the boundary check for a path an operator, an agent or another process hands in. `base` is canonicalised once and the
 * candidate is judged below it, so `..` segments and links leading out are refused; returns the canonical path, or throws
 * a PATH_OUTSIDE_BASE refusal (`label` names the argument in the message).
 */
export const containedPath = (base: string, candidate: unknown, { label = 'path' }: { label?: string } = {}): string => {
  const root = canonicalPath(base);
  const resolved = canonicalPath(path.resolve(root, String(candidate ?? '')));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!insidePath(root, resolved, { includeSelf: true }) || (resolved !== root && !resolved.startsWith(prefix))) throw Object.assign(new Error(`${label} ${String(candidate)} is outside ${root} [PATH_OUTSIDE_BASE]`), { code: 'PATH_OUTSIDE_BASE' });
  return resolved;
};
/**
 * A path-ish value (a string or a {path} entry) in relative compare form: trimmed, forward slashes,
 * no trailing '/**' glob or slashes, no leading './'; `fold` lowercases for a case-insensitive key.
 */
export const normRel = (p: string | { path?: unknown } | null | undefined, { fold = false }: { fold?: boolean } = {}): string => {
  const s = trimTrailingSlashes(String(typeof p === 'string' ? p : p?.path ?? '').trim().replaceAll('\\', '/').replace(/\/\*\*$/, '')).replace(/^\.\//, '');
  return fold ? s.toLowerCase() : s;
};
/** Whether `file` equals or sits under one of `prefixes` (posix spellings; `dot` counts a '.' prefix as covering all). */
export const underAny = (file: string, prefixes: readonly string[] | null | undefined, { dot = false }: { dot?: boolean } = {}): boolean =>
  (prefixes ?? []).some((p) => (dot && p === '.') || sameOrUnder(file, p));

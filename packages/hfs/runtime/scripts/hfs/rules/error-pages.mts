// error-pages.mts - the boundary files of a web app (`global-error.tsx`, the locale `error.tsx` and `not-found.tsx`, R53) and what they draw: the helpers
// state-pages.mts (R447) judges the route tree with. The closure follows `@/...` and relative imports inside the app and an import of a workspace
// `<project>-ui` package by the name it imports (`export const <Name>` under that package's `src/`), at most CLOSURE_DEPTH files deep, so the template's own
// chain (route file, feature page, composite) is read whole.
import path from 'node:path';
import { readText } from './read.mjs';

const CLOSURE_DEPTH = 6;
/** A boundary file of the route tree: `not-found`, `error` or `global-error` at the app root, at `[locale]` or in any route group or segment below. */
export const BOUNDARY = /^(?<app>(?:apps\/[^/]+\/)?)src\/app\/(?:[^/]+\/)*(?<name>not-found|error|global-error)\.tsx$/u;
const IMPORT = /import\s+(?:type\s+)?(?:(?<default>[A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{(?<named>[^}]*)\})?\s*from\s*['"](?<from>[^'"]+)['"]/gu;
const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];
const posix = path.posix;

/** The tracked file a specifier resolves to, or null (a package, a type-only barrel, a file outside the repository). */
export function resolveSpecifier(from: string, specifier: string, appRoot: string, tracked: ReadonlySet<string>): string | null {
  const base = specifier.startsWith('@/') ? posix.join(appRoot, 'src', specifier.slice(2)) : specifier.startsWith('.') ? posix.join(posix.dirname(from), specifier) : null;
  if (base === null) return null;
  return EXTENSIONS.map((extension) => `${base}${extension}`).find((candidate) => tracked.has(candidate)) ?? null;
}

/** The files of a workspace ui package that define `export const <name>` (the composites an app imports by name). */
function definersOf(name: string, uiFiles: readonly string[], repoRoot: string): string[] {
  const pattern = new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`, 'u');
  return uiFiles.filter((file) => pattern.test(readText(repoRoot, file) ?? ''));
}

/** Every source file reachable from a boundary file, the file itself first. */
export function closure(start: string, appRoot: string, tracked: ReadonlySet<string>, uiFiles: readonly string[], repoRoot: string): string[] {
  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let depth = 0; depth < CLOSURE_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      const text = readText(repoRoot, file) ?? '';
      for (const match of text.matchAll(IMPORT)) {
        const specifier = match.groups?.from ?? '';
        const local = resolveSpecifier(file, specifier, appRoot, tracked);
        const targets = local !== null
          ? [local]
          : specifier.startsWith('@') && !specifier.startsWith('@/') && !specifier.startsWith('@starci/') && !specifier.startsWith('@heroui/')
            ? (match.groups?.named ?? '').split(',').map((part) => part.trim().split(/\s+as\s+/u)[0] ?? '').filter((name) => /^[A-Z]/u.test(name)).flatMap((name) => definersOf(name, uiFiles, repoRoot))
            : [];
        for (const target of targets) if (!seen.has(target)) { seen.add(target); next.push(target); }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** True when the sources draw an `EmptyNotice` of page scope that carries an illustration. */
export function drawsPageEmptyState(sources: readonly string[]): boolean {
  return sources.some((text) => {
    const element = /<(?:[A-Za-z_$][\w$]*\.)?EmptyNotice\b[^]*?\/>|<(?:[A-Za-z_$][\w$]*\.)?EmptyNotice\b[^]*?<\/(?:[A-Za-z_$][\w$]*\.)?EmptyNotice>/u.exec(text)?.[0];
    return element !== undefined && /\bscope\s*=\s*["'{]+\s*page\b/u.test(element) && /\billustration\b/u.test(element);
  });
}

// error-pages.mts - R443: the error pages of a web app are the Grammar's one empty state, never hand-rolled
// (contexts/ui/components/empty-state.md "Page-level states every web app carries"). R53 requires that the three boundaries EXIST
// (`global-error.tsx`, the locale `error.tsx` and `not-found.tsx`); this rule reads what they DRAW:
//   FE_ERROR_PAGE_NOT_EMPTY_STATE   a boundary file whose reachable source (the files it imports inside the app, and the composites of the
//                                   workspace ui package it names) holds no `EmptyNotice scope="page"` with an `illustration`: the page is
//                                   hand-rolled from other components, or draws the empty state without its page scope or art.
// The closure follows `@/...` and relative imports inside the app and an import of a workspace `<project>-ui` package by the name it imports
// (`export const <Name>` under that package's `src/`), at most CLOSURE_DEPTH files deep, so the template's own chain (route file, feature page,
// composite) and an app that edits its copy or its art stay lawful; only drawing the page without the empty state is refused.
import path from 'node:path';
import { found, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const FE_ERROR_PAGE_NOT_EMPTY_STATE = 'FE_ERROR_PAGE_NOT_EMPTY_STATE';
const CLOSURE_DEPTH = 6;
const BOUNDARY = /^(?<app>(?:apps\/[^/]+\/)?)src\/app\/(?:\[locale\]\/)?(?<name>not-found|error|global-error)\.tsx$/u;
const IMPORT = /import\s+(?:type\s+)?(?:(?<default>[A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{(?<named>[^}]*)\})?\s*from\s*['"](?<from>[^'"]+)['"]/gu;
const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];
const posix = path.posix;

/** The tracked file a specifier resolves to, or null (a package, a type-only barrel, a file outside the repository). */
function resolveSpecifier(from: string, specifier: string, appRoot: string, tracked: ReadonlySet<string>): string | null {
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
function closure(start: string, appRoot: string, tracked: ReadonlySet<string>, uiFiles: readonly string[], repoRoot: string): string[] {
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

/** FE_ERROR_PAGE_NOT_EMPTY_STATE over the boundary files of a front end's web apps. */
export function errorPageFindings({ files = [], repo, repoRoot, isRoot = false, inScope = () => true }: { files?: readonly string[]; repo: Repo; repoRoot: string; isRoot?: boolean; inScope?: (file: string) => boolean }): Finding[] {
  if (isRoot || repo?.profile !== 'fe' || !['lite', 'full'].includes(repo.edition ?? 'full')) return [];
  const tracked = new Set(files.map((file) => file.replaceAll('\\', '/')));
  const uiFiles = [...tracked].filter((file) => /^packages\/[^/]+-ui\/src\/.+\.tsx$/u.test(file));
  const findings: Finding[] = [];
  for (const file of [...tracked].sort()) {
    const match = BOUNDARY.exec(file);
    if (match === null || !inScope(file)) continue;
    const appRoot = (match.groups?.app ?? '').replace(/\/$/u, '');
    const sources = closure(file, appRoot, tracked, uiFiles, repoRoot).map((member) => readText(repoRoot, member) ?? '');
    if (!drawsPageEmptyState(sources)) {
      findings.push(found(FE_ERROR_PAGE_NOT_EMPTY_STATE, file, `${file} (${match.groups?.name ?? 'boundary'}) draws no EmptyNotice scope="page" with an illustration: the not-found, error and global-error pages are the Grammar's one empty state (an illustration, the title and description, "Back to the home page" and, on a failure, a retry), never hand-rolled (R443, contexts/ui/components/empty-state.md)`));
    }
  }
  return findings;
}

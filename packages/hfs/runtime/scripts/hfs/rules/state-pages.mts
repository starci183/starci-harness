// state-pages.mts - R447: ONE PAGE PER SYSTEM STATE. A web app draws each system state (not found, error, offline) with one shared page
// component, and every route group carries its own boundary wired to it, so the marketing site and the console of one app never fall
// through to a different look (contexts/ui/components/empty-state.md "Page-level states every web app carries", contexts/code/fe/ui.md FE-STATE-PAGES).
// R443 (error-pages.mts) judges that a boundary draws the Grammar's empty state; this rule judges that all of them draw the SAME component, from the route tree:
//   FE_STATE_PAGE_NOT_SHARED    two boundaries of one kind reach different page components. A boundary's page component is the file of its reachable
//                               source (the closure R443 reads) that draws the `EmptyNotice scope="page"`; the kinds are not-found (every `not-found.tsx`),
//                               error (every `error.tsx` AND `global-error.tsx`) and offline (every `offline/page.tsx` or `~offline/page.tsx`).
//                               The boundaries of one kind in the whole front end must name one page component: the deviating file is reported.
//   FE_STATE_PAGE_GROUP_MISSING a route group (a `(name)` folder of the app tree that holds a page or a layout below it) has no `error.tsx` or no
//                               `not-found.tsx` of its own, so a failure or an unknown address inside it would use another group's look.
import path from 'node:path';
import { found, readText } from './read.mjs';
import { BOUNDARY, closure, drawsPageEmptyState } from './error-pages.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const FE_STATE_PAGE_NOT_SHARED = 'FE_STATE_PAGE_NOT_SHARED';
export const FE_STATE_PAGE_GROUP_MISSING = 'FE_STATE_PAGE_GROUP_MISSING';
const RULE = '(R447, contexts/code/fe/ui.md FE-STATE-PAGES)';
/** An offline page of the route tree: `offline/page.tsx` or the PWA-style `~offline/page.tsx`, at any depth. */
const OFFLINE = /^(?<app>(?:apps\/[^/]+\/)?)src\/app\/(?:[^/]+\/)*~?offline\/page\.tsx$/u;
/** A file of the app tree, split into its app and the path below `src/app/`. */
const APP_TREE = /^(?<app>(?:apps\/[^/]+\/)?)src\/app\/(?<rest>.+)$/u;
const GROUP_SEGMENT = /^\([A-Za-z0-9_-]+\)$/u;
const ROUTE_CONTENT = /^(?:.+\/)?(?:page|layout)\.tsx$/u;

type Kind = 'not-found' | 'error' | 'offline';

/** The kind a route file is a boundary of, or null. `global-error` is the error kind: the last-resort page is the error page, not a fourth look. */
export function kindOf(file: string): Kind | null {
  if (OFFLINE.test(file)) return 'offline';
  const name = BOUNDARY.exec(file)?.groups?.['name'];
  return name === 'not-found' ? 'not-found' : name === undefined ? null : 'error';
}

/** The page component of a boundary: the files of its closure that draw the page empty state, else every file it reaches besides itself. */
export function pageComponentOf(file: string, appRoot: string, tracked: ReadonlySet<string>, uiFiles: readonly string[], repoRoot: string): string[] {
  const reached = closure(file, appRoot, tracked, uiFiles, repoRoot);
  const drawing = reached.filter((member) => drawsPageEmptyState([readText(repoRoot, member) ?? '']));
  return (drawing.length > 0 ? drawing : reached.filter((member) => member !== file)).sort();
}

/** The most common signature of a kind (ties: the first by code unit), and the boundaries that differ from it. */
function deviants(signatures: ReadonlyMap<string, string>): { shared: string; files: string[] } {
  const counts = new Map<string, number>();
  for (const signature of signatures.values()) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  const shared = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
  return { shared, files: [...signatures.entries()].filter(([, signature]) => signature !== shared).map(([file]) => file).sort() };
}

const label = (signature: string): string => (signature === '' ? 'no page component' : signature.split('\n').join(' + '));

/** Route groups of the app tree (every `(name)` segment, at any depth) with what they hold: `content` (a page or layout at or below), `error`, `not-found`. */
function groupsOf(tracked: ReadonlySet<string>): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const file of tracked) {
    const root = APP_TREE.exec(file);
    if (root?.groups === undefined) continue;
    const segments = (root.groups['rest'] ?? '').split('/');
    segments.forEach((segment, index) => {
      if (!GROUP_SEGMENT.test(segment)) return;
      const base = `${root.groups?.['app'] ?? ''}src/app/${segments.slice(0, index + 1).join('/')}`;
      const below = segments.slice(index + 1).join('/');
      const own = groups.get(base) ?? new Set<string>();
      groups.set(base, own);
      if (ROUTE_CONTENT.test(below)) own.add('content');
      if (below === 'error.tsx') own.add('error');
      if (below === 'not-found.tsx') own.add('not-found');
    });
  }
  return groups;
}

/** FE_STATE_PAGE_NOT_SHARED and FE_STATE_PAGE_GROUP_MISSING over the route tree of a front end's web apps. */
export function statePageFindings({ files = [], repo, repoRoot, isRoot = false, inScope = () => true }: { files?: readonly string[]; repo: Repo; repoRoot: string; isRoot?: boolean; inScope?: (file: string) => boolean }): Finding[] {
  if (isRoot || repo?.profile !== 'fe' || !['lite', 'full'].includes(repo.edition ?? 'full')) return [];
  const tracked = new Set(files.map((file) => file.replaceAll('\\', '/')));
  const uiFiles = [...tracked].filter((file) => /^packages\/[^/]+-ui\/src\/.+\.tsx$/u.test(file));
  const findings: Finding[] = [];
  const kinds = new Map<Kind, Map<string, string>>();
  for (const file of [...tracked].sort()) {
    const kind = kindOf(file);
    if (kind === null) continue;
    const appRoot = (BOUNDARY.exec(file)?.groups?.['app'] ?? OFFLINE.exec(file)?.groups?.['app'] ?? '').replace(/\/$/u, '');
    const signatures = kinds.get(kind) ?? new Map<string, string>();
    kinds.set(kind, signatures);
    signatures.set(file, pageComponentOf(file, appRoot, tracked, uiFiles, repoRoot).join('\n'));
  }
  for (const [kind, signatures] of kinds) {
    if (signatures.size < 2) continue;
    const { shared, files: apart } = deviants(signatures);
    for (const file of apart.filter((candidate) => inScope(candidate))) {
      findings.push(found(FE_STATE_PAGE_NOT_SHARED, file, `${file} draws the ${kind} page with ${label(signatures.get(file) ?? '')}, where the other ${kind} boundaries of the front end draw ${label(shared)}: every ${kind === 'error' ? 'error.tsx and global-error.tsx' : kind === 'offline' ? 'offline page' : 'not-found.tsx'} renders the one shared page component of its kind, so no route group or app shows another look; wire it to that component ${RULE}`, { kind }));
    }
  }
  for (const [group, has] of [...groupsOf(tracked)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!has.has('content')) continue;
    for (const name of ['error', 'not-found'] as const) {
      const file = `${group}/${name}.tsx`;
      if (!has.has(name) && inScope(file)) findings.push(found(FE_STATE_PAGE_GROUP_MISSING, file, `the route group ${path.posix.basename(group)} (${group}/) has no ${name}.tsx of its own: every route group wires its own ${name}.tsx to the shared ${name === 'error' ? 'error' : 'not-found'} page component, so a ${name === 'error' ? 'failure' : 'unknown address'} inside it never falls through to another look ${RULE}`, { group }));
    }
  }
  return findings;
}

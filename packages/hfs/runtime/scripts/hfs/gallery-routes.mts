// gallery-routes.mts - the routes of an app's front end and the gallery screens that cover them (R395, contexts/project/gallery.md PROJECT-GALLERY-4, PROJECT-GALLERY-5).
// A user-facing route is a Next app router `page.tsx` under `fe/apps/<app>/src/app` (slot fe.route). The route pattern of a page is its folder
// path with the structure stripped: the first `[locale]` segment (the i18n prefix), route groups `(console)`, and nothing else; a dynamic segment (`[id]`, `[...rest]`,
// `[[...rest]]`) stays, written `[id]`. A parallel slot (`@modal`), an intercepting route (`(.)photo`) and a private folder (`_parts`) own no screen of their own and are skipped.
// Two front-end apps can serve the same path (a landing and the product both serve `/`), so a route is KEYED by its app: `<app>:<path key>`. A screen names its app with the optional `app` of its
// screen.yaml; without it the app whose route tree serves the route is the screen's, else the single front-end app; two apps serving the route and no `app` is ambiguous (resolveScreenRoute).
// Matching an explain.md `route` to a page route compares KEYS: the locale prefix goes, a trailing slash goes, every dynamic segment (`[id]`, `:id`, `{id}`, `<id>`) is one
// wildcard, case is ignored, so `/workspaces/:id/agents` and `/workspaces/[workspaceId]/agents` are one screen.
// A screen's sources, for the change coupling: the route's `page.tsx` and every file under the feature folders (`features/pages/<Name>/`) that `page.tsx` imports; that
// mapping is best effort (a component imported by a feature from `components/` is not followed).
import fs from 'node:fs';
import path from 'node:path';

const posix = path.posix;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);
const DYNAMIC = /^(?:\[\[?\.{3}[^\]]+\]\]?|\[[^\]]+\]|:[^/]+|\{[^}]+\}|<[^>]+>)$/u;
const LOCALE = /^(?:\[locale\]|:locale|\{locale\}|<locale>)$/u;

/** One user-facing route of the front end. */
export interface FeRoute {
  /** The pattern shown in messages: `/workspaces/[workspaceId]/agents`. */
  route: string;
  /** The comparison key: `<app>:<path key>` (`routeKey` of `route` and `app`). */
  key: string;
  /** The path key alone (`routePathKey` of `route`): what two apps serving one path share. */
  pathKey: string;
  /** The `page.tsx`, app-root relative. */
  file: string;
  /** The front-end app folder name (`web`). */
  app: string;
  /** The files that draw the screen: the page and the feature folders it imports, as app-root relative prefixes (a folder ends with `/`). */
  sources: string[];
}

/** The comparison key of a route pattern without its app: no query or hash, no locale prefix, no trailing slash, one wildcard per dynamic segment, lower case. */
export function routePathKey(route: string): string {
  const clean = route.trim().replace(/[?#].*$/u, '');
  const segments = clean.split('/').filter((segment) => segment !== '');
  if (segments.length > 0 && LOCALE.test(segments[0] as string)) segments.shift();
  return `/${segments.map((segment) => (DYNAMIC.test(segment) ? '*' : segment.toLowerCase())).join('/')}`;
}

/** The comparison key of a route: the path key, prefixed `<app>:` when the app is given. */
export const routeKey = (route: string, app?: string): string => (app === undefined ? routePathKey(route) : `${app}:${routePathKey(route)}`);

/** The route of a page folder path relative to `src/app` (`[locale]/(console)/agents/[agentKey]`), or null when the folder owns no screen of its own. */
export function pageRoute(folder: string): string | null {
  const segments = folder.split('/').filter((segment) => segment !== '');
  const kept: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.startsWith('@') || segment.startsWith('_') || /^\(\.{1,3}\)/u.test(segment)) return null;
    if (index === 0 && LOCALE.test(segment)) continue;
    if (/^\([^)]*\)$/u.test(segment)) continue;
    kept.push(segment);
  }
  return `/${kept.join('/')}`;
}

/** The feature folders (`features/pages/<Name>/`) a page imports, as paths relative to the app's `src/`. */
export function importedFeatures(pageText: string): string[] {
  const found = new Set<string>();
  for (const match of pageText.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)) {
    const hit = /(?:^|\/)features\/(pages|layouts|overlays)\/([^/'"]+)/u.exec(match[1] as string);
    if (hit !== null && hit[1] === 'pages') found.add(`features/pages/${hit[2] as string}/`);
  }
  return [...found];
}

/** The directory entries of `dir`, sorted; empty when it is unreadable. */
function list(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
}

/** Every `page.tsx` folder under `dir`, relative to it. */
function pageFolders(dir: string, at = ''): string[] {
  const here = list(dir);
  const own = here.some((entry) => entry.isFile() && entry.name === 'page.tsx') ? [at] : [];
  return [...own, ...here.filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name)).flatMap((entry) => pageFolders(path.join(dir, entry.name), at === '' ? entry.name : `${at}/${entry.name}`))];
}

/** The front-end app folders of the repository, `fe/apps/<app>`, that carry a `src/app` route tree. */
export function feAppFolders(repoRoot: string): string[] {
  return list(path.join(repoRoot, 'fe', 'apps')).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repoRoot, 'fe', 'apps', entry.name, 'src', 'app'))).map((entry) => `fe/apps/${entry.name}`);
}

/** The user-facing routes of the front end (one per `page.tsx`), read from the work tree; empty for an app with no front end. */
export function feRoutes(repoRoot: string): FeRoute[] {
  const routes: FeRoute[] = [];
  for (const appDir of feAppFolders(repoRoot)) {
    const appRoot = path.join(repoRoot, ...appDir.split('/'), 'src', 'app');
    for (const folder of pageFolders(appRoot)) {
      const route = pageRoute(folder);
      if (route === null) continue;
      const file = posix.join(appDir, 'src', 'app', folder, 'page.tsx');
      let text = '';
      try { text = fs.readFileSync(path.join(repoRoot, ...file.split('/')), 'utf8'); } catch { text = ''; }
      // The not-found catch-all (`[locale]/[...rest]/page.tsx` calling notFound()) renders the not-found page, which is its own screen: it is no route of the product.
      if (folder.split('/').pop()?.startsWith('[...') === true && text.includes('notFound(')) continue;
      routes.push({ route, key: routeKey(route, posix.basename(appDir)), pathKey: routePathKey(route), file, app: posix.basename(appDir), sources: [file, ...importedFeatures(text).map((feature) => posix.join(appDir, 'src', feature))] });
    }
  }
  return routes;
}

/** What `resolveScreenRoute` answers for one screen. */
export interface ScreenRoute {
  /** The key of the route the screen shows, `<app>:<path key>`; null when it names no route or two apps serve it with no `app`. */
  key: string | null;
  /** The app the screen belongs to, when it is known. */
  app: string | null;
  /** The apps that all serve the route when the screen names none of them (then `key` is null). */
  ambiguous: string[];
}

/**
 * The route of one screen, keyed by its app: the screen's own `app` first, else the app whose route tree serves the route, else (no app serves it) the single front-end app. Two or more apps
 * serving the route with no `app` given is `ambiguous`, never a guess. A screen with no `route` has no key.
 */
export function resolveScreenRoute(routes: readonly FeRoute[], meta: Readonly<Record<string, string>>): ScreenRoute {
  const route = meta['route'] ?? '';
  if (route === '') return { key: null, app: null, ambiguous: [] };
  const named = meta['app'];
  if (named !== undefined && named !== '') return { key: routeKey(route, named), app: named, ambiguous: [] };
  const path = routePathKey(route);
  const serving = [...new Set(routes.filter((entry) => entry.pathKey === path).map((entry) => entry.app))];
  if (serving.length === 1) return { key: routeKey(route, serving[0] as string), app: serving[0] as string, ambiguous: [] };
  if (serving.length > 1) return { key: null, app: null, ambiguous: serving };
  const apps = [...new Set(routes.map((entry) => entry.app))];
  return apps.length === 1 ? { key: routeKey(route, apps[0] as string), app: apps[0] as string, ambiguous: [] } : { key: null, app: null, ambiguous: [] };
}

/** Whether `file` (app-root relative) is one of the sources of `route`. */
export const isSourceOf = (route: FeRoute, file: string): boolean => route.sources.some((source) => (source.endsWith('/') ? file.startsWith(source) : file === source));

/** One declared exclusion of `gallery/routes.json`: a route that has no screen, and why. */
export interface RouteExclusion { route: string; reason: string; /** The one app it applies to; absent: every app that serves the route. */ app?: string }

/** The keys of the routes an exclusion list covers: an entry with an `app` its one route, an entry without every app's route of that path. */
export function excludedKeys(exclusions: readonly RouteExclusion[], routes: readonly FeRoute[]): Set<string> {
  return new Set(exclusions.flatMap((entry) => (entry.app === undefined ? routes.filter((route) => route.pathKey === routePathKey(entry.route)).map((route) => route.key) : [routeKey(entry.route, entry.app)])));
}

/** The exclusions that cover no route of the front end. */
export function staleExclusions(exclusions: readonly RouteExclusion[], routes: readonly FeRoute[]): RouteExclusion[] {
  const real = new Set(routes.map((route) => route.key));
  return exclusions.filter((entry) => (entry.app === undefined ? !routes.some((route) => route.pathKey === routePathKey(entry.route)) : !real.has(routeKey(entry.route, entry.app))));
}

/**
 * The exclusions of `gallery/routes.json` text: `{ "exclude": [{ "route": "/dev/flow-canvas", "reason": "a developer tool, not a product screen" }] }`. `null` text is an absent
 * file (no exclusions). `problem` is set when the file is not JSON or an entry lacks a text `route` or a non-empty `reason`.
 */
export function routeExclusions(text: string | null): { exclusions: RouteExclusion[]; problem: string | null } {
  if (text === null) return { exclusions: [], problem: null };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { exclusions: [], problem: 'is not JSON' }; }
  const list = typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>)['exclude'] : undefined;
  if (!Array.isArray(list)) return { exclusions: [], problem: 'is an object { "exclude": [{ "route": "/path", "reason": "why it has no screen" }] }' };
  const ok = list.every((entry) => typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>)['route'] === 'string' && (entry as { route: string }).route.trim() !== '' && typeof (entry as Record<string, unknown>)['reason'] === 'string' && (entry as { reason: string }).reason.trim() !== '');
  if (!ok) return { exclusions: [], problem: 'has an exclusion without a text "route" or a non-empty "reason": every excluded route says why it has no screen' };
  return { exclusions: (list as RouteExclusion[]).map((entry) => ({ route: entry.route.trim(), reason: entry.reason.trim(), ...(typeof entry.app === 'string' && entry.app.trim() !== '' ? { app: entry.app.trim() } : {}) })), problem: null };
}

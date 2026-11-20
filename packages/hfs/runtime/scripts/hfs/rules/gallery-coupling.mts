// gallery-coupling.mts - also HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED (PROJECT-GALLERY-7, below: a screen source change without a fresh approved canvas page, same judged set); HFS_APP_GALLERY_EXPLAIN_STALE (R395, contexts/project/gallery.md PROJECT-GALLERY-5): a change to the source of a screen (the route's `page.tsx` and the feature
// folders it imports, gallery-routes.mts) that does not touch that screen's `gallery/pages/<area>/<screen>/explain.md` leaves the explanation behind the screen. The judged set is
// the files a change touches: the commits since the base, the index and the work tree (`changedSince`, run by `starci app check`), or the staged files (`stagedFiles`, the commit guard of
// sync/hygiene.mts, which only reports). A route that has several screen folders (a state or an agent variant is its own folder) is current when any of its explain.md files is touched;
// a route that has none is the coverage's (HFS_APP_GALLERY_ROUTE_MISSING) and an excluded route (gallery/routes.json) has no screen to keep current. The finding is `local`:

import { runGit } from '../../api/git/lib.mjs';
import { galleryParams } from '../gallery.mjs';
import { screenSource } from '../screen-yaml.mjs';
import { excludedKeys, feRoutes, isSourceOf, resolveScreenRoute, routeExclusions } from '../gallery-routes.mjs';
import { galleryScreens } from './gallery.mjs';
import { DESIGN_FILE, isApproved, parseDesign, pendingScreens } from './gallery-design.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed } from './rule-types.mjs';

export const EXPLAIN_STALE = 'HFS_APP_GALLERY_EXPLAIN_STALE';

/**
 * The stale-explanation findings for the app-root relative files `changed` (a deleted file counts as touched): one per route whose source changed while none of its screens'
 * explain.md did. Empty for a repository that is not an app, has no front end or has no gallery pages.
 */
export function galleryStaleFindings({ repoRoot, changed, manifest }: { repoRoot: string; changed: readonly string[]; manifest?: Parsed }) {
  const declaration = readJson(repoRoot, 'hfs.json');
  if (declaration?.kind !== 'app' || changed.length === 0) return [];
  const params = galleryParams(manifest);
  const touched = new Set(changed.map((file) => file.replaceAll('\\', '/')));
  const exclusions = routeExclusions(readText(repoRoot, `${params.dir}/routes.json`));
  const routes = feRoutes(repoRoot);
  const excluded = excludedKeys(exclusions.exclusions, routes);
  const explainsOf = new Map<string, string[]>();
  for (const { area, screen } of galleryScreens(repoRoot, params).screens) {
    const folder = `${params.pages}/${area}/${screen}`;
    const source = screenSource(folder, (rel) => readText(repoRoot, rel));
    // a screen is keyed by its app: its own `app`, else the app whose route tree serves the route; two apps and no `app` is the ambiguity finding of the gallery rule, never a guess here
    const key = source === null ? null : resolveScreenRoute(routes, source.explanation.meta).key;
    if (source !== null && key !== null) explainsOf.set(key, [...(explainsOf.get(key) ?? []), source.file]);
  }
  const findings = [];
  for (const route of routes) {
    const explains = explainsOf.get(route.key);
    if (explains === undefined || excluded.has(route.key)) continue;
    const edited = [...touched].filter((file) => isSourceOf(route, file));
    if (edited.length === 0 || explains.some((file) => touched.has(file))) continue;
    findings.push(found(EXPLAIN_STALE, edited[0] as string, `the screen of ${route.route} changed (${edited.slice(0, 3).join(', ')}${edited.length > 3 ? `, and ${edited.length - 3} more` : ''}) and ${explains[0] as string} did not: update the explanation (and the shots) with the screen, or say in the commit nothing visible changed by touching the explain.md; a warning in --env local, an error in --env prod (PROJECT-GALLERY-5)`, { local: true }));
  }
  return findings;
}

/** The files the commits since `base`, the index and the work tree change (a deleted one included); empty when there is no base (a root commit has no earlier screen to keep current). */
export function changedSince(repoRoot: string, base: string | null): string[] {
  if (base === null) return [];
  const run = runGit(['diff', '--name-only', '--no-renames', '-z', base], { dir: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return run.error || run.status !== 0 ? [] : String(run.stdout ?? '').split('\0').filter(Boolean);
}

export const DESIGN_CHANGE_UNAPPROVED = 'HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED';

/** The newest time (ms) a commit in `base..HEAD` touched `file`; null when no commit of the range did. */
function newestCommitTime(repoRoot: string, base: string, file: string): number | null {
  const run = runGit(['log', '-1', '--format=%cI', `${base}..HEAD`, '--', file], { dir: repoRoot });
  const stamp = run.error || run.status !== 0 ? '' : String(run.stdout ?? '').trim();
  const time = stamp === '' ? Number.NaN : Date.parse(stamp);
  return Number.isNaN(time) ? null : time;
}

/** The design.json text of `base`, or null when the base has none. */
function designAtBase(repoRoot: string, base: string): string | null {
  const run = runGit(['show', `${base}:${DESIGN_FILE}`], { dir: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return run.error || run.status !== 0 ? null : String(run.stdout ?? '');
}

/**
 * HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED (PROJECT-GALLERY-7): a change to a screen's source (the same screen to source map as the stale-explanation finding) whose design.json page
 * is missing, only `drafted`, or approved before the change. Only a canvas-managed screen is judged: its area is in `areas` or one of its pages is in `pages`, so an app with no
 * canvas is never flagged. `base` is the judged range's base (`HEAD` for the staged guard); a source file's change time is the newest commit of `base..HEAD` that touched it, and
 * `now` for a change not yet committed (the index and the work tree). A screen the manifest marks `pending` (not buildable yet, with its reason) is skipped. A change passes when the page is approved and either `approvedAt` is not earlier than that time or the
 * page's entry in design.json differs from the base's (the same change records the approval, or the lane's build with its shots). `local`, as the stale-explanation finding.
 */
export function galleryDesignChangeFindings({ repoRoot, changed, base, manifest, now = Date.now() }: { repoRoot: string; changed: readonly string[]; base: string | null; manifest?: Parsed; now?: number }) {
  if (base === null || changed.length === 0 || readJson(repoRoot, 'hfs.json')?.kind !== 'app') return [];
  const text = readText(repoRoot, DESIGN_FILE);
  const design = text === null ? null : parseDesign(text).manifest;
  if (design === null) return [];
  const params = galleryParams(manifest);
  const managed = new Set([...design.areas, ...Object.keys(design.pages).map((id) => id.split('/')[0] ?? '')]);
  const touched = new Set(changed.map((file) => file.replaceAll('\\', '/')));
  const routes = feRoutes(repoRoot);
  const excluded = excludedKeys(routeExclusions(readText(repoRoot, `${params.dir}/routes.json`)).exclusions, routes);
  const idsOf = new Map<string, string[]>();
  for (const { area, screen } of galleryScreens(repoRoot, params).screens) {
    const key = resolveScreenRoute(routes, screenSource(`${params.pages}/${area}/${screen}`, (rel) => readText(repoRoot, rel))?.explanation.meta ?? {}).key;
    if (key !== null && managed.has(area)) idsOf.set(key, [...(idsOf.get(key) ?? []), `${area}/${screen}`]);
  }
  const pending = pendingScreens(repoRoot);
  const uncommitted = new Set(changedSince(repoRoot, 'HEAD'));
  const baseText = designAtBase(repoRoot, base);
  const baseDesign = baseText === null ? null : parseDesign(baseText).manifest;
  const findings = [];
  for (const route of routes) {
    const ids = idsOf.get(route.key);
    if (ids === undefined || excluded.has(route.key)) continue;
    const edited = [...touched].filter((file) => isSourceOf(route, file));
    if (edited.length === 0) continue;
    const changedAt = Math.max(...edited.map((file) => (uncommitted.has(file) ? now : (newestCommitTime(repoRoot, base, file) ?? now))));
    const problems: string[] = [];
    for (const id of ids) {
      if (pending.has(id)) continue;
      const page = design.pages[id];
      if (page === undefined) problems.push(`${id} has no design entry`);
      else if (!isApproved(page.status)) problems.push(`${id} is only ${page.status}`);
      else if (JSON.stringify(baseDesign?.pages[id]) !== JSON.stringify(page)) continue;
      else if (Date.parse(page.approvedAt ?? '') < changedAt) problems.push(`${id} was approved at ${page.approvedAt}, before the change at ${new Date(changedAt).toISOString()}`);
    }
    if (problems.length === 0) continue;
    findings.push(found(DESIGN_CHANGE_UNAPPROVED, edited[0] as string, `the screen of ${route.route} changed (${edited.slice(0, 3).join(', ')}${edited.length > 3 ? `, and ${edited.length - 3} more` : ''}) without an approved canvas page: ${problems.join('; ')}. Draw the change on the canvas (/claude-design), have the owner approve it in ${DESIGN_FILE}, then code it; a warning in --env local, an error in --env prod (PROJECT-GALLERY-7)`, { local: true }));
  }
  return findings;
}

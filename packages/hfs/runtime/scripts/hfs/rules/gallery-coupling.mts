// gallery-coupling.mts - HFS_APP_GALLERY_EXPLAIN_STALE (R395, contexts/project/gallery.md PROJECT-GALLERY-5): a change to the source of a screen (the route's `page.tsx` and the feature
// folders it imports, gallery-routes.mts) that does not touch that screen's `gallery/pages/<area>/<screen>/explain.md` leaves the explanation behind the screen. The judged set is
// the files a change touches: the commits since the base, the index and the work tree (`changedSince`, run by `starci app check`), or the staged files (`stagedFiles`, the commit guard of
// sync/hygiene.mts, which only reports). A route that has several screen folders (a state or an agent variant is its own folder) is current when any of its explain.md files is touched;
// a route that has none is the coverage's (HFS_APP_GALLERY_ROUTE_MISSING) and an excluded route (gallery/routes.json) has no screen to keep current. The finding is `local`:
// report-only in `--env local`, an error in `--env prod` (the code is localOnly in the failure catalog).
import { runGit } from '../../api/git/lib.mjs';
import { galleryParams } from '../gallery.mjs';
import { parseExplain } from '../gallery-explain.mjs';
import { feRoutes, isSourceOf, routeExclusions, routeKey } from '../gallery-routes.mjs';
import { galleryScreens } from './gallery.mjs';
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
  const excluded = new Set(exclusions.exclusions.map((entry) => routeKey(entry.route)));
  const explainsOf = new Map<string, string[]>();
  for (const { area, screen } of galleryScreens(repoRoot, params).screens) {
    const file = `${params.pages}/${area}/${screen}/explain.md`;
    const route = parseExplain(readText(repoRoot, file) ?? '').meta['route'] ?? '';
    if (route !== '') explainsOf.set(routeKey(route), [...(explainsOf.get(routeKey(route)) ?? []), file]);
  }
  const findings = [];
  for (const route of feRoutes(repoRoot)) {
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

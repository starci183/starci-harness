// uiaudit-family.mts - the UI Audit gate of `starci app check` (`--gate uiaudit`, contexts/project/gallery.md PROJECT-GALLERY-8): every gallery screen the diff touches since the base carries a
// passed audit in its screen.yaml. Diff-only by construction: a screen the diff does not touch (its source, or its own audited screen.yaml) is grandfathered and never read, so the
// gate costs the touched screens alone and stores no record (a record per touched screen would only be churn in every lane's committed cache). A screen is touched when
//   - its route's source changed (the page and the feature folders it imports, the same mapping as HFS_APP_GALLERY_EXPLAIN_STALE), or
//   - a file its route's page reaches through imports changed (a shared composite, a hook, a module, a workspace package, an imported catalog: screen-reach.mts, the
//     app's own TypeScript resolving under the front-end app's tsconfig, bounded and memoised), or
//   - its screen.yaml changed and already holds an audit (the audit is being edited, so it is judged).
// The codes (all `local` findings: report-only in `--env local`, errors in `--env prod`): UI_AUDIT_MISSING, _INVALID, _STALE, _SELF_REVIEW, _ROUNDS_FEW, _OPEN, _NEEDS_OWNER, _CONSIDERED_EMPTY.
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import { galleryParams } from '../runtime/scripts/hfs/gallery.mjs';
import { feRoutes, isSourceOf, routeKey, type FeRoute } from '../runtime/scripts/hfs/gallery-routes.mjs';
import { galleryScreens } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { pendingScreens } from '../runtime/scripts/hfs/rules/gallery-design.mjs';
import { found, readText } from '../runtime/scripts/hfs/rules/read.mjs';
import { judgeAudit, SCREEN_FILE, screenSource, shotsOnDisk } from '../runtime/scripts/hfs/screen-yaml.mjs';
import { makeReport } from './report.mjs';
import { screenReacher } from './screen-reach.mjs';
import type { CheckSession, FamilyReport } from './types.mjs';

export interface UiAuditResult { readonly findings: CheckFinding[]; readonly lines: string[]; readonly report: FamilyReport }

/** The screens `changed` (app-root relative files since the base) touches, judged against their audits. `base` null (no base) judges nothing. */
export function uiAuditFindings({ repoRoot, changed, base }: { repoRoot: string; changed: readonly string[]; base: string | null }): { findings: CheckFinding[]; touched: string[]; grandfathered: number; pending?: string[]; capped?: string[] } {
  const findings: CheckFinding[] = [];
  const touched: string[] = [];
  if (base === null || changed.length === 0) return { findings, touched, grandfathered: 0 };
  let params;
  try { params = galleryParams(); } catch { return { findings, touched, grandfathered: 0 }; }
  const { screens } = galleryScreens(repoRoot, params);
  const changedSet = new Set(changed.map((file) => file.replaceAll('\\', '/')));
  const routes = new Map<string, FeRoute>(feRoutes(repoRoot).map((route) => [route.key, route]));
  let grandfathered = 0;
  const pendingOf = pendingScreens(repoRoot);
  const skipped: string[] = [];
  const reachOf = screenReacher(repoRoot);
  const capped = new Set<string>();
  // a changed file the route reaches: only code and catalogs can change what a screen renders, so a diff of none of them walks nothing
  const reachable = [...changedSet].filter((file) => /\.(?:[cm]?[jt]sx?|json)$/u.test(file) && !file.startsWith(`${params.dir}/`));
  const reaches = (feRoute: FeRoute): boolean => {
    if (reachable.length === 0) return false;
    const reach = reachOf(feRoute);
    if (reach.capped) capped.add(feRoute.route);
    return reachable.some((file) => reach.files.has(file));
  };
  for (const { area, screen } of screens) {
    const id = `${area}/${screen}`;
    // a screen design.json marks pending (approved, not buildable yet) has no audit to require: it is listed, never read
    if (pendingOf.has(id)) { skipped.push(id); continue; }
    const folder = `${params.pages}/${id}`;
    const yamlFile = `${folder}/${SCREEN_FILE}`;
    const source = screenSource(folder, (rel) => readText(repoRoot, rel));
    const route = source?.explanation.meta['route'] ?? '';
    const feRoute = route === '' ? undefined : routes.get(routeKey(route));
    const sourceChanged = feRoute !== undefined && ([...changedSet].some((file) => isSourceOf(feRoute, file)) || reaches(feRoute));
    const yamlChanged = changedSet.has(yamlFile);
    const audited = source?.kind === 'yaml' && source.value !== null && source.value['audit'] !== null && source.value['audit'] !== undefined;
    if (!sourceChanged && !(yamlChanged && audited)) { grandfathered += 1; continue; }
    touched.push(id);
    const textChanged = [...changedSet].some((file) => file.startsWith(`${folder}/`) && file !== yamlFile);
    const facts = { id, value: source?.kind === 'yaml' ? source.value : null, disk: shotsOnDisk(repoRoot, folder), unrecorded: (sourceChanged || textChanged) && !yamlChanged };
    for (const finding of judgeAudit(facts)) findings.push(found(finding.code, yamlFile, finding.message, { local: true }) as CheckFinding);
  }
  return { findings, touched, grandfathered, pending: skipped, capped: [...capped] };
}

/** The UI audit step: judge the touched screens, report as a family. */
export function runUiAuditFamily(session: CheckSession, { repoRoot, changed, base }: { repoRoot: string; changed: readonly string[]; base: string | null }): UiAuditResult {
  const judged = uiAuditFindings({ repoRoot, changed, base });
  const report = makeReport({
    family: 'uiaudit', mode: 'diff', reason: 'judges only the screens the diff touches since the base; nothing is stored', checked: judged.touched.length, reused: judged.grandfathered, previous: [],
    current: judged.findings.map((finding) => ({ path: String(finding.path), line: 0, column: 0, rule: String(finding.code), message: String(finding.message) })),
  });
  session.report(report);
  const lines = [`  ui audit: ${judged.touched.length} touched screen(s) judged${judged.touched.length === 0 ? '' : ` (${judged.touched.join(', ')})`}, ${judged.grandfathered} unchanged screen(s) grandfathered${(judged.pending ?? []).length === 0 ? '' : `, ${(judged.pending ?? []).length} pending screen(s) skipped (${(judged.pending ?? []).join(', ')})`}${base === null ? ' (no base to diff against)' : ''}${(judged.capped ?? []).length === 0 ? '' : `; the import walk of ${(judged.capped ?? []).join(', ')} stopped at its cap`}`];
  return { findings: judged.findings, lines, report };
}


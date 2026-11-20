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
import { feRoutes, isSourceOf, resolveScreenRoute, type FeRoute } from '../runtime/scripts/hfs/gallery-routes.mjs';
import { galleryScreens } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { pendingScreens } from '../runtime/scripts/hfs/rules/gallery-design.mjs';
import { found, readText } from '../runtime/scripts/hfs/rules/read.mjs';
import { createSlotResolver, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { judgeAudit, SCREEN_FILE, screenSource, shotsOnDisk } from '../runtime/scripts/hfs/screen-yaml.mjs';
import { makeReport } from './report.mjs';
import { screenReacher, typescriptOf } from './screen-reach.mjs';
import { changedSymbols, type SymbolDiff } from './symbol-diff.mjs';
import { git } from './git.mjs';
import { catalogDiff, readsChanged, usageOf, type CatalogDiff, type Usage } from './catalog-reach.mjs';
import type { CheckSession, FamilyReport } from './types.mjs';

export interface UiAuditResult { readonly findings: CheckFinding[]; readonly lines: string[]; readonly report: FamilyReport }

/** Whether a file (app-root relative) can change what a screen renders: false when the slot that owns it is `renders: false` in the manifest; an app whose declaration cannot be read counts every file. */
function slotsOf(repoRoot: string): (file: string) => { renders: boolean; slot: string | null } {
  try {
    const manifest = loadSlotManifest();
    const resolver = createSlotResolver(manifest, readRepoDeclaration(manifest, repoRoot));
    return (file) => {
      const slot = resolver.slotOf(file) as { id?: string; renders?: boolean } | null | undefined;
      return { renders: slot?.renders !== false, slot: slot?.id ?? null };
    };
  } catch { return () => ({ renders: true, slot: null }); }
}

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
  // a file of a slot the manifest marks `renders: false` (data-fetching hooks, transport, a client of a service, the app configuration) cannot change what a screen renders: the walk passes through it, a change to it marks nothing
  const slotOf = slotsOf(repoRoot);
  // a reached module that is no barrel counts only for the names the screen takes from it that changed since the base (symbol-diff.mts); a side-effect import, a module the diff cannot read and a new one count whole
  const diffs = new Map<string, SymbolDiff>();
  const baseResolves = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${base as string}^{commit}`]).ok;
  const diffOf = (ts: NonNullable<ReturnType<typeof typescriptOf>>, file: string): SymbolDiff => {
    let known = diffs.get(file);
    if (known === undefined) {
      const before = git(repoRoot, ['show', `${base as string}:${file}`]);
      // a base text that cannot be read for a base that resolves is a file the base did not have; with no resolvable base nothing can be compared, so the file counts whole
      known = baseResolves ? changedSymbols(ts, file, before.ok ? before.stdout : null, readText(repoRoot, file)) : { all: true, names: new Set<string>() };
      diffs.set(file, known);
    }
    return known;
  };
  const catalogDiffs = new Map<string, CatalogDiff>();
  const usages = new Map<string, Usage>();
  const catalogAffects = (ts: NonNullable<ReturnType<typeof typescriptOf>>, catalog: string, reached: ReadonlySet<string>): boolean => {
    let diff = catalogDiffs.get(catalog);
    if (diff === undefined) {
      const before = git(repoRoot, ['show', `${base as string}:${catalog}`]);
      diff = baseResolves ? catalogDiff(before.ok ? before.stdout : null, readText(repoRoot, catalog)) : { all: true, keys: new Set<string>() };
      catalogDiffs.set(catalog, diff);
    }
    if (diff.all) return true;
    for (const file of reached) {
      if (!/\.[cm]?tsx?$/u.test(file)) continue;
      let usage = usages.get(file);
      if (usage === undefined) { usage = usageOf(ts, file, readText(repoRoot, file) ?? ''); usages.set(file, usage); }
      if (readsChanged(usage, diff)) return true;
    }
    return false;
  };
  const reaches = (feRoute: FeRoute): string[] => {
    if (reachable.length === 0) return [];
    const reach = reachOf(feRoute);
    if (reach.capped) capped.add(feRoute.route);
    const ts = typescriptOf(repoRoot, feRoute.file.split('/').slice(0, 3).join('/'));
    return reachable.filter((file) => {
      if (!reach.files.has(file) || !slotOf(file).renders) return false;
      // an i18n catalog counts only for a screen whose reached sources read a key that changed (catalog-reach.mts)
      if (ts !== null && /\.json$/u.test(file) && slotOf(file).slot === 'fe.modules.i18n') return catalogAffects(ts, file, reach.files);
      const taken = reach.demand.get(file);
      if (taken === undefined || taken === null || ts === null) return true;
      const diff = diffOf(ts, file);
      return diff.all || taken.some((name) => diff.names.has(name));
    });
  };
  for (const { area, screen } of screens) {
    const id = `${area}/${screen}`;
    // a screen design.json marks pending (approved, not buildable yet) has no audit to require: it is listed, never read
    if (pendingOf.has(id)) { skipped.push(id); continue; }
    const folder = `${params.pages}/${id}`;
    const yamlFile = `${folder}/${SCREEN_FILE}`;
    const source = screenSource(folder, (rel) => readText(repoRoot, rel));
    const resolved = resolveScreenRoute([...routes.values()], source?.explanation.meta ?? {});
    const feRoute = resolved.key === null ? undefined : routes.get(resolved.key);
    const own = feRoute === undefined ? [] : [...changedSet].filter((file) => isSourceOf(feRoute, file));
    const reached = feRoute === undefined ? [] : reaches(feRoute).filter((file) => !own.includes(file));
    const causes = [...own, ...reached];
    const sourceChanged = causes.length > 0;
    const yamlChanged = changedSet.has(yamlFile);
    const audited = source?.kind === 'yaml' && source.value !== null && source.value['audit'] !== null && source.value['audit'] !== undefined;
    if (!sourceChanged && !(yamlChanged && audited)) { grandfathered += 1; continue; }
    touched.push(id);
    const textChanged = [...changedSet].some((file) => file.startsWith(`${folder}/`) && file !== yamlFile);
    const facts = { id, value: source?.kind === 'yaml' ? source.value : null, disk: shotsOnDisk(repoRoot, folder), unrecorded: (sourceChanged || textChanged) && !yamlChanged, changed: causes };
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


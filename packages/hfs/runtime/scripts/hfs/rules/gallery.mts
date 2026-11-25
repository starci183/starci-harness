// gallery.mts - R395: every app source repository carries the screenshot gallery (contexts/project/gallery.md PROJECT-GALLERY-1, PROJECT-GALLERY-2). The files are managed
// (`starci app sync` renders them, slot app.gallery); this rule judges the facts the gallery stands on, with the values of `ruleParams.gallery`:
//   HFS_APP_GALLERY_MISSING        the gallery folder, or one of its managed files, is absent: run `starci app sync --execute`;
// and the explanation every page carries (`<pages>/<area>/<screen>/explain.md`, read from the work tree because the shots are never tracked):
//   HFS_APP_GALLERY_EXPLAIN_MISSING    a page folder has shots and no explain.md;
//   HFS_APP_GALLERY_FRONT_MATTER       the explain.md front matter lacks `title`, `route` or `area`, or names another area than its folder (a warning);
//   HFS_APP_GALLERY_SCREEN_FILE        a screen folder holds a file or folder other than 1440.png, 390.png, explain.md and links.json (a state or an agent is its own folder);
//   HFS_APP_GALLERY_LINKS              a links.json, the flows.json or the routes.json is malformed or names a screen folder or a route that does not exist;
// and the coverage of the front end (PROJECT-GALLERY-4), judged from the explain.md files alone (the shots are local evidence):
//   HFS_APP_GALLERY_ROUTE_MISSING      a `page.tsx` route of the front end has no screen folder whose explain.md `route` matches it and is not excluded in gallery/routes.json:
//                                       blocks in `--env prod`, reported in `--env local` (the code is localOnly);
// and the design pass drawn before code (PROJECT-GALLERY-6, rules/gallery-design.mts): HFS_APP_GALLERY_DESIGN_MANIFEST, _PAGE_MISSING, _SHOT_MISSING, _SHOT_STALE;
// and the design board of the app (PROJECT-GALLERY-9, rules/gallery-board.mts): HFS_APP_GALLERY_BOARD_INVALID, _ROUTE_MISSING, _SECTION_UNMAPPED.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { declaredBasePort, galleryParams, galleryPort } from '../gallery.mjs';
import type { GalleryParams } from '../gallery.mjs';
import { flowList, linkTargets, missingFrontMatter, SHOT_FILES } from '../gallery-explain.mjs';
import { excludedKeys, feRoutes, resolveScreenRoute, routeExclusions, staleExclusions, type FeRoute } from '../gallery-routes.mjs';
import { boardFindings } from './gallery-board.mjs';
import { designFindings } from './gallery-design.mjs';
import { parseScreen, screenSource, SCREEN_FILE } from '../screen-yaml.mjs';
import { CROP_FILES } from '../shot-crops.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { found, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

/** The files the gallery is made of, gallery-relative: the managed ones (slot app.gallery). */
export const GALLERY_FILES = Object.freeze(['package.json', 'index.html', 'README.md', 'vite.config.js']);
const posix = path.posix;

/** The state shots (`empty-1440.png`) a screen.yaml lists under `shots`: the one extra a screen folder may hold (PROJECT-GALLERY-8). */
function stateShotNames(dir: string): Set<string> {
  try {
    const doc = parseYaml(fs.readFileSync(path.join(dir, SCREEN_FILE), 'utf8')) as { shots?: unknown } | null;
    return new Set(plain(doc?.shots) ? Object.keys(doc?.shots as object).filter((key) => /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:1440|390)$/u.test(key)).map((key) => `${key}.png`) : []);
  } catch { return new Set(); }
}

/** One screen folder, `pages/<area>/<screen>/`, as the work tree holds it. */
export interface GalleryScreen {
  area: string;
  screen: string;
  /** Shot PNGs found. */
  shots: number;
  /** Entries the layout does not allow: a file name outside the three widths, explain.md and links.json, or any folder. */
  stray: string[];
}

/**
 * The screen folders under the pages folder, `<area>/<screen>`, read from the work tree (the shots are never tracked). A screen folder holds only `1440.png`, `390.png`,
 * `explain.md` and `links.json` (and the full-resolution crops `starci audit run` writes beside the shots, `<width>-first.png` and `<width>-header.png`): anything else (`1440-open.png`, `sales-1440.png`, a folder such as `before/`) is stray, since a state or an agent is its own folder.
 * A file straight in the pages folder or in an area folder is loose (it belongs in a screen folder). Dot files are ignored.
 */
export function galleryScreens(repoRoot: string, params: GalleryParams): { screens: GalleryScreen[]; loose: string[] } {
  const list = (dir: string): fs.Dirent[] => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
  };
  const root = path.join(repoRoot, ...params.pages.split('/'));
  const screens: GalleryScreen[] = [];
  const loose: string[] = [];
  const allowed = new Set([...SHOT_FILES, ...CROP_FILES, 'explain.md', SCREEN_FILE, 'links.json']);
  for (const top of list(root)) {
    if (!top.isDirectory()) { loose.push(top.name); continue; }
    for (const entry of list(path.join(root, top.name))) {
      if (!entry.isDirectory()) { loose.push(`${top.name}/${entry.name}`); continue; }
      const dir = path.join(root, top.name, entry.name);
      const screen: GalleryScreen = { area: top.name, screen: entry.name, shots: 0, stray: [] };
      const stateShots = stateShotNames(dir);
      for (const item of list(dir)) {
        if (item.isFile() && (allowed.has(item.name) || stateShots.has(item.name))) {
          if (item.name.endsWith('.png')) screen.shots++;
        } else screen.stray.push(`${item.name}${item.isDirectory() ? '/' : ''}`);
      }
      screens.push(screen);
    }
  }
  return { screens, loose };
}

/** Region names for a message: the first six quoted, then how many more. */
const named = (regions: readonly string[]): string => `${regions.slice(0, 6).map((name) => `"${name}"`).join(', ')}${regions.length > 6 ? `, and ${regions.length - 6} more` : ''}`;

/** The parsed JSON of a file, `absent` when the file does not exist, `invalid` when it is not JSON. */
function jsonOf(repoRoot: string, file: string): { kind: 'absent' } | { kind: 'invalid' } | { kind: 'ok'; value: unknown } {
  const text = readText(repoRoot, file);
  if (text === null) return { kind: 'absent' };
  try { return { kind: 'ok', value: JSON.parse(text) as unknown }; } catch { return { kind: 'invalid' }; }
}

/** The ids in `ids` that name no screen, as one message fragment. */
const dangling = (ids: readonly string[], known: ReadonlySet<string>): string[] => [...new Set(ids.filter((id) => !known.has(id)))];

/** The comparison keys (`<app>:<path>`) of the routes the screens declare (`route` and optional `app` of screen.yaml), and the screens whose route two apps both serve with no `app` (`ambiguous`: screen file and the apps). */
export function declaredRouteKeys(repoRoot: string, params: GalleryParams, screens: readonly GalleryScreen[], routes: readonly FeRoute[] = feRoutes(repoRoot)): Set<string> {
  return screenRouteKeys(repoRoot, params, screens, routes).keys;
}

export function screenRouteKeys(repoRoot: string, params: GalleryParams, screens: readonly GalleryScreen[], routes: readonly FeRoute[]): { keys: Set<string>; ambiguous: Array<{ id: string; file: string; apps: string[]; route: string }> } {
  const keys = new Set<string>();
  const ambiguous: Array<{ id: string; file: string; apps: string[]; route: string }> = [];
  for (const { area, screen } of screens) {
    const source = screenSource(`${params.pages}/${area}/${screen}`, (rel) => readText(repoRoot, rel));
    const resolved = resolveScreenRoute(routes, source?.explanation.meta ?? {});
    if (resolved.key !== null) keys.add(resolved.key);
    if (resolved.ambiguous.length > 0 && source !== null) ambiguous.push({ id: `${area}/${screen}`, file: source.file, apps: resolved.ambiguous, route: source.explanation.meta['route'] ?? '' });
  }
  return { keys, ambiguous };
}

/**
 * Findings of the coverage (PROJECT-GALLERY-4): every `page.tsx` route of the front end has a screen folder whose explain.md `route` matches it, or a reasoned exclusion in
 * `gallery/routes.json`. A missing screen is HFS_APP_GALLERY_ROUTE_MISSING (`local`: report-only in `--env local`, an error in `--env prod`); an unreadable `routes.json`
 * and an exclusion of a route the front end does not have are HFS_APP_GALLERY_LINKS.
 */
function routeFindings(repoRoot: string, params: GalleryParams, screens: readonly GalleryScreen[]) {
  const routes = feRoutes(repoRoot);
  if (routes.length === 0) return [];
  const findings = [];
  const file = `${params.dir}/routes.json`;
  const { exclusions, problem } = routeExclusions(readText(repoRoot, file));
  if (problem !== null) findings.push(found('HFS_APP_GALLERY_LINKS', file, `${file} ${problem} (PROJECT-GALLERY-4)`));
  const stale = staleExclusions(exclusions, routes);
  if (stale.length > 0) findings.push(found('HFS_APP_GALLERY_LINKS', file, `${file} excludes ${named(stale.map((entry) => entry.route))}, which ${stale.length === 1 ? 'is' : 'are'} no route of the front end: drop the entr${stale.length === 1 ? 'y' : 'ies'} (PROJECT-GALLERY-4)`));
  const excluded = excludedKeys(exclusions, routes);
  const { keys: covered, ambiguous } = screenRouteKeys(repoRoot, params, screens, routes);
  for (const entry of ambiguous) findings.push(found('HFS_APP_GALLERY_ROUTE_AMBIGUOUS', entry.file, `the screen ${entry.id} shows ${entry.route}, which the apps ${entry.apps.join(' and ')} both serve: set \`app\` in its screen.yaml to the one it shows (PROJECT-GALLERY-4)`, { local: true }));
  for (const route of routes) {
    if (covered.has(route.key) || excluded.has(route.key)) continue;
    findings.push(found('HFS_APP_GALLERY_ROUTE_MISSING', route.file, `the route ${route.route} of ${route.app} has no screen in ${params.pages}/: add ${params.pages}/<area>/<screen>/explain.md whose front matter \`route\` is ${route.route}, or declare the route in ${file} with a reason (a developer-only route); a warning in --env local, an error in --env prod (PROJECT-GALLERY-4)`, { local: true }));
  }
  return findings;
}

/**
 * Findings of the pages (PROJECT-GALLERY-2): the layout of every screen folder, a screen.yaml or explain.md beside any shot with its front matter, the targets of every links.json and of flows.json.
 */
function explainFindings(repoRoot: string, params: GalleryParams, inScope: (file: string) => boolean) {
  const findings = [];
  const { screens, loose } = galleryScreens(repoRoot, params);
  const known = new Set(screens.map((entry) => `${entry.area}/${entry.screen}`));
  const missingScreens = (list: string[]): string => `${named(list)}, which ${list.length === 1 ? 'is not a screen folder' : 'are not screen folders'} of ${params.pages}/`;
  for (const name of loose) {
    const file = `${params.pages}/${name}`;
    if (inScope(file)) findings.push(found('HFS_APP_GALLERY_SCREEN_FILE', file, `${file} sits outside a screen folder: a file belongs in ${params.pages}/<area>/<screen>/ (PROJECT-GALLERY-2)`));
  }
  for (const { area, screen, shots, stray } of screens) {
    const folder = `${params.pages}/${area}/${screen}`;
    const file = `${folder}/explain.md`;
    if (!inScope(file) && !inScope(`${folder}/${SCREEN_FILE}`)) continue;
    if (stray.length > 0) findings.push(found('HFS_APP_GALLERY_SCREEN_FILE', folder, `${folder} holds ${stray.map((name) => `"${name}"`).join(', ')}: a screen folder holds only ${[...SHOT_FILES, SCREEN_FILE, 'links.json'].join(', ')} (and the state shots its screen.yaml lists) and no folder; a state or an agent variant is its own screen folder (PROJECT-GALLERY-2)`));
    const links = jsonOf(repoRoot, `${folder}/links.json`);
    if (links.kind === 'invalid') findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json is not JSON (PROJECT-GALLERY-2)`));
    else if (links.kind === 'ok') {
      const targets = linkTargets(links.value);
      if (targets === null) findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json is a list (or { "links": [...] }) of { "to": "<area>/<screen>", "x", "y", "w", "h" } hotspots; an entry has no text "to" (PROJECT-GALLERY-2)`));
      else if (dangling(targets, known).length > 0) findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json points at ${missingScreens(dangling(targets, known))} (PROJECT-GALLERY-2)`));
    }
    const source = screenSource(folder, (rel) => readText(repoRoot, rel));
    if (source === null) {
      if (shots > 0) findings.push(found('HFS_APP_GALLERY_EXPLAIN_MISSING', `${folder}/${SCREEN_FILE}`, `the screen ${area}/${screen} has ${shots} shot${shots === 1 ? '' : 's'} and no ${SCREEN_FILE}: write ${folder}/${SCREEN_FILE} (title, route, area, summary, code, shots, sections, considered, audit); `+'`starci gallery migrate-explain`'+` turns an explain.md into it (PROJECT-GALLERY-8)`));
      continue;
    }
    if (source.kind === 'yaml') {
      if (readText(repoRoot, file) !== null) findings.push(found('HFS_APP_GALLERY_SCREEN_FILE', file, `${folder} holds both ${SCREEN_FILE} and explain.md: ${SCREEN_FILE} replaces explain.md, delete it (PROJECT-GALLERY-8)`));
      const parsed = parseScreen(readText(repoRoot, source.file) ?? '', `${area}/${screen}`);
      // the one UI-audit requirement left (owner, 2026-11-21): the screen.yaml is well formed, its audit block included; what the audit found is evidence, not a finding
      const invalid = parsed.parseError !== null ? [parsed.parseError] : [...parsed.doc, ...parsed.audit];
      if (invalid.length > 0) findings.push(found('HFS_APP_GALLERY_SCREEN_INVALID', source.file, `${source.file} ${invalid.slice(0, 6).join('; ')}${invalid.length > 6 ? `; and ${invalid.length - 6} more` : ''} (PROJECT-GALLERY-8)`));
    }
    const explanation = source.explanation;
    const lacking = missingFrontMatter(explanation);
    const declared = explanation.meta['area'] ?? '';
    const problems = [...(lacking.length > 0 ? [`the front matter lacks ${lacking.join(', ')}`] : []), ...(declared !== '' && declared !== area ? [`its area "${declared}" is not the folder's "${area}"`] : [])];
    if (problems.length > 0) findings.push(found('HFS_APP_GALLERY_FRONT_MATTER', source.file, `${file}: ${problems.join('; ')} (PROJECT-GALLERY-2)`, { level: 'warning' }));
  }
  const flowsFile = `${params.dir}/flows.json`;
  if (inScope(flowsFile)) {
    const flows = jsonOf(repoRoot, flowsFile);
    if (flows.kind === 'invalid') findings.push(found('HFS_APP_GALLERY_LINKS', flowsFile, `${flowsFile} is not JSON (PROJECT-GALLERY-2)`));
    else if (flows.kind === 'ok') {
      const list = flowList(flows.value);
      if (list === null) findings.push(found('HFS_APP_GALLERY_LINKS', flowsFile, `${flowsFile} is an object { "<flow name>": ["<area>/<screen>", ...] } (or a list of { "name", "screens" }) of ordered screen ids (PROJECT-GALLERY-2)`));
      else if (dangling(list.flatMap((flow) => flow.screens), known).length > 0) findings.push(found('HFS_APP_GALLERY_LINKS', flowsFile, `${flowsFile} names ${missingScreens(dangling(list.flatMap((flow) => flow.screens), known))} (PROJECT-GALLERY-2)`));
    }
  }
  return findings;
}

/** Findings of R395 at the app root. */
export function appGalleryFindings({ repoRoot, repo, isRoot, inScope = () => true, manifest }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[]; inScope?: (file: string) => boolean; manifest?: Parsed }) {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const params = galleryParams(manifest);
  const at = (file: string) => posix.join(params.dir, file);
  const stack = findStackDeclaration(repoRoot);
  const base = stack.doc ? declaredBasePort(stack.doc) : null;
  const port = galleryPort(base, params);
  const findings = [];
  const missing = GALLERY_FILES.filter((file) => readText(repoRoot, at(file)) === null);
  if (missing.length > 0) {
    const how = base === null ? 'declare environments.dev.local.basePort in .starcistacks/application-stacks.yaml (R389), then run `starci app sync --execute`' : `run \`starci app sync --execute\` (it renders the gallery on port ${port})`;
    findings.push(found('HFS_APP_GALLERY_MISSING', `${params.dir}/`, `the app has no screenshot gallery (missing ${missing.map(at).join(', ')}): every app source repository carries ${params.dir}/, a Vite app that shows ${params.pages}/<area>/<page>/ (the shots and the explain.md of each page, PROJECT-GALLERY-1, PROJECT-GALLERY-2); ${how}`));
  }
  findings.push(...explainFindings(repoRoot, params, inScope));
  // No gallery at all is one finding (HFS_APP_GALLERY_MISSING), not one per route.
  if (missing.length < GALLERY_FILES.length) {
    const { screens } = galleryScreens(repoRoot, params);
    findings.push(...routeFindings(repoRoot, params, screens), ...designFindings(repoRoot, params, screens), ...boardFindings(repoRoot, params));
  }
  return findings;
}

// gallery.mts - R395: every app source repository carries the screenshot gallery (contexts/project/gallery.md PROJECT-GALLERY-1, PROJECT-GALLERY-2). The files are managed
// (`starci app sync` renders them, slot app.gallery); this rule judges the facts the gallery stands on, with the values of `ruleParams.gallery`:
//   HFS_APP_GALLERY_MISSING        the gallery folder, or one of its managed files, is absent: run `starci app sync --execute`;
//   HFS_APP_GALLERY_SCRIPT         package.json has no dev script that serves on the app's base port + `portOffset` with --strictPort (or the app declares
//                                   no `local.basePort` to derive it from);
//   HFS_APP_GALLERY_VITE_UNPINNED  vite is absent from package.json or not an exact version;
//   HFS_APP_GALLERY_SHOTS_TRACKED  the shot PNGs are not git-ignored, or some are tracked;
// and the explanation every page carries (`<pages>/<area>/<screen>/explain.md`, read from the work tree because the shots are never tracked):
//   HFS_APP_GALLERY_EXPLAIN_MISSING    a page folder has shots and no explain.md;
//   HFS_APP_GALLERY_REGION_INCOMPLETE  the explain.md has no region, or a region lacks a `Vì sao` or a `Grammar` value;
//   HFS_APP_GALLERY_REGION_UNCLEAR     a region says `CHƯA RÕ` or `SAI` (a bug its author has not fixed): blocks in `--env prod`, reported in `--env local` (the code is localOnly);
//   HFS_APP_GALLERY_FRONT_MATTER       the explain.md front matter lacks `title`, `route` or `area`, or names another area than its folder (a warning);
//   HFS_APP_GALLERY_SCREEN_FILE        a screen folder holds a file or folder other than 1440.png, 1920.png, 390.png, explain.md and links.json (a state or an agent is its own folder);
//   HFS_APP_GALLERY_LINKS              a links.json or the flows.json is malformed or names a screen folder that does not exist.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { declaredBasePort, galleryParams, galleryPort } from '../gallery.mjs';
import type { GalleryParams } from '../gallery.mjs';
import { flowList, linkTargets, missingFrontMatter, parseExplain, SHOT_FILES } from '../gallery-explain.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

/** The files the gallery is made of, gallery-relative: the managed ones (slot app.gallery). */
export const GALLERY_FILES = Object.freeze(['package.json', 'index.html', 'README.md', 'vite.config.js', 'src/main.js', 'src/explain.js', 'src/style.css']);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const posix = path.posix;

/** The gitignore lines of a file: comments, blanks and negations dropped. */
const ignoreLines = (text: string | null): string[] => (text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));

/** The lines that ignore every PNG under the pages folder, in a gitignore at the app root or (nested) in the gallery folder's own. */
function ignoringLines(params: GalleryParams, nested: boolean): Set<string> {
  const rooted = [params.ignoredShots, '**/*.png', '*.png'];
  const lines = !nested
    ? [...rooted.filter((line) => line.startsWith('**/') || line.startsWith('*.')), ...rooted.filter((line) => !line.startsWith('**/') && !line.startsWith('*.')).map((line) => `${params.dir}/${line}`), `${params.dir}/**/*.png`]
    : rooted;
  return new Set(lines.flatMap((line) => [line, `/${line}`]));
}

/** True when a gitignore at the app root or in the gallery folder ignores the shot PNGs. */
export function ignoresShots(text: string | null, params: GalleryParams, nested: boolean): boolean {
  const accepted = ignoringLines(params, nested);
  return ignoreLines(text).some((line) => accepted.has(line));
}

/** The problem of a package.json dev script, or null when it serves on `expected` with --strictPort (any port when none is expected). */
function scriptProblem(script: unknown, expected: number | null, params: GalleryParams): string | null {
  if (typeof script !== 'string' || script.trim() === '') return `package.json declares no "${params.devScript}" script: it must be \`vite --port <base + ${params.portOffset}> --strictPort\``;
  const port = /--port[ =](\d+)/u.exec(script)?.[1];
  if (port === undefined) return `the "${params.devScript}" script (${script}) names no --port: it must serve on the app's base port + ${params.portOffset}`;
  if (!/--strictPort\b/u.test(script)) return `the "${params.devScript}" script (${script}) lacks --strictPort: a taken port must fail, never move the gallery off base + ${params.portOffset}`;
  if (expected !== null && Number(port) !== expected) return `the "${params.devScript}" script serves on ${port}, not ${expected} (local.basePort + ${params.portOffset})`;
  return null;
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
 * The screen folders under the pages folder, `<area>/<screen>`, read from the work tree (the shots are never tracked). A screen folder holds only `1440.png`, `1920.png`, `390.png`,
 * `explain.md` and `links.json`: anything else (`1440-open.png`, `sales-1440.png`, a folder such as `before/`) is stray, since a state or an agent is its own folder.
 * A file straight in the pages folder or in an area folder is loose (it belongs in a screen folder). Dot files are ignored.
 */
export function galleryScreens(repoRoot: string, params: GalleryParams): { screens: GalleryScreen[]; loose: string[] } {
  const list = (dir: string): fs.Dirent[] => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
  };
  const root = path.join(repoRoot, ...params.pages.split('/'));
  const screens: GalleryScreen[] = [];
  const loose: string[] = [];
  const allowed = new Set([...SHOT_FILES, 'explain.md', 'links.json']);
  for (const top of list(root)) {
    if (!top.isDirectory()) { loose.push(top.name); continue; }
    for (const entry of list(path.join(root, top.name))) {
      if (!entry.isDirectory()) { loose.push(`${top.name}/${entry.name}`); continue; }
      const dir = path.join(root, top.name, entry.name);
      const screen: GalleryScreen = { area: top.name, screen: entry.name, shots: 0, stray: [] };
      for (const item of list(dir)) {
        if (item.isFile() && allowed.has(item.name)) {
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

/**
 * Findings of the pages (PROJECT-GALLERY-2): the layout of every screen folder, an explain.md beside any shot with its front matter, a `Vì sao` and a `Grammar` in every region and no
 * CHƯA RÕ or SAI left, the targets of every links.json and of flows.json.
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
    if (!inScope(file)) continue;
    if (stray.length > 0) findings.push(found('HFS_APP_GALLERY_SCREEN_FILE', folder, `${folder} holds ${stray.map((name) => `"${name}"`).join(', ')}: a screen folder holds only ${[...SHOT_FILES, 'explain.md', 'links.json'].join(', ')} and no folder; a state or an agent variant is its own screen folder (PROJECT-GALLERY-2)`));
    const links = jsonOf(repoRoot, `${folder}/links.json`);
    if (links.kind === 'invalid') findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json is not JSON (PROJECT-GALLERY-2)`));
    else if (links.kind === 'ok') {
      const targets = linkTargets(links.value);
      if (targets === null) findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json is a list (or { "links": [...] }) of { "to": "<area>/<screen>", "x", "y", "w", "h" } hotspots; an entry has no text "to" (PROJECT-GALLERY-2)`));
      else if (dangling(targets, known).length > 0) findings.push(found('HFS_APP_GALLERY_LINKS', `${folder}/links.json`, `${folder}/links.json points at ${missingScreens(dangling(targets, known))} (PROJECT-GALLERY-2)`));
    }
    const text = readText(repoRoot, file);
    if (text === null) {
      if (shots > 0) findings.push(found('HFS_APP_GALLERY_EXPLAIN_MISSING', file, `the screen ${area}/${screen} has ${shots} shot${shots === 1 ? '' : 's'} and no explain.md: write ${file} with a front matter (title, route, area) and one "## <region name>" per region, each with the lines "Vì sao:", "Luật:" and "Grammar:" (PROJECT-GALLERY-2)`));
      continue;
    }
    const explanation = parseExplain(text);
    const lacking = missingFrontMatter(explanation);
    const declared = explanation.meta['area'] ?? '';
    const problems = [...(lacking.length > 0 ? [`the front matter lacks ${lacking.join(', ')}`] : []), ...(declared !== '' && declared !== area ? [`its area "${declared}" is not the folder's "${area}"`] : [])];
    if (problems.length > 0) findings.push(found('HFS_APP_GALLERY_FRONT_MATTER', file, `${file}: ${problems.join('; ')} (PROJECT-GALLERY-2)`, { level: 'warning' }));
    if (explanation.regions.length === 0) {
      findings.push(found('HFS_APP_GALLERY_REGION_INCOMPLETE', file, `${file} has no "## <region name>": every region of the screen needs one, with "Vì sao:", "Luật:" and "Grammar:" lines (PROJECT-GALLERY-2)`));
      continue;
    }
    const incomplete = explanation.regions.filter((region) => region.problems.some((problem) => problem.kind === 'missing'));
    if (incomplete.length > 0) {
      const detail = incomplete.map((region) => `${region.name} lacks ${region.problems.filter((problem) => problem.kind === 'missing').map((problem) => problem.field).join(' and ')}`);
      findings.push(found('HFS_APP_GALLERY_REGION_INCOMPLETE', file, `${incomplete.length} region${incomplete.length === 1 ? '' : 's'} of ${file} lack${incomplete.length === 1 ? 's' : ''} a value: ${detail.slice(0, 6).join('; ')}${detail.length > 6 ? `; and ${detail.length - 6} more` : ''}. A region that cannot be explained with a law and a Grammar reference is a bug: fix the screen, then write the explanation (PROJECT-GALLERY-2)`));
    }
    const unclear = explanation.regions.filter((region) => region.problems.some((problem) => problem.kind === 'unclear'));
    if (unclear.length > 0) findings.push(found('HFS_APP_GALLERY_REGION_UNCLEAR', file, `${unclear.length} region${unclear.length === 1 ? '' : 's'} of ${file} say CHƯA RÕ or SAI (${named(unclear.map((region) => region.name))}): the region is a bug, fix the screen and rewrite the line; a warning in --env local, an error in --env prod (PROJECT-GALLERY-2)`, { local: true }));
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
export function appGalleryFindings({ repoRoot, repo, isRoot, all = [], inScope = () => true, manifest }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[]; inScope?: (file: string) => boolean; manifest?: Parsed }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((value) => value === repo.edition) || isRoot === false) return [];
  const params = galleryParams(manifest);
  const at = (file: string) => posix.join(params.dir, file);
  const manifestFile = at('package.json');
  const stack = findStackDeclaration(repoRoot);
  const base = stack.doc ? declaredBasePort(stack.doc) : null;
  const port = galleryPort(base, params);
  const findings = [];
  const missing = GALLERY_FILES.filter((file) => readText(repoRoot, at(file)) === null);
  if (missing.length > 0) {
    const how = base === null ? 'declare environments.dev.local.basePort in .starcistacks/application-stacks.yaml (R389), then run `starci app sync --execute`' : `run \`starci app sync --execute\` (it renders the gallery on port ${port})`;
    findings.push(found('HFS_APP_GALLERY_MISSING', `${params.dir}/`, `the app has no screenshot gallery (missing ${missing.map(at).join(', ')}): every app source repository carries ${params.dir}/, a Vite app that shows ${params.pages}/<area>/<page>/ (the shots and the explain.md of each page, PROJECT-GALLERY-1, PROJECT-GALLERY-2); ${how}`));
  }
  const manifestJson = readJson(repoRoot, manifestFile);
  if (manifestJson !== null && inScope(manifestFile)) {
    const scripts = plain(manifestJson.scripts) ? (manifestJson.scripts as Record<string, unknown>) : {};
    const problem = scriptProblem(scripts[params.devScript], port, params);
    if (problem !== null) findings.push(found('HFS_APP_GALLERY_SCRIPT', manifestFile, `${problem} (PROJECT-GALLERY-1; \`starci app sync --execute\` restores the managed file)`));
    else if (port === null) findings.push(found('HFS_APP_GALLERY_SCRIPT', manifestFile, `the app declares no local.basePort, so the gallery port (base + ${params.portOffset}) cannot be judged: declare environments.dev.local.basePort (R389, PROJECT-GALLERY-1)`));
    const vite = [manifestJson.devDependencies, manifestJson.dependencies].map((block) => (plain(block) ? (block as Record<string, unknown>)['vite'] : undefined)).find((version) => version !== undefined);
    if (typeof vite !== 'string' || !EXACT_VERSION.test(vite)) findings.push(found('HFS_APP_GALLERY_VITE_UNPINNED', manifestFile, `vite is ${typeof vite === 'string' ? `"${vite}", not an exact version` : 'not a devDependency'}: pin it exactly (e.g. "${params.vite}"), as every dependency of an app is pinned (PROJECT-GALLERY-1)`));
  }
  if (missing.length < GALLERY_FILES.length) {
    const ignored = ignoresShots(readText(repoRoot, '.gitignore'), params, false) || ignoresShots(readText(repoRoot, at('.gitignore')), params, true);
    if (!ignored) findings.push(found('HFS_APP_GALLERY_SHOTS_TRACKED', '.gitignore', `${params.pages}/**/*.png is not git-ignored: the screenshots are local evidence, never source; ignore them with \`${params.dir}/${params.ignoredShots}\` (the managed root .gitignore block of \`starci app sync --execute\` carries it)`));
  }
  const tracked = all.filter((file) => file.startsWith(`${params.pages}/`) && file.toLowerCase().endsWith('.png'));
  if (tracked.length > 0) findings.push(found('HFS_APP_GALLERY_SHOTS_TRACKED', tracked[0] as string, `${tracked.length} screenshot PNG${tracked.length === 1 ? ' is' : 's are'} tracked under ${params.pages}/ (first: ${tracked[0]}): untrack them (git rm --cached) and keep ${params.dir}/${params.ignoredShots} ignored`));
  findings.push(...explainFindings(repoRoot, params, inScope));
  return findings;
}

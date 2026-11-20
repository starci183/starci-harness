// gallery-board.mts - R395, the design board of an app (contexts/project/gallery.md PROJECT-GALLERY-9): `gallery/board/board.yaml` records the one board that draws every screen
// of the app, in every named state, at 1440 and 390, composed only of Grammar components and the app's tokens; each section is the module `gallery/board/<area>/<screen>.tsx`.
// An app without the record has no board and is outside this rule. The findings:
//   HFS_APP_GALLERY_BOARD_INVALID          the record is not YAML or not its shape, or a section has no module (an error);
//   HFS_APP_GALLERY_BOARD_ROUTE_MISSING    a `page.tsx` route of the front end, not excluded in gallery/routes.json, has no section whose `route` matches it;
//   HFS_APP_GALLERY_BOARD_SECTION_UNMAPPED a section's `route` is no route of the front end and the section is not marked `planned`, or it is marked `planned` while the route is coded.
// The last two are localOnly: a warning in `--env local`, an error in `--env prod`, as the coverage of PROJECT-GALLERY-4.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import type { GalleryParams } from '../gallery.mjs';
import { excludedKeys, feRoutes, resolveScreenRoute, routeExclusions } from '../gallery-routes.mjs';
import { found, readText } from './read.mjs';

/** The board folder inside the gallery folder, and its record. */
export const BOARD_DIR = 'board';
export const BOARD_FILE = 'board.yaml';

/** One section of the board: one screen of the app, drawn in each of its states. */
export interface BoardSection {
  id: string;
  title: string;
  route: string;
  /** The front-end app that serves the route, when two apps serve it. */
  app?: string;
  planned: boolean;
  states: string[];
  needsApi: string[];
}

export interface Board {
  revision: number;
  approvedAt: string | null;
  tokens: string[];
  sections: BoardSection[];
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const BOARD_KEYS = new Set(['schema', 'revision', 'approvedAt', 'tokens', 'sections']);
const SECTION_KEYS = new Set(['id', 'title', 'route', 'app', 'planned', 'states', 'needsApi']);
/** The state every section draws first: the screen at rest. */
export const DEFAULT_STATE = 'default';

const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');

/** The problems of one section entry, and the section when it has none. */
function sectionOf(value: unknown, index: number, boardDir: string, exists: (rel: string) => boolean): { section: BoardSection | null; problems: string[] } {
  const at = `sections[${index}]`;
  if (!plain(value)) return { section: null, problems: [`${at} is not a map`] };
  const entry = value as Record<string, unknown>;
  const problems: string[] = [];
  const extra = Object.keys(entry).filter((key) => !SECTION_KEYS.has(key));
  if (extra.length > 0) problems.push(`${at} has unknown keys ${extra.join(', ')}`);
  const id = typeof entry['id'] === 'string' ? entry['id'] : '';
  const [area = '', screen = '', ...rest] = id.split('/');
  if (!KEBAB.test(area) || !KEBAB.test(screen) || rest.length > 0) problems.push(`${at}.id "${id}" is not a gallery screen id <area>/<screen> in kebab case`);
  if (typeof entry['title'] !== 'string' || entry['title'].trim() === '') problems.push(`${at} (${id}) has no title`);
  const route = typeof entry['route'] === 'string' ? entry['route'].trim() : '';
  if (!route.startsWith('/')) problems.push(`${at} (${id}) has no route starting with "/": the route the section becomes`);
  if (entry['planned'] !== undefined && typeof entry['planned'] !== 'boolean') problems.push(`${at} (${id}).planned is not true or false`);
  const states = entry['states'] ?? [DEFAULT_STATE];
  if (!texts(states) || states.some((state) => !KEBAB.test(state))) problems.push(`${at} (${id}).states is not a list of kebab-case state names`);
  else if (states[0] !== DEFAULT_STATE || new Set(states).size !== states.length) problems.push(`${at} (${id}).states must start with "${DEFAULT_STATE}" and name each state once`);
  const needsApi = entry['needsApi'] ?? [];
  if (!texts(needsApi)) problems.push(`${at} (${id}).needsApi is not a list of the "cần API" operations`);
  const module = `${boardDir}/${id}.tsx`;
  if (problems.length === 0 && !exists(module)) problems.push(`${at} (${id}) has no module ${module}: each section is drawn by its own file, composed only of Grammar components`);
  if (problems.length > 0) return { section: null, problems };
  return { section: { id, title: (entry['title'] as string).trim(), route, ...(typeof entry['app'] === 'string' && entry['app'].trim() !== '' ? { app: entry['app'].trim() } : {}), planned: entry['planned'] === true, states: states as string[], needsApi: needsApi as string[] }, problems };
}

/** The board of `text` (the record's YAML), or the problems that make it no board. */
export function parseBoard(text: string, boardDir: string, exists: (rel: string) => boolean): { board: Board | null; problems: string[] } {
  let doc: unknown;
  try { doc = parseYaml(text); } catch (error) { return { board: null, problems: [`is not YAML: ${error instanceof Error ? error.message : String(error)}`] }; }
  if (!plain(doc)) return { board: null, problems: ['is not a map'] };
  const record = doc as Record<string, unknown>;
  const problems: string[] = [];
  const extra = Object.keys(record).filter((key) => !BOARD_KEYS.has(key));
  if (extra.length > 0) problems.push(`has unknown keys ${extra.join(', ')}`);
  if (record['schema'] !== 1) problems.push('needs schema: 1');
  const revision = record['revision'];
  if (!Number.isInteger(revision) || (revision as number) < 1) problems.push('needs revision, a whole number from 1, raised with every change the owner reviews');
  const approvedAt = record['approvedAt'] ?? null;
  if (approvedAt !== null && (typeof approvedAt !== 'string' || !ISO.test(approvedAt))) problems.push('approvedAt is a full ISO timestamp with its zone, or null before the owner approved the revision');
  const tokens = record['tokens'] ?? [];
  if (!texts(tokens)) problems.push('tokens is a list of app-root relative stylesheets (the app\'s theme tokens)');
  else for (const file of tokens) if (file.startsWith('/') || file.split('/').includes('..') || !exists(file)) problems.push(`tokens names ${file}, which is no file below the app root`);
  const list = record['sections'];
  if (!Array.isArray(list) || list.length === 0) problems.push('needs sections, one per screen of the app');
  const sections: BoardSection[] = [];
  for (const [index, value] of (Array.isArray(list) ? list : []).entries()) {
    const one = sectionOf(value, index, boardDir, exists);
    problems.push(...one.problems);
    if (one.section !== null) sections.push(one.section);
  }
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) problems.push(`names the section ${section.id} twice`);
    seen.add(section.id);
  }
  if (problems.length > 0) return { board: null, problems };
  return { board: { revision: revision as number, approvedAt: approvedAt as string | null, tokens: tokens as string[], sections }, problems };
}

/** The first six of `items` quoted, then how many more. */
const named = (items: readonly string[]): string => `${items.slice(0, 6).map((item) => `"${item}"`).join(', ')}${items.length > 6 ? `, and ${items.length - 6} more` : ''}`;

/** Findings of the board (PROJECT-GALLERY-9): its shape, then every coded route on the board and every section on a route or marked planned. */
export function boardFindings(repoRoot: string, params: GalleryParams) {
  const boardDir = `${params.dir}/${BOARD_DIR}`;
  const file = `${boardDir}/${BOARD_FILE}`;
  const text = readText(repoRoot, file);
  if (text === null) return [];
  const exists = (rel: string): boolean => { try { return fs.statSync(path.join(repoRoot, ...rel.split('/'))).isFile(); } catch { return false; } };
  const { board, problems } = parseBoard(text, boardDir, exists);
  if (board === null) return [found('HFS_APP_GALLERY_BOARD_INVALID', file, `${file} ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? `; and ${problems.length - 6} more` : ''} (PROJECT-GALLERY-9)`)];
  const routes = feRoutes(repoRoot);
  const { exclusions } = routeExclusions(readText(repoRoot, `${params.dir}/routes.json`));
  const excluded = excludedKeys(exclusions, routes);
  const coded = new Set(routes.map((route) => route.key));
  // a section is keyed by its app like a route: its own `app`, else the app that serves its route, else the single app
  const resolved = new Map(board.sections.map((section) => [section.id, resolveScreenRoute(routes, { route: section.route, ...(section.app === undefined ? {} : { app: section.app }) })] as const));
  const keyOf = (section: BoardSection): string | null => resolved.get(section.id)?.key ?? null;
  const drawn = new Set([...resolved.values()].flatMap((entry) => (entry.key === null ? [] : [entry.key])));
  const findings = [];
  for (const section of board.sections) {
    const apps = resolved.get(section.id)?.ambiguous ?? [];
    if (apps.length > 0) findings.push(found('HFS_APP_GALLERY_ROUTE_AMBIGUOUS', file, `${file} section ${section.id} draws ${section.route}, which the apps ${apps.join(' and ')} both serve: set its \`app\` to the one it shows (PROJECT-GALLERY-4)`, { local: true }));
  }
  for (const route of routes) {
    if (drawn.has(route.key) || excluded.has(route.key)) continue;
    findings.push(found('HFS_APP_GALLERY_BOARD_ROUTE_MISSING', route.file, `the route ${route.route} of ${route.app} has no section on the board ${file}: add a section whose \`route\` is ${route.route} with its module ${boardDir}/<area>/<screen>.tsx, or exclude the route in ${params.dir}/routes.json with a reason; a warning in --env local, an error in --env prod (PROJECT-GALLERY-9)`, { local: true }));
  }
  const ambiguousIds = new Set(board.sections.filter((section) => (resolved.get(section.id)?.ambiguous ?? []).length > 0).map((section) => section.id));
  const unmapped = board.sections.filter((section) => !section.planned && !ambiguousIds.has(section.id) && !coded.has(keyOf(section) ?? ''));
  if (unmapped.length > 0) findings.push(found('HFS_APP_GALLERY_BOARD_SECTION_UNMAPPED', file, `${file} draws ${named(unmapped.map((section) => `${section.id} (${section.route})`))}, whose route the front end does not have: correct the route, or mark the section \`planned: true\` until it is coded; a warning in --env local, an error in --env prod (PROJECT-GALLERY-9)`, { local: true }));
  const built = board.sections.filter((section) => section.planned && coded.has(keyOf(section) ?? ''));
  if (built.length > 0) findings.push(found('HFS_APP_GALLERY_BOARD_SECTION_UNMAPPED', file, `${file} marks ${named(built.map((section) => `${section.id} (${section.route})`))} planned, but the route is coded: drop \`planned\`; a warning in --env local, an error in --env prod (PROJECT-GALLERY-9)`, { local: true }));
  return findings;
}

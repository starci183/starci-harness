// gallery-design.mts - R395, the design pass drawn before code (contexts/project/gallery.md PROJECT-GALLERY-6): `.starcistacks/canvas/design.json` records, per gallery screen id
// `<area>/<screen>`, how far its design has come (drafted, approved by the owner, built, matched against the approved frame). The findings:
//   HFS_APP_GALLERY_DESIGN_MANIFEST      the manifest is not JSON or not its shape (an error);
//   HFS_APP_GALLERY_DESIGN_PAGE_MISSING  a built or matched page has no gallery/pages/<area>/<screen>/explain.md;
//   HFS_APP_GALLERY_DESIGN_UNAPPROVED    a screen of an area listed in `areas` exists in the gallery and has no approved design;
//   HFS_APP_GALLERY_DESIGN_SHOT_MISSING  a built or matched page records no sha of its 1440 or 390 shot, or the work tree holds shots of it without that width;
//   HFS_APP_GALLERY_DESIGN_SHOT_STALE    a shot record that predates the approval (a drafted or approved page that carries `shots`), or a shot in the work tree
//                                         that is not the one recorded.
// All but the first are localOnly: a warning in `--env local`, an error in `--env prod`. The shots are never tracked (PROJECT-GALLERY-1 item 5), so the recorded sha
// is the evidence a fresh checkout judges; the work tree's PNGs are compared with it wherever they exist.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import type { GalleryParams } from '../gallery.mjs';
import { screenSource } from '../screen-yaml.mjs';
import { found, readText } from './read.mjs';
import type { GalleryScreen } from './gallery.mjs';

/** The lifecycle of one page's design, in order. */
export const DESIGN_STATUSES = ['drafted', 'approved', 'built', 'matches'] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];
/** The widths the design draws and the shots it records; the gallery has no other width. */
export const DESIGN_WIDTHS = ['1440', '390'] as const;
/** The manifest, app-root relative: the canvas of the design pass lives in the app's .starcistacks/canvas/ (slot app.starcistacks.canvas). */
export const DESIGN_FILE = '.starcistacks/canvas/design.json';

export interface DesignPage {
  status: DesignStatus;
  approvedAt?: string;
  matchedAt?: string;
  board: string;
  shots?: Partial<Record<(typeof DESIGN_WIDTHS)[number], string>>;
  /** Approved (or drafted) but not buildable yet, e.g. it waits on data or an API: the gates that couple a code change to this screen skip it, and the reason is listed (PROJECT-GALLERY-6 item 9). */
  pending?: { reason: string };
}
export interface DesignManifest {
  areas: string[];
  pages: Record<string, DesignPage>;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const PAGE_KEYS = new Set(['status', 'approvedAt', 'matchedAt', 'board', 'shots', 'pending']);
export const PENDING_UNBUILT = 'HFS_APP_GALLERY_DESIGN_PENDING';

/**
 * The release of the critique rule (PROJECT-GALLERY-7 item 3, HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING): a `matches` page whose `matchedAt` is at or after this instant must carry the
 * section "Phương án đã cân nhắc" in its explain.md. A `matches` page with an earlier `matchedAt`, or none (every page matched before the rule), is only reported as not final yet.
 */
export const CRITIQUE_SINCE = '2026-11-18T00:00:00+07:00';
export const CRITIQUE_MISSING = 'HFS_APP_GALLERY_DESIGN_CRITIQUE_MISSING';

/** True from `approved` on: the owner has approved the page's frames. */
export const isApproved = (status: DesignStatus): boolean => DESIGN_STATUSES.indexOf(status) >= DESIGN_STATUSES.indexOf('approved');
/** True from `built` on: the page is in code and its shots are recorded. */
export const isBuilt = (status: DesignStatus): boolean => DESIGN_STATUSES.indexOf(status) >= DESIGN_STATUSES.indexOf('built');

/** The problems of one page entry; the shot record of a page not yet built is judged by the findings (SHOT_STALE), not here. */
function pageProblems(id: string, value: unknown, areas: ReadonlySet<string>): string[] {
  const [area = '', screen = '', ...rest] = id.split('/');
  const problems: string[] = [];
  if (rest.length > 0 || !KEBAB.test(area) || !KEBAB.test(screen)) problems.push(`the page id "${id}" is not "<area>/<screen>" in kebab case`);
  else if (!areas.has(area)) problems.push(`the page "${id}" is in the area "${area}", which "areas" does not list`);
  if (!plain(value)) return [...problems, `the page "${id}" is not an object`];
  const page = value as Record<string, unknown>;
  const unknown = Object.keys(page).filter((key) => !PAGE_KEYS.has(key));
  if (unknown.length > 0) problems.push(`the page "${id}" has the unknown key${unknown.length === 1 ? '' : 's'} ${unknown.map((key) => `"${key}"`).join(', ')}`);
  const status = page['status'];
  if (typeof status !== 'string' || !(DESIGN_STATUSES as readonly string[]).includes(status)) problems.push(`the page "${id}" has the status ${JSON.stringify(status)}, not one of ${DESIGN_STATUSES.join(', ')}`);
  const approvedAt = page['approvedAt'];
  const approved = typeof status === 'string' && (DESIGN_STATUSES as readonly string[]).includes(status) && isApproved(status as DesignStatus);
  if (approved && (typeof approvedAt !== 'string' || !ISO.test(approvedAt) || Number.isNaN(Date.parse(approvedAt)))) problems.push(`the page "${id}" is ${status} without an ISO "approvedAt" timestamp with its zone (e.g. 2026-11-17T09:30:00+07:00; a bare date such as 2026-11-17 is refused)`);
  const matchedAt = page['matchedAt'];
  if (matchedAt !== undefined && (status !== 'matches' || typeof matchedAt !== 'string' || !ISO.test(matchedAt) || Number.isNaN(Date.parse(matchedAt)))) problems.push(`the page "${id}" carries "matchedAt" ${JSON.stringify(matchedAt)}: only a matches page has it, as an ISO timestamp with its zone, set by the reviewer when the final critique is done`);
  if (!approved && approvedAt !== undefined) problems.push(`the page "${id}" is ${String(status)} and carries "approvedAt": only the owner's approval sets it, a redraw drops it`);
  if (typeof page['board'] !== 'string' || !/^https:\/\/\S+$/u.test(page['board'])) problems.push(`the page "${id}" has no "board" (the https link of the published board)`);
  const pending = page['pending'];
  if (pending !== undefined) {
    if (!plain(pending) || Object.keys(pending).some((key) => key !== 'reason')) problems.push(`the page "${id}" has a "pending" that is not exactly { "reason": "<why it cannot be built yet>" }`);
    else if (typeof pending['reason'] !== 'string' || pending['reason'].trim() === '') problems.push(`the page "${id}" is pending with no reason: say what it waits on (data, an API), because a pending screen is skipped by the change gates`);
    if (status === 'built' || status === 'matches') problems.push(`the page "${id}" is ${String(status)} and still pending: a built page is not pending, drop "pending"`);
  }
  const shots = page['shots'];
  if (shots !== undefined) {
    if (!plain(shots)) problems.push(`the page "${id}" has a "shots" that is not an object`);
    else for (const [width, sha] of Object.entries(shots as Record<string, unknown>)) {
      if (!(DESIGN_WIDTHS as readonly string[]).includes(width)) problems.push(`the page "${id}" records a shot of width "${width}": the design records ${DESIGN_WIDTHS.join(' and ')} only`);
      else if (typeof sha !== 'string' || !SHA256.test(sha)) problems.push(`the page "${id}" records the ${width} shot as ${JSON.stringify(sha)}, not a lowercase sha256`);
    }
  }
  return problems;
}

/** The manifest of a text, or the problems that make it invalid. */
export function parseDesign(text: string): { manifest: DesignManifest | null; problems: string[] } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { manifest: null, problems: ['is not JSON'] }; }
  if (!plain(value)) return { manifest: null, problems: ['is not an object { "areas": [...], "pages": { "<area>/<screen>": {...} } }'] };
  const doc = value as Record<string, unknown>;
  const problems: string[] = [];
  const unknown = Object.keys(doc).filter((key) => key !== 'areas' && key !== 'pages');
  if (unknown.length > 0) problems.push(`has the unknown key${unknown.length === 1 ? '' : 's'} ${unknown.map((key) => `"${key}"`).join(', ')}`);
  const areas = Array.isArray(doc['areas']) ? (doc['areas'] as unknown[]) : null;
  if (areas === null) problems.push('has no "areas" list');
  else if (areas.some((area) => typeof area !== 'string' || !KEBAB.test(area))) problems.push('lists an area that is not a kebab-case name');
  if (!plain(doc['pages'])) problems.push('has no "pages" object');
  if (problems.length > 0) return { manifest: null, problems };
  const listed = new Set(areas as string[]);
  const pages = doc['pages'] as Record<string, unknown>;
  for (const [id, page] of Object.entries(pages)) problems.push(...pageProblems(id, page, listed));
  return problems.length > 0 ? { manifest: null, problems } : { manifest: { areas: areas as string[], pages: pages as Record<string, DesignPage> }, problems: [] };
}

/** The pending screens of the design manifest of `repoRoot`, id to reason; empty when there is no canvas or its manifest is not valid (the manifest finding reports that). */
export function pendingScreens(repoRoot: string): Map<string, string> {
  const text = readText(repoRoot, DESIGN_FILE);
  const manifest = text === null ? null : parseDesign(text).manifest;
  return new Map(Object.entries(manifest?.pages ?? {}).flatMap(([id, page]) => (page.pending === undefined ? [] : [[id, page.pending.reason.trim()] as const])));
}

/** The sha256 of a file, or null when it is absent. */
function sha256(file: string): string | null {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

/** Findings of the design manifest against the gallery screens (PROJECT-GALLERY-6); none when the app keeps no `.starcistacks/canvas/design.json`. */
export function designFindings(repoRoot: string, params: GalleryParams, screens: readonly GalleryScreen[]) {
  const file = DESIGN_FILE;
  const text = readText(repoRoot, file);
  if (text === null) return [];
  const { manifest, problems } = parseDesign(text);
  const rule = '(PROJECT-GALLERY-6)';
  if (manifest === null) return [found('HFS_APP_GALLERY_DESIGN_MANIFEST', file, `${file} ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? `; and ${problems.length - 6} more` : ''} ${rule}`)];
  const local = { local: true };
  const findings = [];
  const byId = new Map(screens.map((screen) => [`${screen.area}/${screen.screen}`, screen]));
  const sourceOf = (id: string) => screenSource(`${params.pages}/${id}`, (rel) => readText(repoRoot, rel));
  const hasExplain = (id: string): boolean => sourceOf(id) !== null;
  for (const [id, page] of Object.entries(manifest.pages)) {
    const folder = `${params.pages}/${id}`;
    if (!isBuilt(page.status)) {
      if (page.shots !== undefined && Object.keys(page.shots).length > 0) findings.push(found('HFS_APP_GALLERY_DESIGN_SHOT_STALE', file, `the page ${id} is ${page.status} and still records shots: a shot recorded before the approval is older than it; drop "shots" when the page is approved or redrawn, the code lane records them again at built ${rule}`, local));
      continue;
    }
    if (!hasExplain(id)) {
      findings.push(found('HFS_APP_GALLERY_DESIGN_PAGE_MISSING', file, `the page ${id} is ${page.status} and ${folder}/explain.md does not exist: build the screen into its gallery folder with the approved explain.md, or correct the page id ${rule}`, local));
      continue;
    }
    if (page.status === 'matches') {
      const source = sourceOf(id);
      if (source === null || !source.hasOptions) {
        const stamp = page.matchedAt === undefined ? Number.NaN : Date.parse(page.matchedAt);
        const judged = !Number.isNaN(stamp) && stamp >= Date.parse(CRITIQUE_SINCE);
        const base = `the page ${id} is matches and ${folder}/screen.yaml (or explain.md) records no option considered ("considered" of screen.yaml, "## Phương án đã cân nhắc" of an explain.md)`;
        findings.push(judged
          ? found(CRITIQUE_MISSING, `${folder}/explain.md`, `${base}: a screen is final only after the critique of another agent (two rounds) and its record of the options weighed, each with why it was chosen or rejected; write the section, sync the canvas page note, and set matchedAt again ${rule}`)
          : { ...found(CRITIQUE_MISSING, `${folder}/explain.md`, `${base}: not final yet (matched ${page.matchedAt === undefined ? 'before the critique rule, no matchedAt' : `at ${page.matchedAt}, before ${CRITIQUE_SINCE}`}); it is listed so it is fixed gradually, never failing ${rule}`), level: 'info' });
      }
    }
    const unrecorded = DESIGN_WIDTHS.filter((width) => page.shots?.[width] === undefined);
    if (unrecorded.length > 0) findings.push(found('HFS_APP_GALLERY_DESIGN_SHOT_MISSING', file, `the page ${id} is ${page.status} and records no sha of its ${unrecorded.join(' and ')} shot: shoot ${folder}/${unrecorded.map((width) => `${width}.png`).join(' and ')} and record their sha256 ${rule}`, local));
    const screen = byId.get(id);
    if (screen === undefined || screen.shots === 0) continue;
    for (const width of DESIGN_WIDTHS) {
      const shot = `${folder}/${width}.png`;
      const actual = sha256(path.join(repoRoot, ...shot.split('/')));
      if (actual === null) findings.push(found('HFS_APP_GALLERY_DESIGN_SHOT_MISSING', shot, `the work tree holds shots of the ${page.status} page ${id} but not ${shot}: shoot it at ${width} ${rule}`, local));
      else if (page.shots?.[width] !== undefined && page.shots[width] !== actual) findings.push(found('HFS_APP_GALLERY_DESIGN_SHOT_STALE', shot, `${shot} is not the shot ${file} records for the ${page.status} page ${id} (sha256 ${actual.slice(0, 12)}, recorded ${page.shots[width]?.slice(0, 12)}): the screen was shot again after the record; compare it with the approved frame, then record its sha (built, or matches after the review) ${rule}`, local));
    }
  }
  const pending = Object.entries(manifest.pages).filter(([, page]) => page.pending !== undefined);
  if (pending.length > 0) {
    findings.push(found(PENDING_UNBUILT, file, `${pending.length} screen${pending.length === 1 ? '' : 's'} pending, skipped by the change gates (HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED, UI_AUDIT_*): ${pending.map(([id, page]) => `${id} (${page.pending?.reason.trim() ?? ''})`).join('; ')} ${rule}`, { level: 'info' }));
    for (const [id] of pending) {
      const shot = byId.get(id);
      if (shot !== undefined && shot.shots > 0) findings.push(found(PENDING_UNBUILT, `${params.pages}/${id}`, `the pending screen ${id} has a shot in the work tree, so it is coded: drop "pending" from its entry in ${file} and let the change gates judge it ${rule}`, { level: 'info' }));
    }
  }
  const areas = new Set(manifest.areas);
  for (const screen of screens) {
    const id = `${screen.area}/${screen.screen}`;
    if (!areas.has(screen.area) || !(screen.shots > 0 || hasExplain(id))) continue;
    const page = manifest.pages[id];
    if (page === undefined || !isApproved(page.status)) findings.push(found('HFS_APP_GALLERY_DESIGN_UNAPPROVED', `${params.pages}/${id}`, `the screen ${id} is in the gallery and its area "${screen.area}" is designed first (${file} "areas"), but ${page === undefined ? 'it has no design entry' : 'its design is only drafted'}: draw it on the board and have the owner approve it before it is built ${rule}`, local));
  }
  return findings;
}

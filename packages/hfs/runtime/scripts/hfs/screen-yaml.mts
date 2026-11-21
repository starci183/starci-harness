// screen-yaml.mts - the one structured file of a gallery screen (contexts/project/gallery.md PROJECT-GALLERY-8): `gallery/pages/<area>/<screen>/screen.yaml` replaces `explain.md`
// and `audit.json`. It holds the screen's identity (title, route, area, summary, code), the shot hashes, the sections (what each region shows and why), the options weighed
// (`considered`) and the UI audit (`audit`: builder, auditor, rounds of seven lenses). Pure functions: the validator (HFS_APP_GALLERY_SCREEN_INVALID, the document and its
// audit block alike), the reader that gives the older rules the explanation they already know, the skeleton and brief of `starci app uiaudit run`, the new cycle of
// `starci app uiaudit cycle`, and the converter from an explain.md.
// The first pass is the baseline, later drift is evidence (owner, 2026-11-21, train 188, the version that wins): "lần đầu ghi screen.yaml thì phải audit đến pass ghi bằng chứng.
// sau này sửa code trang nào hay k ưng trang nào chỉ đối chiếu với screen.yaml -> và có thể lan rộng ra để sửa hàng loạt nhưng lúc đó đủ luận điểm phản biện với thầy". So a touched
// screen is judged until its audit first passes (2+ rounds, no lens open in the last, by an auditor who is not the builder); from then on its audit records `baseline` and nothing
// about it blocks or warns: shots or code drifted since, later cycles and their open lenses are the reference a later fix compares against.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { parseYaml, stringifyYaml } from '../../engine/yaml.mjs';
import { EXPLAIN_FIELDS, hasOptionsSection, parseExplain, SHOT_WIDTHS, UNCLEAR_VALUE, type ExplainRegion, type Explanation } from './gallery-explain.mjs';

export const SCREEN_FILE = 'screen.yaml';
export const SCREEN_SCHEMA = 1;
/** The seven lenses of the UI audit, in order, with what each asks. */
export const LENSES = ['order', 'layout', 'actionable', 'live', 'words', 'states', 'truth'] as const;
export type Lens = (typeof LENSES)[number];
export const LENS_MEANING: Readonly<Record<Lens, string>> = Object.freeze({
  order: 'Content order: what the user needs first comes first.',
  layout: 'UI/UX arrangement: grouping, hierarchy, the Grammar rules, and the control checklist below (height 40, no wrapped label, overflow to the menu, tap target 44).',
  actionable: 'Every value shows how to change it.',
  live: 'Running, done, waiting and failed are visible with an icon and motion.',
  words: 'No mixed English or raw ids; one term per concept.',
  states: 'Empty, loading, error and no-permission states exist at 1440 and 390.',
  truth: 'The data is real, or marked "cần API".',
});
/**
 * The layout lens's explicit checklist (owner, 2026-11-19: a phone header wrapped a label and drew buttons under 40px because the audit read a scaled-down full-page shot). Each item is
 * checked on the full-resolution crops at 390 and 1440, never on the shrunk full-page shot, and answered in the layout notes.
 */
export const LAYOUT_CHECKLIST: readonly string[] = Object.freeze([
  'control height: every button, field and menu trigger is 40px tall (an sm control only nested in a list item or a dense toolbar; in a header never) - DNA-COMMON-CONTROLS-PHONE-40, DNA-COMMON-HEADER-CONTROLS-40',
  'no wrapped label: every button label, header action and link is on ONE line at 390 - DNA-COMMON-BUTTON-ONE-LINE, DNA-COMMON-HEADER-FIT-ONE-LINE',
  'overflow goes to the menu: a header with more actions than fit moves them into the three-line menu (TopBar fit), it never wraps, scrolls or runs off the edge - DNA-COMMON-HEADER-NO-OVERFLOW',
  'tap targets: every pressable part is at least 44px by 44px to touch at 390, its own box or the extended hit area (thresholds target.coarse.min)',
]);
export const VERDICTS = ['pass', 'fixed', 'open'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MIN_ROUNDS = 2;
export const MAX_ROUNDS = 4;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;
/** The shot a state adds beside the two widths: `<state>-<width>`, e.g. `empty-1440`. */
const STATE_SHOT = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:1440|390)$/u;

export interface ShotRecord { file: string; sha256: string | null }
export interface Section { id: string; title: string; shows?: string; why: string; actions?: string[]; states?: Record<string, string | null>; needsApi?: string[]; law?: string; grammar?: string }
export interface Considered { option: string; chosen: boolean; why: string }
export interface LensVerdict { verdict: Verdict; notes?: string }
export interface Round { n: number; at: string; lenses: Record<Lens, LensVerdict> }
/** The first pass of a screen's audit: when its rounds first closed with no lens open, and how many rounds that took. Set once, kept through later cycles. */
export interface Baseline { at: string; rounds: number }
export interface Audit { builder: { agent: string }; auditor: { agent: string }; rounds: Round[]; escalate: string | null; baseline?: Baseline }
export interface ScreenDoc {
  schema: number; screen: string; title: string; route: string; area: string; summary: string; code: string[];
  shots: Record<string, ShotRecord>; sections: Section[]; considered: Considered[]; audit: Audit | null;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The problems of the audit block alone (part of HFS_APP_GALLERY_SCREEN_INVALID); empty for `null` (a screen not audited yet). */
export function auditProblems(audit: unknown): string[] {
  if (audit === null || audit === undefined) return [];
  if (!plain(audit)) return ['audit is neither null nor a mapping'];
  const problems: string[] = [];
  for (const side of ['builder', 'auditor'] as const) if (!plain(audit[side]) || !text((audit[side] as Record<string, unknown>)['agent'])) problems.push(`audit.${side}.agent is missing`);
  const rounds = audit['rounds'];
  if (!Array.isArray(rounds)) return [...problems, 'audit.rounds is not a list'];
  rounds.forEach((round, index) => {
    const at = `audit.rounds[${index}]`;
    if (!plain(round)) { problems.push(`${at} is not a mapping`); return; }
    if (round['n'] !== index + 1) problems.push(`${at}.n is ${JSON.stringify(round['n'])}, expected ${index + 1}`);
    if (typeof round['at'] !== 'string' || !ISO.test(round['at']) || Number.isNaN(Date.parse(round['at']))) problems.push(`${at}.at is not an ISO timestamp with its zone`);
    const lenses = round['lenses'];
    if (!plain(lenses)) { problems.push(`${at}.lenses is not a mapping`); return; }
    for (const key of Object.keys(lenses)) if (!(LENSES as readonly string[]).includes(key)) problems.push(`${at}.lenses.${key} is no lens (${LENSES.join(', ')})`);
    for (const lens of LENSES) {
      const entry = lenses[lens];
      if (!plain(entry)) { problems.push(`${at}.lenses.${lens} is missing: every round runs all seven lenses`); continue; }
      const verdict = entry['verdict'];
      if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) problems.push(`${at}.lenses.${lens}.verdict is ${JSON.stringify(verdict)}, not pass, fixed or open`);
      else if (verdict !== 'pass' && !text(entry['notes'])) problems.push(`${at}.lenses.${lens} is ${verdict} with no notes: say what was found or changed`);
    }
  });
  if (audit['escalate'] !== null && audit['escalate'] !== undefined && !text(audit['escalate'])) problems.push('audit.escalate is neither null nor a text');
  const baseline = audit['baseline'];
  if (baseline !== undefined && (!plain(baseline) || typeof baseline['at'] !== 'string' || !ISO.test(baseline['at']) || typeof baseline['rounds'] !== 'number')) problems.push('audit.baseline is { at: <ISO timestamp with its zone>, rounds: <n> }, written by `starci audit run` when the audit first passes');
  return problems;
}

/** The problems of the document outside the audit block (HFS_APP_GALLERY_SCREEN_INVALID). `id` is `<area>/<screen>` of the folder. */
export function docProblems(value: unknown, id: string): string[] {
  if (!plain(value)) return ['is not a mapping'];
  const problems: string[] = [];
  if (value['schema'] !== SCREEN_SCHEMA) problems.push(`schema is ${JSON.stringify(value['schema'])}, expected ${SCREEN_SCHEMA}`);
  if (value['screen'] !== id) problems.push(`screen is ${JSON.stringify(value['screen'])}, the folder is ${id}`);
  const [area = ''] = id.split('/');
  for (const key of ['title', 'route', 'summary'] as const) if (!text(value[key])) problems.push(`${key} is missing`);
  if (value['area'] !== area) problems.push(`area is ${JSON.stringify(value['area'])}, the folder's is ${area}`);
  if (!strings(value['code'])) problems.push('code is not a list of source paths');
  const shots = value['shots'];
  if (!plain(shots)) problems.push('shots is not a mapping');
  else {
    for (const width of SHOT_WIDTHS) if (!plain(shots[width])) problems.push(`shots.${width} is missing`);
    for (const [key, shot] of Object.entries(shots)) {
      if (!(SHOT_WIDTHS as readonly string[]).includes(key) && !STATE_SHOT.test(key)) problems.push(`shots.${key} is no width (1440, 390) or state shot (<state>-<width>)`);
      if (!plain(shot)) continue;
      if (shot['file'] !== `${key}.png`) problems.push(`shots.${key}.file is ${JSON.stringify(shot['file'])}, expected ${key}.png`);
      const sha = shot['sha256'];
      if (sha !== null && (typeof sha !== 'string' || !SHA256.test(sha))) problems.push(`shots.${key}.sha256 is not a lowercase sha256 (or null before the first shot)`);
    }
  }
  const sections = value['sections'];
  if (!Array.isArray(sections) || sections.length === 0) problems.push('sections is empty: one section per region, top to bottom');
  else {
    const seen = new Set<string>();
    sections.forEach((section, index) => {
      const at = `sections[${index}]`;
      if (!plain(section)) { problems.push(`${at} is not a mapping`); return; }
      const sid = section['id'];
      if (typeof sid !== 'string' || !KEBAB.test(sid)) problems.push(`${at}.id is not a kebab-case id`);
      else if (seen.has(sid)) problems.push(`${at}.id "${sid}" repeats`);
      else seen.add(sid);
      for (const key of ['title', 'why'] as const) if (!text(section[key])) problems.push(`${at}.${key} is missing`);
      for (const key of ['shows', 'law', 'grammar'] as const) if (section[key] !== undefined && typeof section[key] !== 'string') problems.push(`${at}.${key} is not a text`);
      for (const key of ['actions', 'needsApi'] as const) if (section[key] !== undefined && !strings(section[key])) problems.push(`${at}.${key} is not a list of texts`);
      const states = section['states'];
      if (states !== undefined && (!plain(states) || Object.values(states).some((state) => state !== null && typeof state !== 'string'))) problems.push(`${at}.states maps a state to a text or null`);
    });
  }
  const considered = value['considered'];
  if (!Array.isArray(considered)) problems.push('considered is not a list');
  else considered.forEach((entry, index) => { if (!plain(entry) || !text(entry['option']) || typeof entry['chosen'] !== 'boolean' || typeof entry['why'] !== 'string') problems.push(`considered[${index}] needs option, chosen (true or false) and why`); });
  if (!('audit' in value)) problems.push('audit is missing: null for a screen not audited yet (grandfathered)');
  if ('app' in value && !text(value['app'])) problems.push('app is not a front-end app name (the app that serves the route; omit it when one app does)');
  const known = new Set(['schema', 'screen', 'title', 'route', 'app', 'area', 'summary', 'code', 'shots', 'sections', 'considered', 'audit']);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) problems.push(`has the unknown key${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}`);
  return problems;
}

/** A screen.yaml text: the raw value, whether it parsed, and the document and audit problems. */
export interface ParsedScreen { value: Record<string, unknown> | null; parseError: string | null; doc: string[]; audit: string[] }

export function parseScreen(source: string, id: string): ParsedScreen {
  let value: unknown;
  try { value = parseYaml(source); } catch { return { value: null, parseError: 'is not valid YAML', doc: [], audit: [] }; }
  if (!plain(value)) return { value: null, parseError: 'is not a mapping', doc: [], audit: [] };
  return { value, parseError: null, doc: docProblems(value, id), audit: auditProblems(value['audit']) };
}

/** The sha256 of a file, or null when it is absent. */
export function sha256File(file: string): string | null {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

/** The facts the UI audit judge reads about one touched screen. */
export interface AuditFacts {
  id: string;
  /** The raw screen.yaml value (null when absent or unparseable). */
  value: Record<string, unknown> | null;
  /** The shot hashes found on disk by key (`1440`, `390`); absent keys are not on this machine (a fresh checkout holds no PNG). */
  disk: Readonly<Record<string, string>>;
  /** Source or screen text changed since the base while screen.yaml did not. */
  unrecorded: boolean;
  /** The changed files that reach the screen (its own source first, then what its route imports): the first one and the count name the cause of a stale audit. */
  changed?: readonly string[];
}

export interface AuditFinding { code: string; message: string }
export const AUDIT_CODES = Object.freeze({
  missing: 'UI_AUDIT_MISSING', stale: 'UI_AUDIT_STALE', self: 'UI_AUDIT_SELF_REVIEW', few: 'UI_AUDIT_ROUNDS_FEW',
  open: 'UI_AUDIT_OPEN', owner: 'UI_AUDIT_NEEDS_OWNER', considered: 'UI_AUDIT_CONSIDERED_EMPTY',
});

const norm = (agent: unknown): string => String(agent ?? '').trim().toLowerCase();

/** The changed file that causes a stale audit, with how many more reach the screen. */
export const causeOf = (changed: readonly string[] | undefined): string => (changed === undefined || changed.length === 0 ? '' : ` (changed: ${changed[0] as string}${changed.length > 1 ? ` and ${String(changed.length - 1)} more` : ''})`);

/** Whether an audit's current rounds pass: at least two, the last filled with no lens open, by an auditor who is not the builder. */
export function auditPasses(audit: Audit): boolean {
  const last = audit.rounds.at(-1);
  if (last === undefined || audit.rounds.length < MIN_ROUNDS || norm(audit.builder.agent) === norm(audit.auditor.agent)) return false;
  return LENSES.every((lens) => last.lenses[lens].verdict !== 'open' && !last.lenses[lens].notes?.startsWith('auditor: fill this lens'));
}

/** Whether the screen has passed once: its audit records a baseline, or its current rounds pass (an audit that passed before `baseline` existed). */
export function hasBaseline(audit: Audit): boolean {
  return plain(audit.baseline) || auditPasses(audit);
}

/**
 * The UI audit verdict of one touched screen (PROJECT-GALLERY-8): every finding with its code, empty when the audit stands. A screen with no audit is UI_AUDIT_MISSING; a screen whose
 * audit has passed once (its baseline) is never judged again; until then its first cycle is judged in full (stale shots or code, self-review, fewer than two rounds, open lenses,
 * open after round 4, nothing considered). A malformed audit block is HFS_APP_GALLERY_SCREEN_INVALID, reported for every screen by the gallery rule, not here.
 */
export function judgeAudit(facts: AuditFacts): AuditFinding[] {
  const { id, value } = facts;
  const folder = `the screen ${id}`;
  if (value === null || value['audit'] === null || value['audit'] === undefined) return [{ code: AUDIT_CODES.missing, message: `${folder} changed (its code, its screen.yaml or its shots) and has no audit: run \`starci audit run ${id}\`, let an auditor agent other than the builder fill the rounds until they pass: the pass is its baseline (PROJECT-GALLERY-8)` }];
  if (auditProblems(value['audit']).length > 0) return [];
  const audit = value['audit'] as unknown as Audit;
  // passed once: from now on its screen.yaml is the reference a later fix compares against, never a finding
  if (hasBaseline(audit)) return [];
  const findings: AuditFinding[] = [];
  const shots = (plain(value['shots']) ? value['shots'] : {}) as Record<string, ShotRecord | undefined>;
  for (const width of SHOT_WIDTHS) {
    const recorded = shots[width]?.sha256 ?? null;
    if (recorded === null) findings.push({ code: AUDIT_CODES.stale, message: `${folder} records no sha256 for its ${width} shot: shoot it and run \`starci audit run ${id}\` to record it (PROJECT-GALLERY-8)` });
    else if (facts.disk[width] !== undefined && facts.disk[width] !== recorded) findings.push({ code: AUDIT_CODES.stale, message: `${folder}: ${width}.png is not the shot its first cycle saw (sha256 ${facts.disk[width]?.slice(0, 12)}, recorded ${recorded.slice(0, 12)}): run \`starci audit run ${id}\` for a round on the new shot (PROJECT-GALLERY-8)` });
  }
  if (facts.unrecorded) findings.push({ code: AUDIT_CODES.stale, message: `${folder}: its code or text changed since the base and screen.yaml did not, and its first cycle has not passed${causeOf(facts.changed)}: run \`starci audit run ${id}\` (PROJECT-GALLERY-8)` });
  if (norm(audit.builder.agent) === norm(audit.auditor.agent)) findings.push({ code: AUDIT_CODES.self, message: `${folder}: the auditor (${audit.auditor.agent}) is the builder: another agent audits (PROJECT-GALLERY-8)` });
  if (audit.rounds.length < MIN_ROUNDS) findings.push({ code: AUDIT_CODES.few, message: `${folder} has ${audit.rounds.length} audit round${audit.rounds.length === 1 ? '' : 's'}, at least ${MIN_ROUNDS}: round 1 finds, the fixes land, round 2 checks (PROJECT-GALLERY-8)` });
  const last = audit.rounds.at(-1);
  const open = last === undefined ? [] : LENSES.filter((lens) => last.lenses[lens].verdict === 'open');
  if (open.length > 0) {
    findings.push(audit.rounds.length >= MAX_ROUNDS
      ? { code: AUDIT_CODES.owner, message: `${folder} still has open lenses (${open.join(', ')}) after round ${MAX_ROUNDS} of its first cycle: fix and open the next cycle with \`starci audit cycle ${id} --reason <why>\`, or the owner decides${audit.escalate === null ? ' (write audit.escalate)' : `: ${audit.escalate}`} (PROJECT-GALLERY-8)` }
      : { code: AUDIT_CODES.open, message: `${folder} has open lenses in round ${audit.rounds.length} (${open.join(', ')}): fix them, shoot again and run another round until the first cycle passes (PROJECT-GALLERY-8)` });
  }
  const considered = Array.isArray(value['considered']) ? value['considered'] : [];
  if (considered.length === 0) findings.push({ code: AUDIT_CODES.considered, message: `${folder} records no option considered: list each option weighed with why it was chosen or rejected (PROJECT-GALLERY-8)` });
  return findings;
}

/** The explanation the explain.md rules know, built from a screen.yaml value: front matter, one region per section (`Vì sao` = why), the options section as a flag. */
export function explanationOfScreen(value: Record<string, unknown>): Explanation & { hasOptions: boolean } {
  const sections = Array.isArray(value['sections']) ? (value['sections'] as unknown[]).filter(plain) : [];
  const regions: ExplainRegion[] = sections.map((section) => {
    const fields: ExplainRegion['fields'] = {};
    const why = typeof section['why'] === 'string' ? section['why'].trim() : '';
    fields['Vì sao'] = why;
    if (typeof section['law'] === 'string') fields['Luật'] = section['law'];
    if (typeof section['grammar'] === 'string') fields['Grammar'] = section['grammar'];
    const problems: ExplainRegion['problems'] = [];
    if (why === '') problems.push({ kind: 'missing', field: 'Vì sao' });
    else if (UNCLEAR_VALUE.test(why)) problems.push({ kind: 'unclear', field: 'Vì sao' });
    return { name: String(section['title'] ?? section['id'] ?? ''), fields, problems };
  });
  const meta: Record<string, string> = {};
  for (const key of ['title', 'route', 'area', 'app'] as const) if (typeof value[key] === 'string') meta[key] = value[key];
  const considered = Array.isArray(value['considered']) ? value['considered'] : [];
  return { meta, intro: typeof value['summary'] === 'string' ? value['summary'] : '', regions, hasOptions: considered.length > 0 };
}

/** What a screen folder's description is: the screen.yaml when it exists, else the legacy explain.md. */
export interface ScreenSource { kind: 'yaml' | 'md'; file: string; explanation: Explanation; hasOptions: boolean; value: Record<string, unknown> | null }

/** Reads the description of the screen folder `folder` (app-root relative) through `read` (null when absent): screen.yaml first, explain.md while a screen is not migrated. */
export function screenSource(folder: string, read: (rel: string) => string | null): ScreenSource | null {
  const yaml = read(`${folder}/${SCREEN_FILE}`);
  if (yaml !== null) {
    let value: unknown = null;
    try { value = parseYaml(yaml); } catch { value = null; }
    const record = plain(value) ? value : null;
    const built = record === null ? { meta: {}, intro: '', regions: [], hasOptions: false } : explanationOfScreen(record);
    return { kind: 'yaml', file: `${folder}/${SCREEN_FILE}`, explanation: built, hasOptions: built.hasOptions, value: record };
  }
  const md = read(`${folder}/explain.md`);
  if (md === null) return null;
  return { kind: 'md', file: `${folder}/explain.md`, explanation: parseExplain(md), hasOptions: hasOptionsSection(md), value: null };
}

// ---- the skeleton and the brief of `starci app uiaudit run`

const emptyLenses = (): Record<Lens, LensVerdict> => Object.fromEntries(LENSES.map((lens) => [lens, { verdict: 'open', notes: 'auditor: fill this lens (pass, fixed or open) with what you found' }])) as Record<Lens, LensVerdict>;

/** The screen value with the shot hashes taken now and the next round skeleton appended (or the first, with the builder named). Returns the new value and what it did. */
export function nextRound(value: Record<string, unknown>, { disk, builder, auditor, now }: { disk: Readonly<Record<string, string>>; builder?: string | undefined; auditor?: string | undefined; now: string }): { value: Record<string, unknown>; note: string } {
  const done = plain(value['audit']) && Array.isArray(value['audit']['rounds']) ? (value['audit']['rounds'] as Round[]) : [];
  const lastDone = done.at(-1);
  const waiting = lastDone !== undefined && plain(lastDone.lenses) && LENSES.some((lens) => lastDone.lenses[lens]?.notes?.startsWith('auditor: fill this lens'));
  // a closed cycle keeps the shots its last round judged: a reshoot after it opens a new cycle (`starci audit cycle`), never inherits round 4's verdicts
  if (done.length >= MAX_ROUNDS && !waiting) return { value, note: `round ${MAX_ROUNDS} closed this cycle: nothing recorded; for a new look at the screen run \`starci audit cycle <area>/<screen> --reason <why>\`` };
  const next = structuredClone(value);
  const shots = (plain(next['shots']) ? next['shots'] : {}) as Record<string, ShotRecord>;
  for (const width of SHOT_WIDTHS) shots[width] = { file: `${width}.png`, sha256: disk[width] ?? shots[width]?.sha256 ?? null };
  next['shots'] = shots;
  const audit = (plain(next['audit']) ? next['audit'] : { builder: { agent: builder ?? '' }, auditor: { agent: auditor ?? '' }, rounds: [], escalate: null }) as unknown as Audit;
  if (builder !== undefined) audit.builder = { agent: builder };
  if (auditor !== undefined) audit.auditor = { agent: auditor };
  const last = audit.rounds.at(-1);
  const pending = last !== undefined && LENSES.some((lens) => last.lenses[lens].notes?.startsWith('auditor: fill this lens'));
  let note: string;
  // the first time the rounds pass, the pass is the screen's baseline: written once, kept by every later cycle
  if (!plain(audit.baseline) && auditPasses(audit) && last !== undefined) audit.baseline = { at: last.at, rounds: audit.rounds.length };
  if (pending) note = `round ${last?.n} is still waiting for the auditor; the shot hashes are updated`;
  else { audit.rounds.push({ n: audit.rounds.length + 1, at: now, lenses: emptyLenses() }); note = `round ${audit.rounds.length} prepared`; }
  next['audit'] = audit;
  return { value: next, note };
}

/**
 * The screen value with its audit closed into the record and a new cycle opened (`starci audit cycle`): the closed cycle becomes one `considered` entry (chosen, with the
 * reason, its rounds, their dates, the last verdict of each lens, builder and auditor; the rounds themselves stay in git history) and `audit` starts empty again, so the next
 * `starci audit run` prepares round 1. A screen with no audit has no cycle to close.
 */
export function nextCycle(value: Record<string, unknown>, { reason }: { reason: string }): { value: Record<string, unknown>; note: string } | { error: string } {
  if (!plain(value['audit'])) return { error: 'has no audit to close: run `starci audit run` for its first round' };
  const audit = value['audit'] as unknown as Audit;
  const rounds = Array.isArray(audit.rounds) ? audit.rounds : [];
  if (rounds.length === 0) return { error: 'has an audit with no round: run `starci audit run` instead' };
  const last = rounds.at(-1) as Round;
  const verdicts = LENSES.map((lens) => `${lens} ${last.lenses?.[lens]?.verdict ?? '?'}`).join(', ');
  const next = structuredClone(value);
  const considered = Array.isArray(next['considered']) ? (next['considered'] as unknown[]) : [];
  considered.push({
    option: `Close the audit cycle and open a new one: ${reason}`,
    chosen: true,
    why: `The closed cycle ran ${rounds.length} round${rounds.length === 1 ? '' : 's'} (${rounds[0]?.at ?? '?'} to ${last.at}), builder ${audit.builder?.agent ?? '?'}, auditor ${audit.auditor?.agent ?? '?'}; its last round: ${verdicts}${audit.escalate ? `; escalated: ${audit.escalate}` : ''}. Its rounds are in git history.`,
  });
  next['considered'] = considered;
  const baseline = plain(audit.baseline) ? audit.baseline : auditPasses(audit) ? { at: last.at, rounds: rounds.length } : undefined;
  next['audit'] = { builder: { agent: audit.builder?.agent ?? '' }, auditor: { agent: audit.auditor?.agent ?? '' }, rounds: [], escalate: null, ...(baseline === undefined ? {} : { baseline }) };
  return { value: next, note: `cycle of ${rounds.length} round${rounds.length === 1 ? '' : 's'} closed into considered; run \`starci audit run\` for round 1 of the new cycle` };
}

/** The brief an auditor agent reads: the shots to open at full size, the screen's own words, the seven lenses and the laws. */
export function auditBrief({ id, folder, value, shotPaths, cropPaths = [], laws }: { id: string; folder: string; value: Record<string, unknown>; shotPaths: readonly string[]; cropPaths?: readonly string[]; laws: readonly string[] }): string {
  const audit = plain(value['audit']) ? (value['audit'] as unknown as Audit) : null;
  return [
    `# UI audit brief: ${id}`,
    '',
    'You are the AUDITOR. You are a different agent from the builder (audit.builder.agent); you do not fix the screen alone and you never mark a lens pass you did not check on the shot.',
    '',
    '## Read first, at full size',
    ...(cropPaths.length === 0 ? [] : ['The CROPS first: the first viewport and the header region of each shot, cut at full resolution (never scaled). Judge the header and the first screen on these, not on the full-page shot, which a viewer shrinks to fit.', ...cropPaths.map((crop) => `- ${crop}`), 'Then the full shots:']),
    ...shotPaths.map((shot) => `- ${shot}`),
    `- ${folder}/${SCREEN_FILE}: the screen's identity, sections, the options considered and the audit you fill`,
    '',
    '## The seven lenses (every round runs all seven; verdict pass | fixed | open, with notes)',
    ...LENSES.map((lens, index) => `${index + 1}. ${lens}: ${LENS_MEANING[lens]}`),
    '',
    '## The layout lens checklist (answer each item in the layout notes, on the crops)',
    ...LAYOUT_CHECKLIST.map((item) => `- ${item}`),
    '',
    '## The loop',
    `Round 1 finds; the builder fixes what is open and shoots again; run \`starci audit run ${id}\` for the next round. At least ${MIN_ROUNDS} rounds, at most ${MAX_ROUNDS} a cycle, until no lens is open. Still open after round ${MAX_ROUNDS}: set audit.escalate to "needs owner: <why>". The first pass is the screen's baseline; after it the rounds are evidence for the next fix, never a finding.`,
    'A lens you changed code for is "fixed" (notes: what changed), one that held is "pass", one still wrong is "open" (notes: what is wrong). Then fill audit.auditor.agent with your own id and `considered` with each option weighed and why it was chosen or rejected.',
    '',
    '## The laws to hold the screen to',
    ...laws.map((law) => `- ${law}`),
    '',
    '## The screen as its builder described it',
    stringifyYaml({ title: value['title'], route: value['route'], ...('app' in value ? { app: value['app'] } : {}), summary: value['summary'], code: value['code'], sections: value['sections'], considered: value['considered'] }).trimEnd(),
    '',
    audit === null ? 'No audit yet: this run wrote the skeleton.' : `Builder: ${audit.builder.agent || '(not named)'}; rounds so far: ${audit.rounds.length}.`,
  ].join('\n');
}

// ---- the converter from explain.md

/** The lines under `## Phương án đã cân nhắc`, one bullet or paragraph each. */
function optionLines(markdown: string): string[] {
  const lines = markdown.normalize('NFC').replace(/\r\n/gu, '\n').split('\n');
  const at = lines.findIndex((line) => { const heading = /^##\s+(.+?)\s*$/u.exec(line); return heading !== null && /^Phương án đã cân nhắc$/iu.test(heading[1] as string); });
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^##\s/u.test(line)) break;
    const bullet = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/u.exec(line);
    if (bullet !== null) out.push((bullet[1] as string).trim());
    else if (line.trim() !== '' && out.length > 0) out[out.length - 1] = `${out.at(-1) as string} ${line.trim()}`;
    else if (line.trim() !== '') out.push(line.trim());
  }
  return out;
}

const slug = (name: string, used: Set<string>): string => {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/gu, '').replaceAll('đ', 'd').replaceAll('Đ', 'D').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'section';
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
};

/** The screen.yaml value of an explain.md: its regions become sections, its options section `considered`, the shot hashes are those on disk (null where no PNG), `audit: null` (grandfathered). */
export function screenOfExplain({ id, markdown, disk }: { id: string; markdown: string; disk: Readonly<Record<string, string>> }): Record<string, unknown> {
  const explanation = parseExplain(markdown);
  const [area = ''] = id.split('/');
  const used = new Set<string>();
  const sections = explanation.regions.map((region) => {
    const section: Record<string, unknown> = { id: slug(region.name, used), title: region.name, why: region.fields['Vì sao'] ?? '' };
    if (region.fields['Luật'] !== undefined) section['law'] = region.fields['Luật'];
    if (region.fields['Grammar'] !== undefined) section['grammar'] = region.fields['Grammar'];
    return section;
  });
  const shots = Object.fromEntries(SHOT_WIDTHS.map((width) => [width, { file: `${width}.png`, sha256: disk[width] ?? null }]));
  return {
    schema: SCREEN_SCHEMA, screen: id, title: explanation.meta['title'] || id, route: explanation.meta['route'] || '', ...(explanation.meta['app'] ? { app: explanation.meta['app'] } : {}), area: explanation.meta['area'] || area,
    summary: explanation.intro.replace(/\s+/gu, ' ').trim() || explanation.meta['title'] || id, code: [], shots, sections,
    considered: optionLines(markdown).map((line) => ({ option: line, chosen: false, why: 'chuyển từ explain.md, chưa tách phương án và lý do' })), audit: null,
  };
}

export { EXPLAIN_FIELDS, SHOT_WIDTHS, stringifyYaml };

/** The screen folders' shot hashes under `repoRoot` for a screen folder (app-root relative), by width key. */
export function shotsOnDisk(repoRoot: string, folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const width of SHOT_WIDTHS) { const sha = sha256File(path.join(repoRoot, ...folder.split('/'), `${width}.png`)); if (sha !== null) out[width] = sha; }
  return out;
}

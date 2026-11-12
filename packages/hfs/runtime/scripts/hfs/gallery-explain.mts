// gallery-explain.mts - the reader of a gallery page's explanation (R395, contexts/project/gallery.md PROJECT-GALLERY-2): `gallery/pages/<area>/<page>/explain.md` has a
// front matter (`title`, `route`, `area`) and one `## <region name>` per visible region of the page, each with the lines `Vì sao:`, `Luật:` and `Grammar:`.
// Pure functions; nothing here touches the disk. The managed gallery app reads the same file with `templates/app/gallery/gallery/src/explain.js`, which holds this logic
// in plain JavaScript (the browser cannot import this module); `src/app-gallery.spec.mts` runs both over the same texts and requires equal answers.

/** The three lines every region carries, in the order the file writes them. */
export const EXPLAIN_FIELDS = ['Vì sao', 'Luật', 'Grammar'] as const;
export type ExplainField = (typeof EXPLAIN_FIELDS)[number];

/** The fields the gate requires a value for in every region (`Luật` is written, shown and reviewed, never gated). */
export const REQUIRED_FIELDS: readonly ExplainField[] = ['Vì sao', 'Grammar'];

/** The front matter keys an explanation declares. */
export const FRONT_MATTER_KEYS = ['title', 'route', 'area'] as const;

/** A value that starts with one of the owner's two verdict words says the region cannot be explained (`CHƯA RÕ`, not yet clear) or is wrong (`SAI`): a bug, never an explanation. */
export const UNCLEAR_VALUE = /^(?:CHƯA RÕ|SAI)(?![\p{L}\p{N}])/u;

/** What is wrong with one field of one region. */
export interface RegionProblem {
  kind: 'missing' | 'unclear';
  field: ExplainField;
}

/** One `## <region name>` of an explanation. */
export interface ExplainRegion {
  name: string;
  fields: Partial<Record<ExplainField, string>>;
  problems: RegionProblem[];
}

/** A parsed `explain.md`. */
export interface Explanation {
  meta: Record<string, string>;
  intro: string;
  regions: ExplainRegion[];
}

const fieldPattern = (field: string): RegExp => new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}${field}\\*{0,2}:\\*{0,2}[ \\t]*`, 'iu');
const FIELD_PATTERNS = EXPLAIN_FIELDS.map((field) => [field, fieldPattern(field)] as const);

/** The explanation in `markdown`: the front matter, the text before the first region, and each region with its three lines and the problems of the gate. */
export function parseExplain(markdown: string): Explanation {
  let body = markdown.normalize('NFC').replace(/\r\n/gu, '\n');
  const meta: Record<string, string> = {};
  const front = /^---\n([\s\S]*?)\n---\n?/u.exec(body);
  if (front !== null) {
    for (const line of (front[1] ?? '').split('\n')) {
      const pair = /^(\w+):\s*(.*)$/u.exec(line);
      if (pair !== null) meta[pair[1] as string] = (pair[2] as string).replace(/^["']|["']$/gu, '').trim();
    }
    body = body.slice(front[0].length);
  }
  const regions: ExplainRegion[] = [];
  const intro: string[] = [];
  let current: ExplainRegion | null = null;
  let last: ExplainField | null = null;
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading !== null) {
      current = { name: heading[1] as string, fields: {}, problems: [] };
      regions.push(current);
      last = null;
      continue;
    }
    if (current === null) { intro.push(line); continue; }
    const hit = FIELD_PATTERNS.find(([, pattern]) => pattern.test(line));
    if (hit !== undefined) {
      current.fields[hit[0]] = line.replace(hit[1], '').trim();
      last = hit[0];
    } else if (last !== null && line.trim() !== '') {
      current.fields[last] = `${current.fields[last] ?? ''} ${line.trim()}`.trim();
    }
  }
  for (const region of regions) {
    for (const field of EXPLAIN_FIELDS) {
      const value = region.fields[field];
      if (REQUIRED_FIELDS.includes(field) && (value === undefined || value === '')) region.problems.push({ kind: 'missing', field });
      else if (value !== undefined && UNCLEAR_VALUE.test(value)) region.problems.push({ kind: 'unclear', field });
    }
  }
  return { meta, intro: intro.join('\n').trim(), regions };
}

/** The front matter keys an explanation lacks (an empty value counts as lacking). */
export const missingFrontMatter = (explanation: Explanation): string[] => FRONT_MATTER_KEYS.filter((key) => (explanation.meta[key] ?? '') === '');

/** The only widths a screen is shot at, and so the only shot names: `1440.png`, `1920.png`, `390.png` (a state or an agent variant is its own screen folder). */
export const SHOT_WIDTHS = ['1440', '1920', '390'] as const;
export const SHOT_FILES: readonly string[] = SHOT_WIDTHS.map((width) => `${width}.png`);

const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The screens a `links.json` points at (`links.json` of a screen folder: an array, or `{ "links": [...] }`, of `{ "to": "<area>/<screen>", "x", "y", "w", "h" }` hotspots
 * as fractions of the shot), or null when the shape is wrong (not a list, or an entry without a text `to`).
 */
export function linkTargets(json: unknown): string[] | null {
  const list = Array.isArray(json) ? json : plain(json) && Array.isArray(json['links']) ? json['links'] : null;
  if (list === null || !list.every((link) => plain(link) && typeof link['to'] === 'string' && link['to'] !== '')) return null;
  return list.map((link) => (link as { to: string }).to);
}

/** The named flows of `flows.json` (an object `{ "<name>": ["<area>/<screen>", ...] }`, or a list of `{ "name", "screens" }`), or null when the shape is wrong. */
export function flowList(json: unknown): { name: string; screens: string[] }[] | null {
  const entries = Array.isArray(json)
    ? json.map((flow) => (plain(flow) ? [flow['name'], flow['screens']] : [undefined, undefined]))
    : plain(json) ? Object.entries(json) : null;
  if (entries === null) return null;
  const ok = entries.every(([name, screens]) => typeof name === 'string' && name !== '' && Array.isArray(screens) && screens.every((screen) => typeof screen === 'string' && screen !== ''));
  return ok ? entries.map(([name, screens]) => ({ name: name as string, screens: screens as string[] })) : null;
}

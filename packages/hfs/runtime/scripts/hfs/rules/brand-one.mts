// brand-one.mts - R445: ONE BRAND SOURCE. The colours of an app live in one place, its brand token file `modules/brand/brand.css`; the marketing site, the
// console and the canvas read them from there and hold no colour of their own (contexts/code/fe/ui.md FE-CSS-3, contexts/project/brand.md PROJECT-BRAND-4).
// The colour literals in TypeScript, in CSS and in inline styles are R61's lint (eslint-canon-fe `no-raw-brand-value`, stylelint `raw-brand-value`); this
// rule judges what a lint of the source cannot:
//   FE_BRAND_NOT_ONE             (front end) the web apps of a front end have no `modules/brand/brand.css`, or more than one: two files are two brands.
//   FE_BRAND_CANVAS_LITERAL      (app root) a canvas generator under `.starcistacks/canvas/gen/` (the claude-design `gen/kit/` copy aside) writes a colour
//                                literal (hex, colour function, a named colour in a colour property, a Tailwind arbitrary or palette colour): the canvas takes
//                                its colours from tokens, as the app does.
//   FE_BRAND_CANVAS_TOKENS_STALE (app root) `.starcistacks/canvas/tokens.css` is not the file `canvas-tokens.mjs` generates from the brand file: absent, hand
//                                edited or older than a brand change. The canvas reads its tokens from it, so the canvas shows the brand the app ships.
import { createHash } from 'node:crypto';
import { found, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const FE_BRAND_NOT_ONE = 'FE_BRAND_NOT_ONE';
export const FE_BRAND_CANVAS_LITERAL = 'FE_BRAND_CANVAS_LITERAL';
export const FE_BRAND_CANVAS_TOKENS_STALE = 'FE_BRAND_CANVAS_TOKENS_STALE';
const RULE = '(R445, contexts/project/brand.md PROJECT-BRAND-4)';
export const CANVAS_DIR = '.starcistacks/canvas';
export const CANVAS_TOKENS = `${CANVAS_DIR}/tokens.css`;
const CANVAS_GEN = `${CANVAS_DIR}/gen/`;
const CANVAS_KIT = `${CANVAS_GEN}kit/`;
const BRAND_FILE = /(?:^|\/)modules\/brand\/brand\.css$/u;
const ROOT_BRAND_FILE = /^fe\/.*modules\/brand\/brand\.css$/u;
const GENERATOR_FILE = /\.(?:[cm]?[jt]sx?|css|html)$/u;
const GENERATOR_COMMAND = 'node node_modules/@starci/hfs/runtime/scripts/hfs/canvas-tokens.mjs';
/** The lint's colour patterns (eslint-canon-fe `brand-values`, stylelint-canon `brand-value`), plus the named colours of a colour property and a Tailwind colour class. */
const HEX_COLOR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/u;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/iu;
const NAMED = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';
const NAMED_IN_COLOR_PROPERTY = new RegExp(String.raw`(?<![\w-])(?:color|background(?:-color)?|border(?:-[a-z]+)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|stop-color|flood-color)\s*[:=]\s*["']?[^;"'}]*?(?<![\w-])(?:${NAMED})(?![\w-])`, 'iu');
const ARBITRARY_NAMED = new RegExp(String.raw`-\[(?:color:)?(?:${NAMED})\](?![\w-])`, 'iu');
const PALETTE = /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500|600|700|800|900|950)(?![\w-])/u;

/** The first colour literal of a generator's text with its line, or null. */
export function firstColorLiteral(text: string): { sample: string; line: number } | null {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const hit = HEX_COLOR.exec(line) ?? COLOR_FUNCTION.exec(line) ?? ARBITRARY_NAMED.exec(line) ?? PALETTE.exec(line) ?? NAMED_IN_COLOR_PROPERTY.exec(line);
    if (hit !== null) return { sample: hit[0].trim().slice(0, 40), line: index + 1 };
  }
  return null;
}

const lf = (text: string): string => text.replaceAll('\r\n', '\n');

/** The canvas token file generated from a brand file: a stamp (its path and the sha256 of its text) and then the brand layer, byte for byte. */
export function renderCanvasTokens(brandPath: string, brandText: string): string {
  const body = lf(brandText).replace(/\n*$/u, '\n');
  const digest = createHash('sha256').update(body).digest('hex');
  return `/* generated from ${brandPath} (sha256 ${digest}): do not edit; after a brand change run \`${GENERATOR_COMMAND}\` */\n${body}`;
}

/** FE_BRAND_NOT_ONE over a front end: one brand file for every web app of the side. */
export function brandOneFindings({ files = [], repo, isRoot = false, inScope = () => true }: { files?: readonly string[]; repo: Repo; isRoot?: boolean; inScope?: (file: string) => boolean }): Finding[] {
  if (isRoot || repo?.profile !== 'fe') return [];
  const tracked = [...new Set(files.map((file) => file.replaceAll('\\', '/')))].sort();
  const apps = [...new Set(tracked.flatMap((file) => (/^(?<app>apps\/[^/]+)\/src\/app\//u.exec(file)?.groups?.['app'] ?? [])))].sort();
  if (apps.length === 0) return [];
  const brands = tracked.filter((file) => BRAND_FILE.test(file));
  if (brands.length === 0) {
    const file = `${apps[0] as string}/src/modules/brand/brand.css`;
    return inScope(file) ? [found(FE_BRAND_NOT_ONE, file, `the front end has no brand token file: every web app takes its colours from one \`modules/brand/brand.css\` (the only file that may hold a colour value), which its global stylesheet imports ${RULE}`)] : [];
  }
  if (brands.length === 1) return [];
  return brands.slice(1).filter((file) => inScope(file)).map((file) => found(FE_BRAND_NOT_ONE, file, `${file} is a second brand file (the front end holds ${brands.join(', ')}): the apps of one product share ONE brand source, so the site and the console show the same colours; keep ${brands[0] as string} and import it from every global stylesheet ${RULE}`, { brands }));
}

/** FE_BRAND_CANVAS_LITERAL and FE_BRAND_CANVAS_TOKENS_STALE over the canvas of an app root. */
export function canvasBrandFindings({ repoRoot, repo, isRoot, all = [], inScope = () => true }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: readonly string[]; inScope?: (file: string) => boolean }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const tracked = [...new Set(all.map((file) => file.replaceAll('\\', '/')))].sort();
  if (!tracked.some((file) => file.startsWith(`${CANVAS_DIR}/`))) return [];
  const findings: Finding[] = [];
  for (const file of tracked) {
    if (!file.startsWith(CANVAS_GEN) || file.startsWith(CANVAS_KIT) || !GENERATOR_FILE.test(file) || !inScope(file)) continue;
    const hit = firstColorLiteral(readText(repoRoot, file) ?? '');
    if (hit !== null) findings.push(found(FE_BRAND_CANVAS_LITERAL, file, `${file}:${hit.line} writes the colour literal \`${hit.sample}\`: a canvas generator holds no colour, it reads the tokens generated from the brand file (\`var(--token)\` over ${CANVAS_TOKENS}) so the canvas shows the brand the app ships ${RULE}`, { line: hit.line }));
  }
  const brand = tracked.find((file) => ROOT_BRAND_FILE.test(file));
  if (brand === undefined || !inScope(CANVAS_TOKENS)) return findings;
  const brandText = readText(repoRoot, brand);
  if (brandText === null) return findings;
  const expected = renderCanvasTokens(brand, brandText);
  const actual = tracked.includes(CANVAS_TOKENS) ? readText(repoRoot, CANVAS_TOKENS) : null;
  if (actual === null) findings.push(found(FE_BRAND_CANVAS_TOKENS_STALE, CANVAS_TOKENS, `the canvas has no ${CANVAS_TOKENS}: its tokens are generated from ${brand}; run \`${GENERATOR_COMMAND}\` ${RULE}`));
  else if (lf(actual) !== expected) findings.push(found(FE_BRAND_CANVAS_TOKENS_STALE, CANVAS_TOKENS, `${CANVAS_TOKENS} is not what ${brand} generates (hand edited, or the brand changed since): the canvas reads the brand's own tokens, so regenerate it with \`${GENERATOR_COMMAND}\` ${RULE}`));
  return findings;
}

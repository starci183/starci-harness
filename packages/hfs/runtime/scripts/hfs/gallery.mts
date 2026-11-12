// gallery.mts - the screenshot gallery every app carries (R395, contexts/project/gallery.md PROJECT-GALLERY-1 and PROJECT-GALLERY-2): the parameters the rule, the sync
// templates and the dev stack read from `ruleParams.gallery` of the slot manifest, and the one place the gallery port is derived from the project
// base port (`environments.<env>.local.basePort`, stack-base-port.mts): base + `portOffset`. Pure functions; nothing here touches the disk.
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { loadSlotManifest } from './slots.mjs';
import { CANON_INDENT, CANON_PRINT_WIDTH } from '../../../sync/canon-layout.mjs';

/** The `ruleParams.gallery` block of the slot manifest. */
export interface GalleryParams {
  /** The folder of the gallery app at the app root. */
  dir: string;
  /** The package script that serves it. */
  devScript: string;
  /** The gallery port is the project base port plus this. */
  portOffset: number;
  /** The exact Vite version the managed package.json pins. */
  vite: string;
  /** The folder of the pages (shots and explain.md per page), app-root relative. */
  pages: string;
  /** The gitignore pattern, relative to the gallery folder, that keeps the PNGs out of git. */
  ignoredShots: string;
}

type Manifest = { ruleParams?: Record<string, unknown> };

/** The gallery parameters of the manifest (the bundled one by default). */
export function galleryParams(manifest: Manifest = loadSlotManifest() as Manifest): GalleryParams {
  const block = manifest.ruleParams?.['gallery'];
  if (!plain(block)) throw new Error('the slot manifest has no ruleParams.gallery');
  return block as unknown as GalleryParams;
}

/** The port the gallery of an app serves on, or null when the app declares no base port. */
export const galleryPort = (basePort: number | null | undefined, params: GalleryParams): number | null =>
  typeof basePort === 'number' && Number.isInteger(basePort) ? basePort + params.portOffset : null;

/** The `local.basePort` of a parsed stack declaration: the dev environment's when it declares one, else the first docker-compose environment's; null when none. */
export function declaredBasePort(doc: unknown): number | null {
  const environments = plain(doc) && plain((doc as Record<string, unknown>)['environments']) ? (doc as { environments: Record<string, unknown> }).environments : {};
  const order = ['dev', ...Object.keys(environments).filter((name) => name !== 'dev')];
  for (const name of order) {
    const spec = environments[name];
    if (!plain(spec) || (spec as Record<string, unknown>)['runtime'] !== 'docker-compose') continue;
    const local = (spec as Record<string, unknown>)['local'];
    const base = plain(local) ? (local as Record<string, unknown>)['basePort'] : undefined;
    if (Number.isInteger(base)) return base as number;
  }
  return null;
}

/** The words the managed gallery shows. `title` and `readme` carry `{project}` and `{port}` placeholders the renderer fills; the other words carry `{n}`-style placeholders main.js fills. */
export interface GalleryLabels {
  title: string;
  search: string;
  empty: string;
  noPages: string;
  onlyBugs: string;
  summary: string;
  explained: string;
  noRegions: string;
  unclearRegions: string;
  problemMissing: string;
  problemUnclear: string;
  noImages: string;
  meta: string;
  screensTab: string;
  flowsTab: string;
  noFlows: string;
  linksHeading: string;
  openScreen: string;
  readme: readonly string[];
}

/** The UI language of the gallery by locale; `en` is the fallback of every locale this table does not hold. The explain.md field names (`Vì sao`, `Luật`, `Grammar`) are the owner's and stay as written in both. */
export const GALLERY_LABELS: Readonly<Record<string, GalleryLabels>> = Object.freeze({
  en: {
    title: '{project} gallery',
    search: 'Search screens',
    empty: 'No screens yet. Put the shots and explain.md in gallery/pages/<area>/<screen>/',
    noPages: 'No screens.',
    onlyBugs: 'only screens with bugs',
    summary: '{shown} screens · {regions} regions explained · {badRegions} regions missing Why/Grammar or unclear · {hidden} screens hidden (no explain.md)',
    explained: 'explained',
    noRegions: 'BUG: no region yet',
    unclearRegions: 'BUG: {n} unclear regions',
    problemMissing: 'missing {field}',
    problemUnclear: '{field} is unclear or wrong',
    noImages: 'No shots in this mode.',
    meta: 'route: {route} · area: {area}',
    screensTab: 'Screens',
    flowsTab: 'Flow map',
    noFlows: 'No flow yet. Name flows in gallery/flows.json and mark hotspots in a screen links.json.',
    linksHeading: 'Links between screens',
    openScreen: 'Open {to}',
    readme: [
      'One folder per screen: its shots at each width and the explanation of every region (PROJECT-GALLERY-1, PROJECT-GALLERY-2).',
      '',
      '- `pages/<area>/<screen>/` is one screen (one agent, one state). It holds only the shots `<width>.png` (1440, 1920 and 390), the explanation file explain.md and the optional links.json, nothing else. A state or an agent variant is its own folder; before and after comparisons belong in fix reports.',
      '- explain.md has a front matter (`title`, `route`, `area`) and one `## <region name>` per region, each with the lines `Vì sao:`, `Luật:` (a memory file name or a contexts anchor) and `Grammar:`. A region that cannot be explained with a law and a Grammar reference is a bug: fix it before reporting; CHƯA RÕ or SAI is a warning locally and an error in `starci app check --env prod`.',
      '- links.json lists hotspots of the screen, `{ "to": "<area>/<screen>", "x", "y", "w", "h" }` (fractions of the shot); flows.json names ordered screen ids, `{ "<flow name>": ["<area>/<screen>"] }`. The Flow map view draws them.',
      '- `npm install && npm run dev` serves it on http://localhost:{port} (the app base port + 50); `starci app stack up --env dev` starts it with the app. New files appear on reload. The gallery shows only the screens that have an explain.md; `starci app check` fails on the others.',
      '- The PNGs are git-ignored; explain.md, links.json, flows.json and the gallery app are source, the app managed by `starci app sync`.',
    ],
  },
  vi: {
    title: 'Thư viện ảnh {project}',
    search: 'Tìm màn hình',
    empty: 'Chưa có màn hình nào. Đặt ảnh và explain.md vào gallery/pages/<area>/<screen>/',
    noPages: 'Không có màn hình.',
    onlyBugs: 'chỉ màn hình lỗi',
    summary: '{shown} màn hình · {regions} vùng đã ghi · {badRegions} vùng thiếu Vì sao/Grammar hoặc chưa rõ · {hidden} màn hình bị ẩn (thiếu explain.md)',
    explained: 'đã giải thích',
    noRegions: 'LỖI: chưa có vùng nào',
    unclearRegions: 'LỖI: {n} vùng chưa rõ',
    problemMissing: 'thiếu {field}',
    problemUnclear: '{field} chưa rõ hoặc sai',
    noImages: 'Không có ảnh ở chế độ này.',
    meta: 'route: {route} · khu: {area}',
    screensTab: 'Màn hình',
    flowsTab: 'Bản đồ luồng',
    noFlows: 'Chưa có luồng. Đặt tên luồng trong gallery/flows.json và đánh dấu vùng bấm trong links.json của màn hình.',
    linksHeading: 'Liên kết giữa các màn hình',
    openScreen: 'Mở {to}',
    readme: [
      'Mỗi màn hình một thư mục: ảnh ở từng độ rộng và lời giải thích của mọi vùng (PROJECT-GALLERY-1, PROJECT-GALLERY-2).',
      '',
      '- `pages/<area>/<screen>/` là một màn hình (một agent, một trạng thái). Thư mục chỉ chứa các ảnh `<width>.png` (1440, 1920 và 390), tệp giải thích explain.md và links.json tùy chọn, không gì khác. Bản trạng thái hoặc bản của agent khác là thư mục riêng; so sánh trước/sau nằm trong báo cáo sửa.',
      '- explain.md có front matter (`title`, `route`, `area`) và mỗi vùng một mục `## <tên vùng>` với các dòng `Vì sao:`, `Luật:` (tên tệp memory hoặc anchor contexts) và `Grammar:`. Vùng không giải thích được bằng một luật và một tham chiếu Grammar là lỗi: sửa trước khi báo cáo; CHƯA RÕ hoặc SAI là cảnh báo khi chạy local và là lỗi ở `starci app check --env prod`.',
      '- links.json liệt kê các vùng bấm của màn hình, `{ "to": "<area>/<screen>", "x", "y", "w", "h" }` (tỉ lệ của ảnh); flows.json đặt tên các luồng gồm mã màn hình có thứ tự, `{ "<tên luồng>": ["<area>/<screen>"] }`. Chế độ Bản đồ luồng vẽ chúng.',
      '- `npm install && npm run dev` chạy thư viện tại http://localhost:{port} (cổng gốc của app + 50); `starci app stack up --env dev` khởi động cùng app. Tệp mới hiện sau khi tải lại. Thư viện chỉ hiện màn hình có explain.md; `starci app check` fail ở các màn hình còn lại.',
      '- Các tệp PNG bị git bỏ qua; explain.md, links.json, flows.json và ứng dụng thư viện là mã nguồn, ứng dụng do `starci app sync` quản lý.',
    ],
  },
});

/** The supported gallery language for a declared default locale (`vi-VN` reads as `vi`); `en` when the locale is undeclared or not in the table. */
export function galleryLocale(declared: string | null | undefined): string {
  const primary = (declared ?? '').trim().toLowerCase().split(/[-_]/u)[0] ?? '';
  return Object.hasOwn(GALLERY_LABELS, primary) ? primary : 'en';
}

/** One label entry as Prettier prints it: `key: "value",` on one line while it fits the canon print width, else the value alone on the next line. */
const labelLine = (key: string, value: string): string => {
  const line = `${CANON_INDENT}${key}: ${JSON.stringify(value)},`;
  return line.length <= CANON_PRINT_WIDTH ? `${line}\n` : `${CANON_INDENT}${key}:\n${CANON_INDENT}${CANON_INDENT}${JSON.stringify(value)},\n`;
};

/** The label table as the object literal the canon Prettier config prints: unquoted keys, double-quoted strings, 4 spaces, a trailing comma (a managed file is rendered format-clean). */
const labelsLiteral = (words: Record<string, string>): string => `{\n${Object.entries(words).map(([key, value]) => labelLine(key, value)).join('')}}`;

/** The managed gallery's template variables for a default locale: the document language, the JSON label table main.js reads, the title and the README body. */
export function galleryTexts(declared: string | null | undefined, project: string, port: number | string): Record<string, string> {
  const lang = galleryLocale(declared);
  const labels = GALLERY_LABELS[lang] as GalleryLabels;
  const fill = (text: string): string => text.replaceAll('{project}', project).replaceAll('{port}', String(port));
  const { readme, title, ...words } = labels;
  return {
    galleryLang: lang,
    galleryTitle: fill(title),
    galleryLabels: labelsLiteral(words),
    galleryReadme: readme.map(fill).join('\n'),
  };
}

const DEFAULT_LOCALE_DECLARATION = /\bDEFAULT_LOCALE\b[^=\n]*=\s*["']([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?)["']/u;
const DEFAULT_LOCALE_OPTION = /\bdefaultLocale\s*:\s*["']([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?)["']/u;

/**
 * The default locale an app declares in its i18n routing source (`export const DEFAULT_LOCALE = "vi"`, or a literal `defaultLocale:` of `defineI18n`),
 * or null when the text declares none. The routing file is the app's one declaration of its languages (FE-I18N-1); hfs.json holds none.
 */
export function declaredDefaultLocale(routingText: string | null | undefined): string | null {
  if (routingText === null || routingText === undefined) return null;
  return DEFAULT_LOCALE_DECLARATION.exec(routingText)?.[1] ?? DEFAULT_LOCALE_OPTION.exec(routingText)?.[1] ?? null;
}

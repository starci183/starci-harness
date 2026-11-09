// gallery.mts - the screenshot gallery every app carries (R395, contexts/project/gallery.md PROJECT-GALLERY-1): the parameters the rule, the sync
// templates and the dev stack read from `ruleParams.gallery` of the slot manifest, and the one place the gallery port is derived from the project
// base port (`environments.<env>.local.basePort`, stack-base-port.mts): base + `portOffset`. Pure functions; nothing here touches the disk.
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { loadSlotManifest } from './slots.mjs';

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
  /** The folder of the screenshots, app-root relative. */
  shots: string;
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

/** The words the managed gallery shows. `title` and `readme` carry `{project}` and `{port}` placeholders the renderer fills. */
export interface GalleryLabels {
  title: string;
  search: string;
  all: string;
  empty: string;
  before: string;
  after: string;
  readme: readonly string[];
}

/** The UI language of the gallery by locale; `en` is the fallback of every locale this table does not hold. */
export const GALLERY_LABELS: Readonly<Record<string, GalleryLabels>> = Object.freeze({
  en: {
    title: '{project} gallery',
    search: 'Search pages',
    all: 'All',
    empty: 'No screenshots yet. Put PNGs in gallery/shots/<area>/<page>__<width>__<before|after>.png',
    before: 'before',
    after: 'after the fix',
    readme: [
      'Screenshots of every page, grouped by area, before and after each UI fix round (PROJECT-GALLERY-1).',
      '',
      '- Put shots in `shots/<area>/<page>__<width>__<before|after>.png` (the width is 1440 or 390), one pair per page and width.',
      "- `npm install && npm run dev` serves it on http://localhost:{port} (the app's base port + 50); `starci app stack up --env dev` starts it with the app. New files appear on reload.",
      '- The PNGs are git-ignored; the gallery app is source, managed by `starci app sync`.',
    ],
  },
  vi: {
    title: 'Th\u01b0 vi\u1ec7n \u1ea3nh {project}',
    search: 'T\u00ecm trang',
    all: 'T\u1ea5t c\u1ea3',
    empty: 'Ch\u01b0a c\u00f3 \u1ea3nh ch\u1ee5p. \u0110\u1eb7t PNG v\u00e0o gallery/shots/<area>/<page>__<width>__<before|after>.png',
    before: 'tr\u01b0\u1edbc',
    after: 'sau khi s\u1eeda',
    readme: [
      '\u1ea2nh ch\u1ee5p m\u1ecdi trang, nh\u00f3m theo khu v\u1ef1c, tr\u01b0\u1edbc v\u00e0 sau m\u1ed7i v\u00f2ng s\u1eeda giao di\u1ec7n (PROJECT-GALLERY-1).',
      '',
      '- \u0110\u1eb7t \u1ea3nh v\u00e0o `shots/<area>/<page>__<width>__<before|after>.png` (\u0111\u1ed9 r\u1ed9ng l\u00e0 1440 ho\u1eb7c 390), m\u1ed7i trang v\u00e0 m\u1ed7i \u0111\u1ed9 r\u1ed9ng m\u1ed9t c\u1eb7p.',
      '- `npm install && npm run dev` ch\u1ea1y th\u01b0 vi\u1ec7n t\u1ea1i http://localhost:{port} (c\u1ed5ng g\u1ed1c c\u1ee7a app + 50); `starci app stack up --env dev` kh\u1edfi \u0111\u1ed9ng c\u00f9ng app. T\u1ec7p m\u1edbi hi\u1ec7n sau khi t\u1ea3i l\u1ea1i.',
      '- C\u00e1c t\u1ec7p PNG b\u1ecb git b\u1ecf qua; \u1ee9ng d\u1ee5ng th\u01b0 vi\u1ec7n l\u00e0 m\u00e3 ngu\u1ed3n, do `starci app sync` qu\u1ea3n l\u00fd.',
    ],
  },
});

/** The supported gallery language for a declared default locale (`vi-VN` reads as `vi`); `en` when the locale is undeclared or not in the table. */
export function galleryLocale(declared: string | null | undefined): string {
  const primary = (declared ?? '').trim().toLowerCase().split(/[-_]/u)[0] ?? '';
  return Object.hasOwn(GALLERY_LABELS, primary) ? primary : 'en';
}

/** The label table as the object literal the canon Prettier config prints: unquoted keys, double-quoted strings, 4 spaces, a trailing comma (a managed file is rendered format-clean). */
const labelsLiteral = (words: Record<string, string>): string =>
  `{\n${Object.entries(words).map(([key, value]) => `    ${key}: ${JSON.stringify(value)},\n`).join('')}}`;

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

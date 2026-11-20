// proves: FE_BRAND_NOT_ONE
// proves: FE_BRAND_CANVAS_LITERAL
// proves: FE_BRAND_CANVAS_TOKENS_STALE
// proves: FE_GLOBALS_NOT_ONE
// proves: FE_GLOBALS_IMPORTS_MISSING
// proves: FE_STATE_PAGE_NOT_SHARED
// proves: FE_STATE_PAGE_GROUP_MISSING
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brandOneFindings, canvasBrandFindings, firstColorLiteral, renderCanvasTokens } from '../runtime/scripts/hfs/rules/brand-one.mjs';
import { globalsOneFindings } from '../runtime/scripts/hfs/rules/globals-one.mjs';
import { statePageFindings } from '../runtime/scripts/hfs/rules/state-pages.mjs';
import { canvasTokensMain } from '../runtime/scripts/hfs/canvas-tokens.mjs';

/** Writes `tree` (path to text) into a temp repository and returns its root and the tracked list. */
function repoOf(tree: Record<string, string>): { root: string; files: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'one-source-'));
  for (const [file, text] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, files: Object.keys(tree) };
}

const GLOBALS = '@import "tailwindcss";\n@import "@heroui/styles/css";\n@import "@starci/grammar/common.css";\n@import "../modules/brand/brand.css";\n@source "../../../../../node_modules/@starci/grammar/dist";\n';
const BRAND = ':root, .light, .dark {\n  --accent: #0d9488;\n}\n';
const EMPTY = 'import { EmptyNotice } from "@starci/grammar/common"\nexport const Notice = () => <EmptyNotice scope="page" message="m" media={{ illustration: { staticsKey: "illustrations/errors/not-found.webp" } }} actionLabel="Home" actionHref="/" />\n';
const route = (name: string, from: string): string => `import { ${name} } from "${from}"\nexport default () => <${name} />\n`;

/** The lite web app of the template: one globals, one brand, shared composites, one route group with its own boundaries. */
const APP: Record<string, string> = {
  'apps/web/src/app/globals.css': GLOBALS,
  'apps/web/src/modules/brand/brand.css': BRAND,
  'apps/web/src/app/[locale]/layout.tsx': 'import "../globals.css"\nexport default () => null\n',
  'apps/web/src/app/[locale]/not-found.tsx': route('NotFoundNotice', '@/components/composites/NotFoundNotice'),
  'apps/web/src/app/global-error.tsx': route('GlobalErrorNotice', '@/components/frames/GlobalErrorNotice'),
  'apps/web/src/app/[locale]/(pages)/page.tsx': 'export default () => null\n',
  'apps/web/src/app/[locale]/(pages)/error.tsx': route('ErrorNotice', '@/components/composites/ErrorNotice'),
  'apps/web/src/app/[locale]/(pages)/not-found.tsx': route('NotFoundNotice', '@/components/composites/NotFoundNotice'),
  'apps/web/src/components/composites/NotFoundNotice/index.tsx': EMPTY.replace('Notice =', 'NotFoundNotice ='),
  'apps/web/src/components/composites/ErrorNotice/index.tsx': EMPTY.replace('Notice =', 'ErrorNotice ='),
  'apps/web/src/components/frames/GlobalErrorNotice/index.tsx': 'import { ErrorNotice } from "@/components/composites/ErrorNotice"\nexport const GlobalErrorNotice = () => <html><body><ErrorNotice /></body></html>\n',
};

{
  const fe = { profile: 'fe' };

  test(`one source: the template shape passes all three finders`, () => {
    const { root, files } = repoOf(APP);
    assert.deepEqual(brandOneFindings({ files, repo: fe }), []);
    assert.deepEqual(globalsOneFindings({ files, repoRoot: root, repo: fe }), []);
    assert.deepEqual(statePageFindings({ files, repoRoot: root, repo: fe }), []);
  });

  test(`FE_BRAND_NOT_ONE: no brand file, or a second one, is refused`, () => {
    const none = Object.fromEntries(Object.entries(APP).filter(([file]) => !file.endsWith('brand.css')));
    assert.deepEqual(brandOneFindings({ files: Object.keys(none), repo: fe }).map((f) => f.code), ['FE_BRAND_NOT_ONE']);
    const two = brandOneFindings({ files: [...Object.keys(APP), 'apps/site/src/app/page.tsx', 'apps/site/src/modules/brand/brand.css'], repo: fe });
    assert.deepEqual(two.map((f) => [f.code, f.path]), [['FE_BRAND_NOT_ONE', 'apps/web/src/modules/brand/brand.css']]);
    assert.equal(brandOneFindings({ files: Object.keys(APP), repo: { profile: 'be' } }).length, 0);
    assert.equal(brandOneFindings({ files: Object.keys(APP), repo: fe, isRoot: true }).length, 0);
  });

  test(`FE_GLOBALS_NOT_ONE: a second global sheet and a stylesheet import outside the globals are refused`, () => {
    const { root, files } = repoOf({
      ...APP,
      'apps/web/src/app/[locale]/(site)/site.css': '.hero { display: flex; }\n',
      'apps/web/src/app/[locale]/(site)/layout.tsx': 'import "./site.css"\nexport default () => null\n',
      'apps/web/src/modules/brand/index.ts': 'import "./brand.css"\n',
      'apps/web/src/components/Box/box.module.css': '.a { display: flex; }\n',
      'apps/web/src/components/Box/index.tsx': 'import styles from "./box.module.css"\nexport const Box = () => styles\n',
    });
    const findings = globalsOneFindings({ files, repoRoot: root, repo: fe });
    assert.deepEqual(findings.map((f) => [f.code, f.path]), [
      ['FE_GLOBALS_NOT_ONE', 'apps/web/src/app/[locale]/(site)/layout.tsx'],
      ['FE_GLOBALS_NOT_ONE', 'apps/web/src/app/[locale]/(site)/site.css'],
      ['FE_GLOBALS_NOT_ONE', 'apps/web/src/modules/brand/index.ts'],
    ]);
    assert.match(findings[0]?.message ?? '', /R446/u);
  });

  test(`FE_GLOBALS_IMPORTS_MISSING: the one globals imports the Grammar stylesheet and the brand file, and exists`, () => {
    const noBrand = repoOf({ ...APP, 'apps/web/src/app/globals.css': '@import "tailwindcss";\n@import "@starci/grammar/common.css";\n' });
    assert.deepEqual(globalsOneFindings({ files: noBrand.files, repoRoot: noBrand.root, repo: fe }).map((f) => f.code), ['FE_GLOBALS_IMPORTS_MISSING']);
    const noGrammar = repoOf({ ...APP, 'apps/web/src/app/globals.css': '@import "tailwindcss";\n@import "../modules/brand/brand.css";\n' });
    assert.match(globalsOneFindings({ files: noGrammar.files, repoRoot: noGrammar.root, repo: fe })[0]?.message ?? '', /Grammar stylesheet/u);
    const absent = repoOf(Object.fromEntries(Object.entries(APP).filter(([file]) => !file.endsWith('globals.css'))));
    assert.deepEqual(globalsOneFindings({ files: absent.files, repoRoot: absent.root, repo: fe }).map((f) => [f.code, f.path]), [['FE_GLOBALS_IMPORTS_MISSING', 'apps/web/src/app/globals.css']]);
  });

  test(`FE_STATE_PAGE_NOT_SHARED: a boundary that draws its own page is refused, global-error counts as the error kind`, () => {
    const own = repoOf({
      ...APP,
      'apps/web/src/components/frames/GlobalErrorNotice/index.tsx': EMPTY.replace('Notice =', 'GlobalErrorNotice ='),
      'apps/web/src/app/[locale]/(pages)/not-found.tsx': route('SiteNotFound', '@/components/composites/SiteNotFound'),
      'apps/web/src/components/composites/SiteNotFound/index.tsx': EMPTY.replace('Notice =', 'SiteNotFound ='),
    });
    const findings = statePageFindings({ files: own.files, repoRoot: own.root, repo: fe });
    assert.deepEqual(findings.map((f) => [f.code, f.path, f.kind]), [
      ['FE_STATE_PAGE_NOT_SHARED', 'apps/web/src/app/global-error.tsx', 'error'],
      ['FE_STATE_PAGE_NOT_SHARED', 'apps/web/src/app/[locale]/(pages)/not-found.tsx', 'not-found'],
    ]);
    assert.match(findings[0]?.message ?? '', /R447/u);
  });

  test(`FE_STATE_PAGE_NOT_SHARED: offline pages of one app share one component, and two apps of a front end share the composites`, () => {
    const offline = repoOf({
      ...APP,
      'apps/web/src/app/[locale]/offline/page.tsx': route('OfflineNotice', '@/components/composites/OfflineNotice'),
      'apps/web/src/app/[locale]/(pages)/~offline/page.tsx': route('Other', '@/components/composites/Other'),
      'apps/web/src/components/composites/OfflineNotice/index.tsx': EMPTY.replace('Notice =', 'OfflineNotice ='),
      'apps/web/src/components/composites/Other/index.tsx': EMPTY.replace('Notice =', 'Other ='),
    });
    assert.deepEqual(statePageFindings({ files: offline.files, repoRoot: offline.root, repo: fe }).map((f) => f.kind), ['offline']);
    const apps = repoOf({
      ...APP,
      'apps/landing/src/app/[locale]/not-found.tsx': route('NotFoundNotice', '@/components/composites/NotFoundNotice'),
      'apps/landing/src/components/composites/NotFoundNotice/index.tsx': EMPTY.replace('Notice =', 'LandingNotice ='),
    });
    assert.deepEqual(statePageFindings({ files: apps.files, repoRoot: apps.root, repo: fe }).map((f) => f.path), ['apps/landing/src/app/[locale]/not-found.tsx']);
  });

  test(`FE_STATE_PAGE_GROUP_MISSING: every route group, at any depth, has its own error.tsx and not-found.tsx`, () => {
    const { root, files } = repoOf({
      ...APP,
      'apps/web/src/app/[locale]/(site)/page.tsx': 'export default () => null\n',
      'apps/web/src/app/[locale]/(pages)/workspaces/[id]/(console)/page.tsx': 'export default () => null\n',
      'apps/web/src/app/[locale]/(pages)/workspaces/[id]/(console)/error.tsx': route('ErrorNotice', '@/components/composites/ErrorNotice'),
    });
    const findings = statePageFindings({ files, repoRoot: root, repo: fe });
    assert.deepEqual(findings.map((f) => [f.code, f.path]), [
      ['FE_STATE_PAGE_GROUP_MISSING', 'apps/web/src/app/[locale]/(pages)/workspaces/[id]/(console)/not-found.tsx'],
      ['FE_STATE_PAGE_GROUP_MISSING', 'apps/web/src/app/[locale]/(site)/error.tsx'],
      ['FE_STATE_PAGE_GROUP_MISSING', 'apps/web/src/app/[locale]/(site)/not-found.tsx'],
    ]);
    assert.equal(statePageFindings({ files, repoRoot: root, repo: fe, inScope: () => false }).length, 0);
  });
}

const APP_ROOT = { kind: 'app' };
const BRAND_PATH = 'fe/apps/web/src/modules/brand/brand.css';

test('FE_BRAND_CANVAS_LITERAL: a canvas generator holds no colour; the kit copy and a tokens read are lawful', () => {
  const tokens = renderCanvasTokens(BRAND_PATH, BRAND);
  const { root, files } = repoOf({
    [BRAND_PATH]: BRAND,
    '.starcistacks/canvas/tokens.css': tokens,
    '.starcistacks/canvas/gen/kit/kit-src.html': '<style>.board{background:#efefef}</style>\n',
    '.starcistacks/canvas/gen/10-ok.mjs': 'export const css = ".card{background:var(--surface);color:var(--foreground)} #top{margin:0}";\n',
    '.starcistacks/canvas/gen/20-hex.mjs': 'export const css = ".card{background:#fff}";\n',
    '.starcistacks/canvas/gen/30-named.mjs': 'const row = `<div style="color: red">x</div>`;\n',
    '.starcistacks/canvas/gen/40-class.mjs': 'const a = "bg-[red] p-4";\nconst b = "text-slate-900";\n',
  });
  const findings = canvasBrandFindings({ repoRoot: root, repo: APP_ROOT, isRoot: true, all: files });
  assert.deepEqual(findings.map((f) => [f.code, f.path]), [
    ['FE_BRAND_CANVAS_LITERAL', '.starcistacks/canvas/gen/20-hex.mjs'],
    ['FE_BRAND_CANVAS_LITERAL', '.starcistacks/canvas/gen/30-named.mjs'],
    ['FE_BRAND_CANVAS_LITERAL', '.starcistacks/canvas/gen/40-class.mjs'],
  ]);
  assert.match(findings[0]?.message ?? '', /R445/u);
  assert.equal(canvasBrandFindings({ repoRoot: root, repo: APP_ROOT, isRoot: false, all: files }).length, 0);
  assert.equal(canvasBrandFindings({ repoRoot: root, repo: APP_ROOT, isRoot: true, all: files, inScope: () => false }).length, 0);
  assert.equal(firstColorLiteral('const a = "rgb(0 0 0)"')?.line, 1);
  assert.equal(firstColorLiteral('a { color: var(--red); content: "red"; animation-name: red }'), null);
});

test('FE_BRAND_CANVAS_TOKENS_STALE: tokens.css is the brand file under a stamp; absent, edited or older is refused, and the generator writes it', () => {
  const current = repoOf({ [BRAND_PATH]: BRAND, '.starcistacks/canvas/tokens.css': renderCanvasTokens(BRAND_PATH, BRAND) });
  assert.deepEqual(canvasBrandFindings({ repoRoot: current.root, repo: APP_ROOT, isRoot: true, all: current.files }), []);
  const crlf = repoOf({ [BRAND_PATH]: BRAND, '.starcistacks/canvas/tokens.css': renderCanvasTokens(BRAND_PATH, BRAND).replaceAll('\n', '\r\n') });
  assert.deepEqual(canvasBrandFindings({ repoRoot: crlf.root, repo: APP_ROOT, isRoot: true, all: crlf.files }), []);
  const absent = repoOf({ [BRAND_PATH]: BRAND, '.starcistacks/canvas/design.json': '{}\n' });
  assert.deepEqual(canvasBrandFindings({ repoRoot: absent.root, repo: APP_ROOT, isRoot: true, all: absent.files }).map((f) => f.code), ['FE_BRAND_CANVAS_TOKENS_STALE']);
  const edited = repoOf({ [BRAND_PATH]: BRAND, '.starcistacks/canvas/tokens.css': `${renderCanvasTokens(BRAND_PATH, BRAND)}:root{--bg:#fff}\n` });
  assert.deepEqual(canvasBrandFindings({ repoRoot: edited.root, repo: APP_ROOT, isRoot: true, all: edited.files }).map((f) => f.code), ['FE_BRAND_CANVAS_TOKENS_STALE']);
  const older = repoOf({ [BRAND_PATH]: `${BRAND}.dark { --accent: #000; }\n`, '.starcistacks/canvas/tokens.css': renderCanvasTokens(BRAND_PATH, BRAND) });
  assert.equal(canvasBrandFindings({ repoRoot: older.root, repo: APP_ROOT, isRoot: true, all: older.files }).length, 1);
  assert.equal(canvasBrandFindings({ repoRoot: older.root, repo: APP_ROOT, isRoot: true, all: ['README.md'] }).length, 0);
  // the generator: --check refuses, the plain run writes, then --check passes
  assert.equal(canvasTokensMain(['--check'], older.root), 1);
  assert.equal(canvasTokensMain([], older.root), 0);
  assert.equal(canvasTokensMain(['--check'], older.root), 0);
  assert.deepEqual(canvasBrandFindings({ repoRoot: older.root, repo: APP_ROOT, isRoot: true, all: older.files }), []);
});

/** Every file under a template folder, side-relative with forward slashes. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child); else out.push(child);
    }
  };
  walk('');
  return out.sort();
}

{
  const folder = 'skeleton';
  test(`the front-end template ships the one-source shape: one brand, one globals, shared system-state pages in every route group`, () => {
    const root = path.join(import.meta.dirname, '..', 'templates', 'fe', folder);
    const files = filesUnder(root);
    const fe = { profile: 'fe' };
    assert.deepEqual(brandOneFindings({ files, repo: fe }), []);
    assert.deepEqual(globalsOneFindings({ files, repoRoot: root, repo: fe }), []);
    assert.deepEqual(statePageFindings({ files, repoRoot: root, repo: fe }), []);
    assert.ok(files.some((file) => file.endsWith('src/app/[locale]/(pages)/not-found.tsx')), 'the pages group carries its own not-found.tsx');
  });
}

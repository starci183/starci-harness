// R395 (rules/gallery.mts, scripts/hfs/gallery.mts, scripts/hfs/gallery-explain.mts): every app source repository carries the screenshot gallery - a managed Vite app
// at gallery/ that serves on local.basePort + 50, pins vite and keeps its shots out of git - and every page of it (gallery/pages/<area>/<page>/) carries an explain.md
// that says why each region is drawn that way. A scaffold writes it, `starci app sync` adds it to an existing app, the dev stack starts it next to web and api, and the
// gate names each way it can be missing and each page or region that is not explained.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets, runSync } from '../sync/index.mjs';
import { scaffoldBasePort, scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { galleryParams, galleryPort, declaredBasePort, galleryLocale, galleryTexts, declaredDefaultLocale, GALLERY_LABELS, declaredGalleryHosts, galleryAllowedHosts } from '../runtime/scripts/hfs/gallery.mjs';
import { appGalleryFindings, galleryScreens, GALLERY_FILES, ignoresShots } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { parseExplain, missingFrontMatter, linkTargets, flowList, SHOT_FILES } from '../runtime/scripts/hfs/gallery-explain.mjs';
import { judgedForEnv, localOnlyCodes } from '../runtime/scripts/hfs/check-env.mjs';
import { A15_CODES, FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadLocalConfig, withGallery } from '../stack/local-config.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const PARAMS = galleryParams();
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A fresh starter of `edition` in a temporary folder; its app root. */
function starter(t: TestContext, edition: string): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init }).root;
}
const at = (root: string, ...parts: string[]): string => path.join(root, ...parts);
const read = (root: string, file: string): string => fs.readFileSync(at(root, ...file.split('/')), 'utf8');
const findings = (root: string, all: string[] = [], edition = 'lite') => appGalleryFindings({ repoRoot: root, repo: { kind: 'app', edition } as never, isRoot: true, all });
const SHOT = 'gallery/pages/inbox/today/1440.png';

test('the manifest carries the gallery values once: the folder, the dev script, the +50 offset, a pinned vite, and the slots that own the files', () => {
  assert.deepEqual({ ...PARAMS }, { dir: 'gallery', devScript: 'dev', portOffset: 50, vite: '6.3.5', pages: 'gallery/pages', ignoredShots: 'pages/**/*.png' });
  assert.match(PARAMS.vite, /^\d+\.\d+\.\d+$/u);
  const slots = new Map(loadSlotManifest().slots.map((slot) => [slot.id, slot]));
  assert.equal(slots.get('app.gallery')?.managedBy, 'gallery');
  assert.equal(slots.get('app.gallery')?.presence, 'optional', 'a manifest minor never makes a slot required; the rule is what requires the gallery');
  assert.equal(slots.get('app.gallery-shots')?.tracked, 'ignored');
  assert.equal(slots.get('app.gallery-explain')?.tracked, 'tracked', 'explain.md is source, the PNGs beside it are not');
  assert.equal(galleryPort(3100, PARAMS), 3150);
  assert.equal(galleryPort(3000, PARAMS), 3050);
  assert.equal(galleryPort(null, PARAMS), null);
});

const EXPLAIN_CODES = ['HFS_APP_GALLERY_EXPLAIN_MISSING', 'HFS_APP_GALLERY_REGION_INCOMPLETE', 'HFS_APP_GALLERY_REGION_UNCLEAR', 'HFS_APP_GALLERY_FRONT_MATTER', 'HFS_APP_GALLERY_SCREEN_FILE', 'HFS_APP_GALLERY_LINKS'];

test('the rule is wired: its ten codes ship with the check and its finder runs', () => {
  for (const code of ['HFS_APP_GALLERY_MISSING', 'HFS_APP_GALLERY_SCRIPT', 'HFS_APP_GALLERY_VITE_UNPINNED', 'HFS_APP_GALLERY_SHOTS_TRACKED', ...EXPLAIN_CODES]) assert.ok(A15_CODES.includes(code), code);
  assert.ok(FINDERS.includes(appGalleryFindings));
});

for (const edition of ['lite', 'full']) {
  test(`a ${edition} scaffold writes the gallery on base + 50, pinned, with its shots ignored, and the gate is green`, (t) => {
    const root = starter(t, edition);
    for (const file of GALLERY_FILES) assert.ok(fs.existsSync(at(root, 'gallery', ...file.split('/'))), file);
    const base = edition === 'lite' ? scaffoldBasePort('demo') : 3000;
    const pkg = JSON.parse(read(root, 'gallery/package.json'));
    assert.equal(pkg.name, 'demo-gallery');
    assert.equal(pkg.scripts.dev, `vite --port ${base + 50} --strictPort`);
    assert.equal(pkg.devDependencies.vite, PARAMS.vite);
    assert.match(read(root, 'gallery/index.html'), /<title>Th\u01b0 vi\u1ec7n \u1ea3nh demo<\/title>/u, 'the starter default locale is vi');
    assert.match(read(root, 'gallery/README.md'), new RegExp(`http://localhost:${base + 50}`, 'u'));
    assert.match(read(root, '.gitignore'), /^gallery\/pages\/\*\*\/\*\.png$/mu);
    assert.deepEqual(findings(root, [], edition), []);
  });
}

test('the shipped gallery is a thin config over @starci/gallery: one vite.config.js, no page code, the package pinned like the other harness packages', (t) => {
  const root = starter(t, 'lite');
  const config = read(root, 'gallery/vite.config.js');
  assert.match(config, /import \{ defineGallery \} from "@starci\/gallery\/vite"/u);
  assert.match(config, /app: "demo"/u);
  assert.match(config, /locale: "vi"/u);
  assert.match(config, /allowedHosts: \[\]/u);
  assert.match(read(root, 'gallery/index.html'), /src="\/@starci-gallery\/main\.js"/u, "the entry is the package's");
  for (const file of GALLERY_FILES) assert.doesNotMatch(read(root, `gallery/${file}`), /\{\{/u, `no template variable leaks into ${file}`);
  assert.equal(fs.existsSync(at(root, 'gallery', 'src')), false, 'no app code per page');
  const pin = (bundledPins()['@starci/gallery'] as { version: string }).version;
  assert.equal(JSON.parse(read(root, 'gallery/package.json')).devDependencies['@starci/gallery'], pin);
});

test('no gallery at all is HFS_APP_GALLERY_MISSING and names the sync that writes it', (t) => {
  const root = starter(t, 'lite');
  fs.rmSync(at(root, 'gallery'), { recursive: true });
  const [missing, ...rest] = findings(root);
  assert.equal(missing?.code, 'HFS_APP_GALLERY_MISSING');
  assert.equal(missing?.level, 'error');
  assert.match(missing?.message ?? '', /starci app sync --execute/u);
  assert.match(missing?.message ?? '', /port \d+50\b/u);
  assert.deepEqual(rest.map((finding) => finding.code), [], 'the missing folder is one finding, not four');
});

test('one missing managed file is named', (t) => {
  const root = starter(t, 'lite');
  fs.rmSync(at(root, 'gallery', 'vite.config.js'));
  const [missing] = findings(root);
  assert.equal(missing?.code, 'HFS_APP_GALLERY_MISSING');
  assert.match(missing?.message ?? '', /missing gallery\/vite\.config\.js/u);
});

test('a dev script off base + 50, without --strictPort or absent is HFS_APP_GALLERY_SCRIPT', (t) => {
  const root = starter(t, 'lite');
  const file = at(root, 'gallery', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = scaffoldBasePort('demo');
  const withScript = (script: string | undefined) => {
    const scripts = { ...pkg.scripts, dev: script };
    if (script === undefined) delete scripts.dev;
    fs.writeFileSync(file, JSON.stringify({ ...pkg, scripts }));
    return findings(root);
  };
  const wrongPort = withScript(`vite --port ${base + 51} --strictPort`);
  assert.deepEqual(wrongPort.map((finding) => finding.code), ['HFS_APP_GALLERY_SCRIPT']);
  assert.match(wrongPort[0]?.message ?? '', new RegExp(`serves on ${base + 51}, not ${base + 50} \\(local\\.basePort \\+ 50\\)`, 'u'));
  assert.match(withScript(`vite --port ${base + 50}`)[0]?.message ?? '', /lacks --strictPort/u);
  assert.match(withScript('vite')[0]?.message ?? '', /names no --port/u);
  assert.match(withScript(undefined)[0]?.message ?? '', /declares no "dev" script/u);
  assert.deepEqual(withScript(`vite --port=${base + 50} --strictPort`), [], '--port=N is the same flag');
});

test('vite must be an exact version: a range, a tag or none is HFS_APP_GALLERY_VITE_UNPINNED', (t) => {
  const root = starter(t, 'lite');
  const file = at(root, 'gallery', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const withVite = (vite: string | undefined) => {
    fs.writeFileSync(file, JSON.stringify({ ...pkg, devDependencies: vite === undefined ? {} : { vite } }));
    return findings(root);
  };
  for (const loose of ['^6.3.5', '~6.3.5', '6', '6.x', 'latest', '>=6']) {
    const [finding, ...rest] = withVite(loose);
    assert.equal(finding?.code, 'HFS_APP_GALLERY_VITE_UNPINNED', loose);
    assert.match(finding?.message ?? '', /not an exact version/u);
    assert.equal(rest.length, 0);
  }
  assert.match(withVite(undefined)[0]?.message ?? '', /not a devDependency/u);
  assert.deepEqual(withVite('7.0.0-beta.1'), [], 'an exact prerelease is still a pin');
});

test('shots that are not ignored, or are tracked, are HFS_APP_GALLERY_SHOTS_TRACKED', (t) => {
  const root = starter(t, 'lite');
  const ignore = at(root, '.gitignore');
  const original = fs.readFileSync(ignore, 'utf8');
  fs.writeFileSync(ignore, original.replace('gallery/pages/**/*.png\n', ''));
  const open = findings(root);
  assert.deepEqual(open.map((finding) => finding.code), ['HFS_APP_GALLERY_SHOTS_TRACKED']);
  assert.match(open[0]?.message ?? '', /gallery\/pages\/\*\*\/\*\.png is not git-ignored/u);
  fs.writeFileSync(ignore, original);
  const tracked = findings(root, [SHOT, 'gallery/pages/inbox/today/390.png', 'gallery/pages/inbox/today/explain.md']);
  assert.deepEqual(tracked.map((finding) => finding.code), ['HFS_APP_GALLERY_SHOTS_TRACKED']);
  assert.equal(tracked[0]?.path, SHOT);
  assert.match(tracked[0]?.message ?? '', /2 screenshot PNGs are tracked/u);
});

test('the reference layout passes too: a gallery/.gitignore that ignores the shots instead of the root block', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-ignore-'));
  try {
    for (const text of ['pages/**/*.png\n', '/pages/**/*.png\n', 'node_modules\ndist\npages/**/*.png\n']) assert.equal(ignoresShots(text, PARAMS, true), true, text);
    for (const text of ['gallery/pages/**/*.png\n', '/gallery/pages/**/*.png\n', '**/*.png\n']) assert.equal(ignoresShots(text, PARAMS, false), true, text);
    for (const text of ['# pages/**/*.png\n', '!pages/**/*.png\n', 'pages/*.jpg\n', 'pages/\n', 'gallery/pages/\n', 'dist\n', '']) assert.equal(ignoresShots(text, PARAMS, true), false, text);
    assert.equal(ignoresShots('pages/**/*.png\n', PARAMS, false), false, 'a nested pattern does nothing in the root file');
    assert.equal(ignoresShots('gallery/pages/\n', PARAMS, false), false, 'ignoring the whole pages folder would hide the explain.md files too');
    assert.equal(ignoresShots(null, PARAMS, false), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an app that declares no basePort cannot get a gallery port: the gate asks for the base, never guesses', (t) => {
  const root = starter(t, 'lite');
  const stack = at(root, '.starcistacks', 'application-stacks.yaml');
  fs.writeFileSync(stack, read(root, '.starcistacks/application-stacks.yaml').replace(/^\s+basePort: \d+\n/mu, ''));
  assert.equal(declaredBasePort(parseYaml(read(root, '.starcistacks/application-stacks.yaml'))), null);
  const [finding] = findings(root);
  assert.equal(finding?.code, 'HFS_APP_GALLERY_SCRIPT');
  assert.match(finding?.message ?? '', /declares no local\.basePort/u);
  fs.rmSync(at(root, 'gallery'), { recursive: true });
  assert.match(findings(root)[0]?.message ?? '', /declare environments\.dev\.local\.basePort/u);
});

test('only an app root of an edition is judged', (t) => {
  const root = starter(t, 'lite');
  fs.rmSync(at(root, 'gallery'), { recursive: true });
  assert.deepEqual(appGalleryFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' } as never, isRoot: false }), []);
  assert.deepEqual(appGalleryFindings({ repoRoot: root, repo: { kind: 'be', edition: 'lite' } as never, isRoot: true }), []);
});

test('app sync adds the gallery to an existing app, restores a hand edit, and a second run changes nothing', async (t) => {
  const root = starter(t, 'lite');
  const gallery = at(root, 'gallery');
  const before = read(root, 'gallery/package.json');
  fs.rmSync(gallery, { recursive: true });
  const lines: string[] = [];
  const out = (line: string): void => { lines.push(line); };
  assert.equal(await runSync(['--cwd', root], { cwd: root, out, presets: bundledPresets() }), 1, 'a dry run reports the gallery as drift');
  assert.ok(lines.some((line) => line.includes('gallery/package.json')), lines.join('\n'));
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets() }), 0);
  assert.equal(read(root, 'gallery/package.json'), before);
  for (const file of GALLERY_FILES) assert.ok(fs.existsSync(at(gallery, ...file.split('/'))), file);
  fs.writeFileSync(at(gallery, 'package.json'), before.replace('--strictPort', ''));
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets() }), 0);
  assert.equal(read(root, 'gallery/package.json'), before, 'sync restores the managed file');
  lines.length = 0;
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets() }), 0);
  assert.match(lines.at(-1) ?? '', /0 written/u);
  assert.deepEqual([...new Set(codes(findings(root)))], ['HFS_APP_GALLERY_ROUTE_MISSING'], 'sync writes the app, never its screens: an app that had no gallery/pages has every route to cover (PROJECT-GALLERY-4)');
});

test('the dev stack starts the gallery on base + 50 next to web and api, with its install, a readiness row and an origin', (t) => {
  const root = starter(t, 'lite');
  const base = scaffoldBasePort('demo');
  const local = loadLocalConfig({ repoRoot: root, env: 'dev' });
  const gallery = local.processes.find((run) => run.name === 'gallery');
  assert.deepEqual(local.processes.map((run) => run.name), ['api', 'web', 'gallery']);
  assert.equal(local.ports['gallery'], base + 50);
  assert.deepEqual({ argv: gallery?.argv, cwd: gallery?.cwd, port: gallery?.port }, { argv: ['npm', 'run', 'dev'], cwd: 'gallery', port: 'gallery' });
  assert.equal(gallery?.health?.url, 'http://127.0.0.1:${port.gallery}/');
  const install = local.setup.find((run) => run.name === 'gallery-install');
  assert.deepEqual({ argv: install?.argv, cwd: install?.cwd, skip: install?.skipIfExists, heavy: install?.heavy }, { argv: ['npm', 'install', '--no-audit', '--no-fund'], cwd: 'gallery', skip: 'node_modules', heavy: 'install' });
  assert.ok(local.ready.some((row) => row.name === 'gallery-live' && row.url === 'http://127.0.0.1:${port.gallery}/'));
  assert.ok(local.origins.some((origin) => origin.name === 'gallery'));
  assert.equal(local.ports['web'], base);
  assert.equal(local.ports['api'], base + 1);
});

const STACK_FILE = '.starcistacks/application-stacks.yaml';
/** Declares the gallery route (and an api route beside it) on the dev tunnel of a starter, right after its `basePort:` line. */
const declareGalleryHost = (root: string, host: string): void => {
  const file = at(root, ...STACK_FILE.split('/'));
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/u);
  const index = lines.findIndex((line) => /^\s+basePort:/u.test(line));
  const pad = /^\s*/u.exec(lines[index] as string)![0];
  lines.splice(index + 1, 0, `${pad}tunnel:`, `${pad}  name: demo-dev`, `${pad}  routes:`, `${pad}    - {name: gallery, host: ${host}, port: gallery}`);
  fs.writeFileSync(file, lines.join('\n'));
};

test('the declared gallery hosts are the hosts of the routes named gallery, sorted; none is []', () => {
  const doc = parseYaml('environments:\n  dev:\n    runtime: docker-compose\n    local:\n      basePort: 3100\n      tunnel:\n        name: t\n        routes:\n          - {name: web, host: web.example.org, port: web}\n          - {name: gallery, host: b-gallery.example.org, port: gallery}\n  prod:\n    runtime: swarm\n');
  assert.deepEqual(declaredGalleryHosts(doc), ['b-gallery.example.org']);
  assert.deepEqual(declaredGalleryHosts({ environments: { dev: { runtime: 'docker-compose', local: { basePort: 3100 } } } }), []);
  assert.deepEqual(declaredGalleryHosts(null), []);
  assert.equal(galleryAllowedHosts([]), '[]');
  assert.equal(galleryAllowedHosts(['a.example.org']), '["a.example.org"]');
});

for (const edition of ['lite', 'full'] as const) {
  test(`a ${edition} app that declares a gallery tunnel host gets it in server.allowedHosts and a bind the tunnel reaches, and the stack routes it to the gallery port`, async (t) => {
    const root = starter(t, edition);
    const out = (): void => {};
    const run = async (...args: string[]): Promise<number> => runSync([...args, '--cwd', root], { cwd: root, out, presets: bundledPresets() });
    assert.match(read(root, 'gallery/vite.config.js'), /127\.0\.0\.1/u, 'the config says why the bind is the IPv4 loopback, which defineGallery sets (packages/gallery vite.spec.ts)');
    assert.match(read(root, 'gallery/vite.config.js'), /allowedHosts: \[\]/u, 'no declared host, no extra host');
    assert.doesNotMatch(read(root, 'gallery/vite.config.js'), /\{\{/u);
    declareGalleryHost(root, 'demo-gallery-dev.example.org');
    assert.equal(await run(), 1, 'a declared host the config does not carry is drift');
    assert.equal(await run('--execute'), 0);
    assert.match(read(root, 'gallery/vite.config.js'), /allowedHosts: \["demo-gallery-dev\.example\.org"\]/u);
    assert.equal(await run(), 0, 'a second run changes nothing');
    const local = loadLocalConfig({ repoRoot: root, env: 'dev' });
    assert.deepEqual(local.tunnel?.routes, [{ name: 'gallery', host: 'demo-gallery-dev.example.org', port: 'gallery' }]);
    assert.equal(local.ports['gallery'], galleryPort(local.basePort, PARAMS), 'the route reaches the derived gallery port');
    fs.rmSync(at(root, 'gallery'), { recursive: true });
    assert.throws(() => loadLocalConfig({ repoRoot: root, env: 'dev' }), /STACK_LOCAL_TUNNEL_GALLERY|serves no gallery/u, 'a gallery route with no gallery is refused');
  });
}

test('the gallery route names the gallery port and needs a base port; any other route still names a declared port', () => {
  const base = { basePort: 3100, ports: { db: 54322, web: 3100 }, services: [{ name: 'db', wait: 'healthy' }], processes: [{ name: 'web', argv: ['node', 'x.js'], port: 'web' }] };
  const route = (entry: object, extra: object = {}) => normalizeLocal({ ...base, ...extra, tunnel: { name: 'demo-dev', routes: [entry] } }, { project: 'demo', env: 'dev' });
  assert.ok(route({ name: 'gallery', host: 'g.example.org', port: 'gallery' }).config, 'port gallery without a declared port');
  assert.match(JSON.stringify(route({ name: 'gallery', host: 'g.example.org', port: 'web' }).problems), /gallery route's port is gallery/u);
  assert.match(JSON.stringify(route({ name: 'gallery', host: 'g.example.org', port: 'gallery' }, { basePort: undefined }).problems), /needs local\.basePort/u);
  assert.match(JSON.stringify(route({ name: 'site', host: 's.example.org', port: 'gallery' }).problems), /not a declared port/u);
});

test('the gallery process joins only an app that has a gallery and a base port, and never replaces one the app declares', (t) => {
  const root = starter(t, 'lite');
  const raw = { basePort: 3100, ports: { db: 54322, web: 3100 }, services: [{ name: 'db', wait: 'healthy' }], processes: [{ name: 'web', argv: ['node', 'x.js'], port: 'web' }] };
  const parsed = normalizeLocal(raw, { project: 'demo', env: 'dev' }).config!;
  assert.deepEqual(withGallery(parsed, root).processes.map((run) => run.name), ['web', 'gallery']);
  assert.equal(withGallery(parsed, root).ports['gallery'], 3150);
  const noBase = normalizeLocal({ ...raw, basePort: undefined }, { project: 'demo', env: 'dev' }).config!;
  assert.equal(withGallery(noBase, root), noBase, 'no base port, no gallery port');
  const own = normalizeLocal({ ...raw, ports: { ...raw.ports, gallery: 3999 }, processes: [...raw.processes, { name: 'gallery', argv: ['node', 'own.js'], port: 'gallery' }] }, { project: 'demo', env: 'dev' }).config!;
  assert.equal(withGallery(own, root), own, 'a declared gallery process is kept');
  const taken = normalizeLocal({ ...raw, ports: { ...raw.ports, other: 3150 } }, { project: 'demo', env: 'dev' }).config!;
  assert.equal(withGallery(taken, root), taken, 'a port already declared by the app is never reused');
  fs.rmSync(at(root, 'gallery'), { recursive: true });
  assert.equal(withGallery(parsed, root), parsed, 'no gallery folder, no process');
});

for (const edition of ['lite', 'full']) {
  test(`the whole check of a fresh ${edition} starter finds nothing wrong with the gallery folder: no placement, doc-path, slot or drift finding`, (t) => {
    const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-check-'));
    t.after(() => fs.rmSync(into, { recursive: true, force: true }));
    const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
    assert.ok(files.includes('gallery/package.json'));
    const mine = checkRepo({ repoRoot: root, harness: HARNESS, files }).findings.filter((finding) => /^gallery(?:\/|$)/u.test(finding.path ?? '') || /GALLERY/u.test(finding.code));
    assert.deepEqual(mine.map((finding) => `${finding.code} ${finding.path}`), []);
  });
}

// The gallery's words follow the app's default locale (its i18n routing source): vi renders Vietnamese, en renders English, en is the fallback.
const ROUTING = { lite: 'fe/apps/web/src/modules/i18n/routing.ts', full: 'fe/packages/demo-i18n/src/routing.ts' } as const;
const setDefaultLocale = (root: string, edition: 'lite' | 'full', locale: string): void => {
  const file = at(root, ...ROUTING[edition].split('/'));
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(DEFAULT_LOCALE[^=\n]*= )"[a-z]+"/u, `$1"${locale}"`));
};

test('the gallery language is the default locale of the app: vi and en have a table, anything else falls back to en', () => {
  assert.equal(galleryLocale('vi'), 'vi');
  assert.equal(galleryLocale('vi-VN'), 'vi');
  assert.equal(galleryLocale('EN'), 'en');
  assert.equal(galleryLocale('fr'), 'en');
  assert.equal(galleryLocale(null), 'en');
  assert.equal(galleryLocale(undefined), 'en');
  assert.equal(declaredDefaultLocale('export const DEFAULT_LOCALE: X["defaultLocale"] = "vi"\n'), 'vi');
  assert.equal(declaredDefaultLocale("defineI18n({ locales: LOCALES, defaultLocale: 'en' })"), 'en');
  assert.equal(declaredDefaultLocale('export const nothing = 1'), null);
  for (const locale of Object.keys(GALLERY_LABELS)) assert.deepEqual(Object.keys(GALLERY_LABELS[locale] ?? {}).sort(), Object.keys(GALLERY_LABELS['en'] ?? {}).sort(), `${locale} has every label`);
  assert.notEqual(galleryTexts('vi', 'demo', 3050)['galleryTitle'], galleryTexts('en', 'demo', 3050)['galleryTitle']);
});

for (const edition of ['lite', 'full'] as const) {
  test(`a ${edition} app whose default locale is vi gets a Vietnamese gallery, one whose is en an English one, and sync switches between them`, async (t) => {
    const root = starter(t, edition);
    const out = (): void => {};
    const run = async (...args: string[]): Promise<number> => runSync([...args, '--cwd', root], { cwd: root, out, presets: bundledPresets() });
    // the scaffold default is vi
    assert.equal(read(root, 'gallery/index.html').includes('<html lang="vi">'), true);
    assert.match(read(root, 'gallery/index.html'), /<title>Th\u01b0 vi\u1ec7n \u1ea3nh demo<\/title>/u);
    assert.match(read(root, 'gallery/vite.config.js'), /locale: "vi"/u, "the app words are the package's, chosen by this locale");
    assert.match(read(root, 'gallery/README.md'), /^# Th\u01b0 vi\u1ec7n \u1ea3nh demo$/mu);
    assert.match(read(root, 'gallery/README.md'), /http:\/\/localhost:\d+ \(c\u1ed5ng g\u1ed1c/u);
    assert.doesNotMatch(read(root, 'gallery/README.md'), /\{\w+\}|\{\{/u);
    assert.equal(await run(), 0, 'the vi gallery is in sync with the vi app');
    // the app moves to en: the managed vi files drift per locale and sync renders the English ones
    setDefaultLocale(root, edition, 'en');
    assert.equal(await run(), 1, 'a vi gallery under an en app is drift');
    assert.equal(await run('--execute'), 0);
    assert.equal(read(root, 'gallery/index.html').includes('<html lang="en">'), true);
    assert.match(read(root, 'gallery/index.html'), /<title>demo gallery<\/title>/u);
    assert.match(read(root, 'gallery/vite.config.js'), /locale: "en"/u);
    assert.match(read(root, 'gallery/README.md'), /^# demo gallery$/mu);
    assert.equal(await run(), 0);
    // a locale without a table falls back to en
    setDefaultLocale(root, edition, 'fr');
    assert.equal(await run(), 0, 'fr has no table, so the English gallery stays in sync');
    assert.deepEqual(findings(root, [], edition), []);
  });
}

// ---- the explanation of every page (PROJECT-GALLERY-2) ----

const EXPLAIN_OK = [
  '---', 'title: Inbox today', 'route: /inbox/today', 'area: inbox', '---', '',
  'Intro line.', '',
  '## Input on the pink well',
  'Vì sao: a single field is not a group, so no card (flat-fields law).',
  'Luật: flat-fields.',
  'Grammar: `Field` + `TextField`, story Form/Basic.', '',
  '## Header band',
  '- **Vì sao:** the band never scrolls away;',
  '  text flush left.',
  '- **Luật:** page-header-left.',
  '- **Grammar:** `Page` `header`.', '',
].join('\n');
/** Writes `gallery/pages/<area>/<page>/` with `shots` PNG names and, when `explain` is a string, its explain.md; returns the page folder. */
function page(root: string, area: string, name: string, shots: string[], explain: string | null): string {
  const dir = at(root, 'gallery', 'pages', area, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const shot of shots) {
    fs.mkdirSync(path.dirname(at(dir, ...shot.split('/'))), { recursive: true });
    fs.writeFileSync(at(dir, ...shot.split('/')), 'png');
  }
  if (explain !== null) fs.writeFileSync(at(dir, 'explain.md'), explain);
  return dir;
}
const codes = (list: { code: string }[]): string[] => list.map((finding) => finding.code);

test('explain.md is read as front matter and regions: the three lines, bullets, bold, wrapped values and the verdict words', () => {
  const parsed = parseExplain(EXPLAIN_OK);
  assert.deepEqual(parsed.meta, { title: 'Inbox today', route: '/inbox/today', area: 'inbox' });
  assert.equal(parsed.intro, 'Intro line.');
  assert.deepEqual(parsed.regions.map((region) => region.name), ['Input on the pink well', 'Header band']);
  assert.equal(parsed.regions[1]?.fields['Vì sao'], 'the band never scrolls away; text flush left.');
  assert.equal(parsed.regions[1]?.fields['Grammar'], '`Page` `header`.');
  assert.deepEqual(parsed.regions.flatMap((region) => region.problems), []);
  assert.deepEqual(missingFrontMatter(parsed), []);
  assert.deepEqual(missingFrontMatter(parseExplain('# Only a title\n## R\nVì sao: x\nGrammar: y')), ['title', 'route', 'area']);
  const verdicts = parseExplain('## A\nVì sao: CHƯA RÕ\nGrammar: `X`\n## B\nVì sao: SAI, the law says flat\nGrammar: `X`\n## C\nVì sao: sai lệch is a word, not a verdict\nGrammar: `X`\n## D\nVì sao: ok\nGrammar:\n## E\nLuật: only a law');
  assert.deepEqual(verdicts.regions.map((region) => region.problems), [
    [{ kind: 'unclear', field: 'Vì sao' }], [{ kind: 'unclear', field: 'Vì sao' }], [],
    [{ kind: 'missing', field: 'Grammar' }], [{ kind: 'missing', field: 'Vì sao' }, { kind: 'missing', field: 'Grammar' }],
  ]);
  assert.deepEqual(parseExplain('## A\nV\u0069\u0300 sao: decomposed accents\nGrammar: `X`').regions[0]?.problems, [], 'a decomposed Vì is the same word');
  assert.deepEqual([...SHOT_FILES], ['1440.png', '390.png']);
  assert.deepEqual(linkTargets([{ to: 'a/b', x: 0 }, { to: 'c/d' }]), ['a/b', 'c/d']);
  assert.deepEqual(linkTargets({ links: [{ to: 'a/b' }] }), ['a/b']);
  for (const bad of [{}, 'x', [{ to: 3 }], [{ x: 1 }], [{ to: '' }], null]) assert.equal(linkTargets(bad), null, JSON.stringify(bad));
  assert.deepEqual(flowList({ login: ['a/b', 'c/d'] }), [{ name: 'login', screens: ['a/b', 'c/d'] }]);
  assert.deepEqual(flowList([{ name: 'x', screens: ['a/b'] }]), [{ name: 'x', screens: ['a/b'] }]);
  for (const bad of [[{ name: 'x' }], { x: 'a/b' }, { x: [3] }, 'x', null]) assert.equal(flowList(bad), null, JSON.stringify(bad));
});

// The reader of @starci/gallery (packages/gallery/src/explain.ts, built to dist) and the gate's reader answer alike over the same texts. Needs the package built (`npm run build` in packages/gallery).
const GALLERY_DIST = new URL('../../gallery/dist/explain.js', import.meta.url);
test('the gallery package reads explain.md, links and flows as the gate does: both answer alike over the same texts', { skip: !fs.existsSync(GALLERY_DIST) && 'packages/gallery is not built' }, async () => {
  const pkg = (await import(GALLERY_DIST.href)) as { parseExplain: typeof parseExplain; linkList: (json: unknown) => { to: string }[]; flowList: (json: unknown) => { name: string; screens: string[] }[]; SHOT_WIDTHS: string[] };
  const texts = [EXPLAIN_OK, '## A\nVì sao: CHƯA RÕ\nGrammar: x', '## A\r\nVì sao: SAI\r\nGrammar: `X`\r\n## B\r\nVì sao: fine', '---\ntitle: "Quoted"\n---\n## A\nGrammar: `X`', '', 'no regions at all'];
  for (const text of texts) assert.deepEqual(pkg.parseExplain(text), parseExplain(text), text.slice(0, 30));
  assert.deepEqual(pkg.SHOT_WIDTHS.map((width) => `${width}.png`).sort(), [...SHOT_FILES].sort());
  for (const json of [[{ to: 'a/b' }], { links: [{ to: 'a/b', x: 1 }] }, {}, [{ to: 1 }], null]) assert.deepEqual(pkg.linkList(json).map((link) => link.to), linkTargets(json) ?? [], JSON.stringify(json));
  for (const json of [{ a: ['x/y'] }, [{ name: 'a', screens: ['x/y'] }], { a: 'x/y' }, [{ name: 'a' }], null]) assert.deepEqual(pkg.flowList(json), flowList(json) ?? [], JSON.stringify(json));
});

test('a screen folder with shots and no explain.md is HFS_APP_GALLERY_EXPLAIN_MISSING, in the work tree where the shots are', (t) => {
  const root = starter(t, 'lite');
  page(root, 'inbox', 'today', ['1440.png', '390.png'], null);
  page(root, 'inbox', 'empty-folder', [], null);
  const [finding, ...rest] = findings(root);
  assert.equal(finding?.code, 'HFS_APP_GALLERY_EXPLAIN_MISSING');
  assert.equal(finding?.level, 'error');
  assert.equal(finding?.path, 'gallery/pages/inbox/today/explain.md');
  assert.match(finding?.message ?? '', /has 2 shots and no explain\.md/u);
  assert.deepEqual(rest, [], 'a folder with no shot needs none yet');
  assert.deepEqual(galleryScreens(root, PARAMS).screens.filter((screen) => screen.area === 'inbox'), [{ area: 'inbox', screen: 'empty-folder', shots: 0, stray: [] }, { area: 'inbox', screen: 'today', shots: 2, stray: [] }]);
  page(root, 'inbox', 'today', [], EXPLAIN_OK);
  assert.deepEqual(findings(root), []);
  assert.deepEqual(findings(root, [], 'full'), []);
});

test('a region without Vì sao or Grammar is HFS_APP_GALLERY_REGION_INCOMPLETE, and so is a file with no region', (t) => {
  const root = starter(t, 'lite');
  const meta = '---\ntitle: T\nroute: /r\narea: inbox\n---\n';
  page(root, 'inbox', 'today', ['1440.png'], `${meta}## Header\nVì sao: because\nLuật: l\n## Body\nGrammar: \`Card\`\n## Footer\nLuật: only\n`);
  const [finding, ...rest] = findings(root);
  assert.equal(finding?.code, 'HFS_APP_GALLERY_REGION_INCOMPLETE');
  assert.equal(finding?.level, 'error');
  assert.match(finding?.message ?? '', /3 regions of gallery\/pages\/inbox\/today\/explain\.md lack a value: Header lacks Grammar; Body lacks Vì sao; Footer lacks Vì sao and Grammar/u);
  assert.deepEqual(rest, []);
  page(root, 'inbox', 'today', [], `${meta}Just prose, no region.\n`);
  const none = findings(root);
  assert.deepEqual(codes(none), ['HFS_APP_GALLERY_REGION_INCOMPLETE']);
  assert.match(none[0]?.message ?? '', /has no "## <region name>"/u);
  page(root, 'inbox', 'today', [], `${meta}## Header\nVì sao: because\nGrammar: \`Page\`\n`);
  assert.deepEqual(findings(root), []);
});

test('CHƯA RÕ and SAI are a bug the author has not fixed: they block in --env prod and are only reported in --env local', (t) => {
  const root = starter(t, 'lite');
  page(root, 'inbox', 'today', ['1440.png'], '---\ntitle: T\nroute: /r\narea: inbox\n---\n## Header\nVì sao: CHƯA RÕ\nGrammar: `Page`\n## Body\nVì sao: SAI: it is a card\nGrammar: `Card`\n## Fine\nVì sao: l\nGrammar: `X`\n');
  const [finding, ...rest] = findings(root);
  assert.equal(finding?.code, 'HFS_APP_GALLERY_REGION_UNCLEAR');
  assert.match(finding?.message ?? '', /2 regions of .* say CHƯA RÕ or SAI \("Header", "Body"\)/u);
  assert.deepEqual(rest, []);
  assert.ok(localOnlyCodes().has('HFS_APP_GALLERY_REGION_UNCLEAR'), 'the catalog marks the code localOnly');
  assert.equal(localOnlyCodes().has('HFS_APP_GALLERY_EXPLAIN_MISSING'), false, 'a missing explain.md blocks everywhere');
  assert.equal(localOnlyCodes().has('HFS_APP_GALLERY_REGION_INCOMPLETE'), false);
  assert.equal(judgedForEnv([finding!], 'local')[0]?.report, true, 'local: reported, not blocking');
  assert.equal(judgedForEnv([finding!], 'prod')[0]?.report, undefined, 'prod: blocking');
});

test('a front matter that lacks title, route or area, or names another area than its folder, is a warning', (t) => {
  const root = starter(t, 'lite');
  const body = '## Header\nVì sao: because\nGrammar: `Page`\n';
  page(root, 'inbox', 'today', ['1440.png'], `---\ntitle: T\n---\n${body}`);
  const [finding, ...rest] = findings(root);
  assert.deepEqual({ code: finding?.code, level: finding?.level }, { code: 'HFS_APP_GALLERY_FRONT_MATTER', level: 'warning' });
  assert.match(finding?.message ?? '', /lacks route, area/u);
  assert.deepEqual(rest, []);
  page(root, 'inbox', 'today', [], `---\ntitle: T\nroute: /r\narea: billing\n---\n${body}`);
  assert.match(findings(root)[0]?.message ?? '', /its area "billing" is not the folder's "inbox"/u);
  page(root, 'inbox', 'today', [], body);
  assert.deepEqual(codes(findings(root)), ['HFS_APP_GALLERY_FRONT_MATTER']);
});

test('the explanation is judged from the tracked explain.md even when CI has no shots, and a scoped run skips pages outside its scope', (t) => {
  const root = starter(t, 'lite');
  page(root, 'inbox', 'today', [], '---\ntitle: T\nroute: /r\narea: inbox\n---\n## Header\nVì sao: CHƯA RÕ\nGrammar: `Page`\n');
  assert.deepEqual(codes(findings(root)), ['HFS_APP_GALLERY_REGION_UNCLEAR']);
  const scoped = appGalleryFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' } as never, isRoot: true, inScope: (file) => !file.includes('/inbox/') });
  assert.deepEqual(scoped, []);
});

for (const edition of ['lite', 'full'] as const) {
  test(`a ${edition} starter's whole check has no placement or doc finding for gallery pages with an explanation`, (t) => {
    const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-pages-'));
    t.after(() => fs.rmSync(into, { recursive: true, force: true }));
    const { root, files: scaffolded } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
    page(root, 'inbox', 'today', ['1440.png', '390.png'], EXPLAIN_OK);
    const files = ['gallery/pages/inbox/today/explain.md'];
    const mine = checkRepo({ repoRoot: root, harness: HARNESS, files: [...scaffolded, ...files] }).findings.filter((finding) => /^gallery(?:\/|$)/u.test(finding.path ?? '') || /GALLERY/u.test(finding.code));
    assert.deepEqual(mine.map((finding) => `${finding.code} ${finding.path}`), []);
  });
}

test('a screen folder holds only the two widths, explain.md and links.json: a variant name, a before folder or any other file is HFS_APP_GALLERY_SCREEN_FILE', (t) => {
  const root = starter(t, 'lite');
  page(root, 'inbox', 'today', ['1440.png', '1440-open.png', 'sales-1440.png', 'before/1440.png', 'notes.txt', 'sub/390.png', '1920.png'], EXPLAIN_OK);
  const [finding, ...rest] = findings(root);
  assert.equal(finding?.code, 'HFS_APP_GALLERY_SCREEN_FILE');
  assert.equal(finding?.level, 'error');
  assert.equal(finding?.path, 'gallery/pages/inbox/today');
  for (const name of ['1440-open.png', 'sales-1440.png', 'before/', 'notes.txt', 'sub/', '1920.png']) assert.match(finding?.message ?? '', new RegExp(`"${name.replace('.', '\\.')}"`, 'u'), name);
  assert.doesNotMatch(finding?.message ?? '', /"1440\.png"/u);
  assert.deepEqual(rest, []);
  assert.equal(galleryScreens(root, PARAMS).screens.find((screen) => screen.area === 'inbox')?.shots, 1, 'only the allowed shot is counted');
  const variant = page(root, 'inbox', 'today', [], EXPLAIN_OK);
  fs.rmSync(at(variant, 'before'), { recursive: true });
  for (const name of ['1440-open.png', 'sales-1440.png', 'notes.txt', '1920.png']) fs.rmSync(at(variant, name));
  fs.rmSync(at(variant, 'sub'), { recursive: true });
  assert.deepEqual(findings(root), []);
  page(root, 'inbox', 'today-open', ['1440.png', '390.png'], EXPLAIN_OK);
  assert.deepEqual(findings(root), [], 'the open state is its own screen folder');
});

test('a file straight in pages/ or in an area folder is outside a screen folder; dot files are ignored', (t) => {
  const root = starter(t, 'lite');
  page(root, 'inbox', 'today', ['1440.png'], EXPLAIN_OK);
  fs.writeFileSync(at(root, 'gallery', 'pages', 'README.md'), 'x');
  fs.writeFileSync(at(root, 'gallery', 'pages', 'inbox', '1440.png'), 'png');
  fs.writeFileSync(at(root, 'gallery', 'pages', 'inbox', '.gitkeep'), '');
  const found = findings(root);
  assert.deepEqual(found.map((finding) => `${finding.code} ${finding.path}`), ['HFS_APP_GALLERY_SCREEN_FILE gallery/pages/inbox/1440.png', 'HFS_APP_GALLERY_SCREEN_FILE gallery/pages/README.md']);
});

test('links.json and flows.json name existing screen folders; a malformed or dangling one is HFS_APP_GALLERY_LINKS', (t) => {
  const root = starter(t, 'lite');
  const today = page(root, 'inbox', 'today', ['1440.png'], EXPLAIN_OK);
  page(root, 'inbox', 'detail', ['1440.png'], EXPLAIN_OK);
  fs.writeFileSync(at(today, 'links.json'), JSON.stringify([{ to: 'inbox/detail', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }]));
  fs.writeFileSync(at(root, 'gallery', 'flows.json'), JSON.stringify({ open: ['inbox/today', 'inbox/detail'] }));
  assert.deepEqual(findings(root), [], 'resolving links and flows are fine');
  fs.writeFileSync(at(today, 'links.json'), JSON.stringify({ links: [{ to: 'inbox/gone' }, { to: 'inbox/detail' }, { to: 'billing/x' }] }));
  const [dangling, ...rest] = findings(root);
  assert.deepEqual({ code: dangling?.code, path: dangling?.path }, { code: 'HFS_APP_GALLERY_LINKS', path: 'gallery/pages/inbox/today/links.json' });
  assert.match(dangling?.message ?? '', /"inbox\/gone", "billing\/x", which are not screen folders/u);
  assert.deepEqual(rest, []);
  fs.writeFileSync(at(today, 'links.json'), '{ not json');
  assert.match(findings(root)[0]?.message ?? '', /is not JSON/u);
  fs.writeFileSync(at(today, 'links.json'), JSON.stringify([{ x: 1 }]));
  assert.match(findings(root)[0]?.message ?? '', /no text "to"/u);
  fs.rmSync(at(today, 'links.json'));
  fs.writeFileSync(at(root, 'gallery', 'flows.json'), JSON.stringify({ open: ['inbox/today', 'inbox/missing'], other: ['inbox/today'] }));
  const flow = findings(root);
  assert.deepEqual(flow.map((finding) => `${finding.code} ${finding.path}`), ['HFS_APP_GALLERY_LINKS gallery/flows.json']);
  assert.match(flow[0]?.message ?? '', /"inbox\/missing", which is not a screen folder/u);
  fs.writeFileSync(at(root, 'gallery', 'flows.json'), JSON.stringify({ open: 'inbox/today' }));
  assert.match(findings(root)[0]?.message ?? '', /object \{ "<flow name>"/u);
  fs.writeFileSync(at(root, 'gallery', 'flows.json'), 'nope');
  assert.match(findings(root)[0]?.message ?? '', /is not JSON/u);
});

// R395 (rules/gallery.mts, scripts/hfs/gallery.mts): every app source repository carries the screenshot gallery - a managed Vite app at gallery/ that
// serves on local.basePort + 50, pins vite and keeps its shots out of git. A scaffold writes it, `starci app sync` adds it to an existing app, the dev
// stack starts it next to web and api, and the gate names each way it can be missing.
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
import { galleryParams, galleryPort, declaredBasePort } from '../runtime/scripts/hfs/gallery.mjs';
import { appGalleryFindings, GALLERY_FILES, ignoresShots } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { A15_CODES, FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadLocalConfig, withGallery } from '../stack/local-config.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';

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
const codes = (root: string, all: string[] = []): string[] => findings(root, all).map((finding) => finding.code);
const SHOT = 'gallery/shots/inbox/today__1440__after.png';

test('the manifest carries the gallery values once: the folder, the dev script, the +50 offset, a pinned vite, and the slots that own the files', () => {
  assert.deepEqual({ ...PARAMS }, { dir: 'gallery', devScript: 'dev', portOffset: 50, vite: '6.3.5', shots: 'gallery/shots', ignoredShots: 'shots/**/*.png' });
  assert.match(PARAMS.vite, /^\d+\.\d+\.\d+$/u);
  const slots = new Map(loadSlotManifest().slots.map((slot) => [slot.id, slot]));
  assert.equal(slots.get('app.gallery')?.managedBy, 'gallery');
  assert.equal(slots.get('app.gallery')?.presence, 'optional', 'a manifest minor never makes a slot required; the rule is what requires the gallery');
  assert.equal(slots.get('app.gallery-shots')?.tracked, 'ignored');
  assert.equal(galleryPort(3100, PARAMS), 3150);
  assert.equal(galleryPort(3000, PARAMS), 3050);
  assert.equal(galleryPort(null, PARAMS), null);
});

test('the rule is wired: its four codes ship with the check and its finder runs', () => {
  for (const code of ['HFS_APP_GALLERY_MISSING', 'HFS_APP_GALLERY_SCRIPT', 'HFS_APP_GALLERY_VITE_UNPINNED', 'HFS_APP_GALLERY_SHOTS_TRACKED']) assert.ok(A15_CODES.includes(code), code);
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
    assert.match(read(root, 'gallery/index.html'), /<title>demo gallery<\/title>/u);
    assert.match(read(root, 'gallery/README.md'), new RegExp(`http://localhost:${base + 50}`, 'u'));
    assert.match(read(root, '.gitignore'), /^gallery\/shots\/\*\*\/\*\.png$/mu);
    assert.deepEqual(findings(root, [], edition), []);
  });
}

test('the shipped gallery is the reference: shots by import.meta.glob, paired by <page>__<width>__<before|after>', (t) => {
  const root = starter(t, 'lite');
  const main = read(root, 'gallery/src/main.js');
  assert.match(main, /import\.meta\.glob\("\/shots\/\*\*\/\*\.png"/u);
  assert.match(main, /name\.split\("__"\)/u);
  assert.doesNotMatch(main, /\{\{/u, 'no template variable leaks into the app source');
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
  fs.rmSync(at(root, 'gallery', 'src', 'main.js'));
  const [missing] = findings(root);
  assert.equal(missing?.code, 'HFS_APP_GALLERY_MISSING');
  assert.match(missing?.message ?? '', /missing gallery\/src\/main\.js/u);
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
  fs.writeFileSync(ignore, original.replace('gallery/shots/**/*.png\n', ''));
  const open = findings(root);
  assert.deepEqual(open.map((finding) => finding.code), ['HFS_APP_GALLERY_SHOTS_TRACKED']);
  assert.match(open[0]?.message ?? '', /gallery\/shots\/\*\*\/\*\.png is not git-ignored/u);
  fs.writeFileSync(ignore, original);
  const tracked = findings(root, [SHOT, 'gallery/shots/inbox/today__390__after.png', 'gallery/shots/.gitkeep']);
  assert.deepEqual(tracked.map((finding) => finding.code), ['HFS_APP_GALLERY_SHOTS_TRACKED']);
  assert.equal(tracked[0]?.path, SHOT);
  assert.match(tracked[0]?.message ?? '', /2 screenshot PNGs are tracked/u);
});

test('the reference layout passes too: a gallery/.gitignore that ignores the shots instead of the root block', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gallery-ignore-'));
  try {
    for (const text of ['shots/**/*.png\n', '/shots/\n', 'node_modules\ndist\nshots/**/*.png\n']) assert.equal(ignoresShots(text, PARAMS, true), true, text);
    for (const text of ['gallery/shots/**/*.png\n', '/gallery/shots/\n', '**/*.png\n']) assert.equal(ignoresShots(text, PARAMS, false), true, text);
    for (const text of ['# shots/**/*.png\n', '!shots/**/*.png\n', 'shots/*.jpg\n', 'dist\n', '']) assert.equal(ignoresShots(text, PARAMS, true), false, text);
    assert.equal(ignoresShots('shots/**/*.png\n', PARAMS, false), false, 'a nested pattern does nothing in the root file');
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
  assert.deepEqual(findings(root), []);
});

test('the dev stack starts the gallery on base + 50 next to web and api, with its install, a readiness row and an origin', (t) => {
  const root = starter(t, 'lite');
  const base = scaffoldBasePort('demo');
  const local = loadLocalConfig({ repoRoot: root, env: 'dev' });
  const gallery = local.processes.find((run) => run.name === 'gallery');
  assert.deepEqual(local.processes.map((run) => run.name), ['api', 'web', 'gallery']);
  assert.equal(local.ports['gallery'], base + 50);
  assert.deepEqual({ argv: gallery?.argv, cwd: gallery?.cwd, port: gallery?.port }, { argv: ['npm', 'run', 'dev'], cwd: 'gallery', port: 'gallery' });
  assert.equal(gallery?.health?.url, 'http://localhost:${port.gallery}/');
  const install = local.setup.find((run) => run.name === 'gallery-install');
  assert.deepEqual({ argv: install?.argv, cwd: install?.cwd, skip: install?.skipIfExists, heavy: install?.heavy }, { argv: ['npm', 'install', '--no-audit', '--no-fund'], cwd: 'gallery', skip: 'node_modules', heavy: 'install' });
  assert.ok(local.ready.some((row) => row.name === 'gallery-live' && row.url === 'http://localhost:${port.gallery}/'));
  assert.ok(local.origins.some((origin) => origin.name === 'gallery'));
  assert.equal(local.ports['web'], base);
  assert.equal(local.ports['api'], base + 1);
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

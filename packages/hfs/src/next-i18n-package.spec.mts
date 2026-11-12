// proves: FE_I18N_PLACEMENT@lite
// proves: FE_I18N_PLACEMENT@full
// The next-intl stack is the package @starci/next-i18n: a starter's front end depends on it at its pin, describes its languages with
// defineI18n and builds its proxy, request config and locale read through it, no source of the starter calls a next-intl layer builder,
// the i18n concern of the stack names it, and R59 names the rule that refuses an app's own stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

const starter = (t: Parameters<typeof mkdtemp>[0], edition: 'lite' | 'full') =>
  scaffoldApp({ name: 'demo', into: mkdtemp(t, 'hfs-next-i18n-'), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init }).root;

const read = (root: string, ...parts: string[]): string => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/^﻿/, '');

const manifest = (root: string, ...parts: string[]) => JSON.parse(read(root, ...parts));

/** Every `.ts` and `.tsx` source under a folder, as [relative path, text]. */
const sources = (dir: string): Array<[string, string]> =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => { const file = path.join(entry.parentPath, entry.name); return [path.relative(dir, file), fs.readFileSync(file, 'utf8')]; });

const STACK_BUILDERS = /\b(?:defineRouting|createNavigation|getRequestConfig|createMiddleware)\s*\(/u;

test('a lite starter describes its languages with defineI18n and builds the proxy, request config and locale read through @starci/next-i18n', (t) => {
  const root = starter(t, 'lite');
  const pin = canonPins()['@starci/next-i18n'];
  assert.ok(pin, 'the canon pins name @starci/next-i18n');
  const web = path.join(root, 'fe', 'apps', 'web');
  assert.equal(manifest(root, 'fe', 'apps', 'web', 'package.json').dependencies['@starci/next-i18n'], pin.version);
  assert.match(read(web, 'src', 'modules', 'i18n', 'routing.ts'), /defineI18n\(/u);
  assert.match(read(web, 'src', 'proxy.ts'), /createProxy\(i18n\)/u);
  assert.match(read(web, 'src', 'modules', 'i18n', 'request.ts'), /createRequestConfig\(i18n/u);
  assert.match(read(web, 'src', 'app', '[locale]', 'layout.tsx'), /createReadLocaleSegment\(i18n\)/u);
  for (const [file, text] of sources(path.join(web, 'src'))) assert.doesNotMatch(text, STACK_BUILDERS, file);
});

test('a full starter keeps one thin i18n workspace package over @starci/next-i18n, and its apps call that package', (t) => {
  const root = starter(t, 'full');
  const pin = canonPins()['@starci/next-i18n'];
  assert.ok(pin);
  const pkg = path.join(root, 'fe', 'packages', 'demo-i18n');
  const dependencies = manifest(pkg, 'package.json').dependencies as Record<string, string>;
  assert.equal(dependencies['@starci/next-i18n'], pin.version);
  assert.equal(dependencies['next-intl'], undefined);
  assert.match(read(pkg, 'src', 'routing.ts'), /defineI18n\(/u);
  assert.match(read(pkg, 'src', 'proxy.ts'), /createProxy\(i18n\)/u);
  assert.match(read(pkg, 'src', 'index.ts'), /createRequestConfig\(i18n/u);
  for (const app of ['app', 'landing']) {
    assert.match(read(root, 'fe', 'apps', app, 'src', 'modules', 'i18n', 'index.ts'), /createAppI18n\(/u);
    assert.match(read(root, 'fe', 'apps', app, 'src', 'proxy.ts'), /@demo\/i18n\/proxy/u);
  }
  for (const dir of [path.join(root, 'fe', 'packages', 'demo-i18n', 'src'), path.join(root, 'fe', 'apps')]) {
    for (const [file, text] of sources(dir)) assert.doesNotMatch(text, STACK_BUILDERS, file);
  }
});

test('the pin of @starci/next-i18n names the folder and the version of the package', () => {
  const pin = canonPins()['@starci/next-i18n'];
  assert.equal(pin?.source, 'packages/next-i18n/package.json');
  assert.equal(pin?.version, JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'packages', 'next-i18n', 'package.json'), 'utf8')).version);
});

test('R59 lists the rule that refuses an app-built stack, and the i18n concern of the stack names the package', () => {
  const rules = fs.readFileSync(path.join(REPOSITORY, 'packages', 'hfs', 'runtime', 'knowledge', 'hfs', 'rules.yaml'), 'utf8');
  const r59 = rules.slice(rules.indexOf('- id: R59'), rules.indexOf('- id: R60'));
  assert.match(r59, /id: i18n-stack-in-one-module/u);
  assert.match(r59, /@starci\/next-i18n/u);
  const stack = fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'fe.yaml'), 'utf8');
  assert.match(stack, /packages: \[next-intl, '@starci\/next-i18n'\]/u);
});

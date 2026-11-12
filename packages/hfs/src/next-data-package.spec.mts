// proves: FE_STACK_FORBIDDEN@lite
// The SWR data helpers are the package @starci/next-data: a starter's front end depends on it at its pin, keys its SWR config by the
// viewer through it and keeps no middleware of its own, the data concern of the stack names it, and R244 lists the rule that refuses an
// app's own middleware.
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
  scaffoldApp({ name: 'demo', into: mkdtemp(t, 'hfs-next-data-'), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init }).root;

for (const edition of ['lite', 'full'] as const) {
  test(`a ${edition} starter's web app depends on @starci/next-data at its pin and keys its SWR config by the viewer through it`, (t) => {
    const root = starter(t, edition);
    const pin = canonPins()['@starci/next-data'];
    assert.ok(pin, 'the canon pins name @starci/next-data');
    const [app] = fs.readdirSync(path.join(root, 'fe', 'apps'));
    assert.ok(app);
    const web = JSON.parse(fs.readFileSync(path.join(root, 'fe', 'apps', app, 'package.json'), 'utf8').replace(/^﻿/, ''));
    assert.equal(web.dependencies['@starci/next-data'], pin.version);
    const src = path.join(root, 'fe', 'apps', app, 'src');
    const providers = fs.readFileSync(path.join(src, 'components', 'providers', 'AppProviders', 'index.tsx'), 'utf8');
    assert.match(providers, /viewerCacheKey/u);
    assert.match(providers, /viewerSwrConfig\(SWR_DEFAULTS\)/u);
    assert.doesNotMatch(providers, /Middleware|ScopedMutator/u);
    assert.match(fs.readFileSync(path.join(src, 'modules', 'viewer-cache', 'index.ts'), 'utf8'), /createViewerCache\(\)/u);
  });
}

test('the pin of @starci/next-data names the folder and the version of the package', () => {
  const pin = canonPins()['@starci/next-data'];
  assert.equal(pin?.source, 'packages/next-data/package.json');
  assert.equal(pin?.version, JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'packages', 'next-data', 'package.json'), 'utf8')).version);
});

test('R244 lists the rule that refuses an app-written SWR middleware, and the data concern of the stack names the package', () => {
  const rules = fs.readFileSync(path.join(REPOSITORY, 'packages', 'hfs', 'runtime', 'knowledge', 'hfs', 'rules.yaml'), 'utf8');
  const r244 = rules.slice(rules.indexOf('- id: R244'), rules.indexOf('- id: R245'));
  assert.match(r244, /id: swr-extension-from-package/u);
  const stack = fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'fe.yaml'), 'utf8');
  assert.match(stack, /packages: \[swr, '@starci\/next-data'\]/u);
});

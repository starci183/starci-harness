// proves: BE_AUTH_PASSPORT_OWNER@lite
// The lite sign-in is the package @starci/auth: a lite starter depends on it and on none of the identity libraries it owns, its
// session tables are the package's migration byte for byte, its passport integration is the thin glue the slot lists, the
// identity libraries are owned by no app file and the package only by integrations/passport, and its front end uses the one client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const AUTH_SQL = path.join(REPOSITORY, 'packages', 'auth', 'migrations', 'identity-sessions.sql');
const IDENTITY_LIBRARIES = ['@nestjs/passport', 'passport', 'passport-google-oauth20', 'passport-local', '@nestjs/jwt', 'jose', 'bcryptjs'];

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

const lite = (t: Parameters<typeof mkdtemp>[0]) =>
  scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-auth-package-'), harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init }).root;

test('a lite starter depends on @starci/auth at its pin and on none of the identity libraries, in the root and in the web app', (t) => {
  const root = lite(t);
  const pin = canonPins()['@starci/auth'];
  assert.ok(pin, 'the canon pins name @starci/auth');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@starci/auth'], pin.version);
  for (const library of [...IDENTITY_LIBRARIES, '@types/passport-google-oauth20', '@types/passport-local']) {
    assert.equal(manifest.dependencies?.[library], undefined, library);
    assert.equal(manifest.devDependencies?.[library], undefined, library);
  }
  const web = JSON.parse(fs.readFileSync(path.join(root, 'fe', 'apps', 'web', 'package.json'), 'utf8').replace(/^﻿/, ''));
  assert.equal(web.dependencies['@starci/auth'], pin.version);
});

test('the baseline migration of a lite starter holds the package\'s session tables byte for byte', (t) => {
  const root = lite(t);
  const [baseline] = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((name) => name.endsWith('_baseline.sql'));
  assert.ok(baseline);
  const text = fs.readFileSync(path.join(root, 'db', 'migrations', baseline), 'utf8');
  assert.ok(text.includes(fs.readFileSync(AUTH_SQL, 'utf8')), 'packages/auth/migrations/identity-sessions.sql is the owner of the tables');
  assert.doesNotMatch(text, /refresh_sessions/u);
});

test('a lite starter\'s passport integration is the glue the slot lists and its front end keeps one auth client', (t) => {
  const root = lite(t);
  const slot = loadSlotManifest().slots.find((entry) => entry.id === 'be.integrations.passport');
  assert.ok(slot);
  const folder = path.join(root, 'be', 'src', 'modules', 'integrations', 'passport');
  const files = fs.readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  for (const required of slot.requires ?? []) assert.ok(files.includes(required), required);
  const allowed = [...(slot.allows ?? [])];
  for (const file of files.filter((name) => !name.endsWith('.spec.ts'))) {
    assert.ok(allowed.some((entry) => entry === file || (entry.endsWith('/') && file.startsWith(entry))), `${file} is admitted by the slot`);
  }
  const auth = path.join(root, 'fe', 'apps', 'web', 'src', 'modules', 'auth');
  assert.deepEqual(fs.readdirSync(auth).sort(), ['client.ts', 'contracts.ts', 'index.ts']);
  assert.match(fs.readFileSync(path.join(auth, 'client.ts'), 'utf8'), /from "@starci\/auth\/client"/u);
});

test('the identity libraries are owned by no app file and @starci/auth by integrations/passport alone', () => {
  const owners = loadSlotManifest().ruleParams.be.infraOwners;
  for (const library of IDENTITY_LIBRARIES) assert.deepEqual(owners[library], [], library);
  assert.deepEqual(owners['@starci/auth'], ['integrations/passport']);
  assert.deepEqual(owners['@starci/auth/testing'], ['integrations/passport']);
});

test('the pin of @starci/auth names the folder and the version of the package', () => {
  const pin = canonPins()['@starci/auth'];
  assert.equal(pin?.source, 'packages/auth/package.json');
  assert.equal(pin?.version, JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'packages', 'auth', 'package.json'), 'utf8')).version);
});

// proves: BE_AUTH_PASSPORT_OWNER@lite
// The lite sign-in is the package @starci/auth: a lite starter depends on it and on none of the identity libraries it owns, its
// session tables are the package's migration byte for byte, its passport integration is the thin glue the slot lists, the
// identity libraries are owned by no app file and the package only by integrations/passport, and its front end uses the one client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { renderRepo, writeTargets } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const AUTH_SQL = path.join(REPOSITORY, 'packages', 'auth', 'migrations', 'identity-sessions.sql');
const DOORS_SQL = path.join(REPOSITORY, 'packages', 'hfs', 'templates', 'app', 'auth-doors.sql.partial');
const ACCOUNT_DOORS = ['be_auth_user_by_email', 'be_auth_user_by_id', 'be_auth_user_by_google', 'be_auth_create_user', 'be_auth_link_google', 'be_auth_touch_user'];
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

test('the baseline migration of a lite starter holds the package\'s session tables and the account doors byte for byte, and grants app_be nothing on schema auth', (t) => {
  const root = lite(t);
  const [baseline] = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((name) => name.endsWith('_baseline.sql'));
  assert.ok(baseline);
  const text = fs.readFileSync(path.join(root, 'db', 'migrations', baseline), 'utf8');
  assert.ok(text.includes(fs.readFileSync(AUTH_SQL, 'utf8')), 'packages/auth/migrations/identity-sessions.sql is the owner of the tables');
  assert.doesNotMatch(text, /refresh_sessions/u);
  assert.ok(text.includes(fs.readFileSync(DOORS_SQL, 'utf8')), 'templates/app/auth-doors.sql.partial is the owner of the account doors');
  assert.doesNotMatch(text, /grant [^;]* on (?:schema auth|(?:table )?auth\.)/iu, 'app_be reaches accounts through the doors only');
  for (const door of ACCOUNT_DOORS) {
    assert.match(text, new RegExp(String.raw`create function public\.${door}\([^)]*\)[^$]*security definer\s+set search_path to ''`, 'iu'), `${door} is a definer with a pinned search_path`);
    assert.match(text, new RegExp(String.raw`revoke execute on function public\.${door}\([^)]*\) from public, anon, authenticated;\s+grant execute on function public\.${door}\([^)]*\) to app_be;`, 'iu'), `${door} is executable by app_be alone`);
  }
});

test('the six account doors are the canon\'s listed database functions, so an app lists none of them in hfs.json', () => {
  const listed = Object.fromEntries((loadSlotManifest().ruleParams.be?.dbFunctions ?? []).map((entry) => [entry.name, entry.reason]));
  for (const door of ACCOUNT_DOORS) assert.match(String(listed[`public.${door}`]), /^domain\/identity \(lite sign-in\)/u, door);
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
  assert.ok(fs.readFileSync(path.join(auth, 'client.ts'), 'utf8').startsWith('// Managed by starci app sync (slot fe.modules.auth.client)'));
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

test('the sign-in glue is managed: the doors, the stores and their specs render with the lite starter, and an edit is drift', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const declaration = structuredClone(APP);
  declaration.edition = 'lite';
  declaration.sides.be.connections = [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' }];
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const { targets } = await renderRepo(root, { presets: PRESETS });
  writeTargets(root, targets);
  const tracked = ['hfs.json', ...targets.map((target) => target.path)];
  const controller = 'be/src/features/api/auth/transport/http/auth.controller.ts';
  const managed = ['be/src/modules/domain/identity/persistence/account-doors.port.ts', 'be/src/modules/domain/identity/identity-sign-in.log-events.ts', 'be/src/modules/domain/identity/session-store.service.ts', 'be/src/modules/domain/identity/account-directory.service.ts', 'be/src/modules/domain/identity/rate-counter.service.ts',
    'be/src/modules/domain/identity/authenticator.service.ts', 'be/src/modules/domain/identity/sign-in.service.ts', 'be/src/modules/domain/identity/sign-in.service.spec.ts', 'be/src/tests/fixtures/builders/identity.builder.ts', controller];
  for (const file of managed) assert.ok(tracked.includes(file), file);
  const identity = tracked.filter((file) => file.startsWith('be/src/modules/domain/identity/persistence/'));
  assert.deepEqual(identity.filter((file) => /auth-(?:user|identity)\.entity/u.test(file)), [], 'no entity maps auth.users or auth.identities');
  for (const file of identity) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /schema: "auth"/u, file);
  // The cookie session itself (login, an authenticated request, refresh with rotation, reuse of the old token rejected, logout) runs in the package's own spec over its in-memory stores.
  assert.match(fs.readFileSync(path.join(REPOSITORY, 'packages/auth/src/server/auth.module.spec.ts'), 'utf8'), /login, an authenticated request, refresh with rotation, reuse of the old refresh token rejected, and logout/u);
  for (const door of ['login', 'refresh', 'session', 'logout', 'google', 'google/callback', 'jwks']) assert.ok(fs.readFileSync(path.join(root, controller), 'utf8').includes(`("${door}")`), door);
  const input = { repoRoot: root, tracked, presets: PRESETS };
  assert.deepEqual((await managedFindings(input)).map((finding) => finding.code), []);
  const rendered = fs.readFileSync(path.join(root, controller), 'utf8');
  fs.writeFileSync(path.join(root, controller), `${rendered}// edited\n`);
  assert.deepEqual((await managedFindings(input)).map((finding) => [finding.code, finding.path]), [['HFS_MANAGED_FILE_DRIFT', controller]]);
  fs.writeFileSync(path.join(root, controller), rendered);
  assert.deepEqual((await managedFindings(input)).map((finding) => finding.code), []);
});

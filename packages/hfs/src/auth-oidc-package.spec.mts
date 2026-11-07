// proves: BE_AUTH_PASSPORT_OWNER@full
// The full sign-in is the package @starci/auth-oidc: it is pinned at the version of its folder, it is the only owner of jose in a full app (the
// version it depends on is the one pin of jose), its glue folder is a slot of the full edition only, and no JWT or OIDC library is owned by an
// app file. Its twin lint test is packages/eslint-canon-be/src/auth-oidc-package.spec.ts; the package keeps its own specs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const PACKAGE = path.join(REPOSITORY, 'packages', 'auth-oidc');
const manifest = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')); // reason: parsed package.json

test('the pin of @starci/auth-oidc names the folder and the version of the package', () => {
  const pin = canonPins()['@starci/auth-oidc'];
  assert.equal(pin?.source, 'packages/auth-oidc/package.json');
  assert.equal(pin?.version, manifest().version);
  assert.equal(pin?.side, 'both');
  assert.equal(pin?.install, 'registry');
});

test('the package owns jose at the one pinned version, shares the session code of @starci/auth at its pinned version and depends on no Passport, bcrypt or session library', () => {
  const pins = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).pins;
  const dependencies = manifest().dependencies as Record<string, string>;
  assert.deepEqual(Object.keys(dependencies).sort(), ['@starci/auth', 'jose']);
  assert.equal(dependencies.jose, pins.jose.version);
  assert.equal(dependencies['@starci/auth'], pins['@starci/auth'].version, 'the client imports the session store of the version the pins name');
  assert.equal(pins['@starci/auth-oidc'].version, manifest().version);
});

test('the package is one package with the four subpaths and nothing else', () => {
  const exported = Object.keys(manifest().exports as Record<string, unknown>).sort();
  assert.deepEqual(exported, ['./client', './contracts', './package.json', './server', './testing']);
});

test('jose and every other JWT or OIDC client library belong to no app file, and the package to integrations/keycloak alone', () => {
  const owners = loadSlotManifest().ruleParams.be.infraOwners;
  for (const library of ['jose', 'jsonwebtoken', 'jwks-rsa', 'jwt-decode', 'passport-jwt', 'openid-client']) assert.deepEqual(owners[library], [], library);
  assert.deepEqual(owners['@starci/auth-oidc'], ['integrations/keycloak']);
  assert.deepEqual(owners['@starci/auth-oidc/testing'], ['integrations/keycloak']);
  assert.deepEqual(owners['@starci/auth'], ['integrations/passport'], 'the lite package keeps its own glue');
});

test('the glue folder is a slot of the full edition: optional, a short list of files, tested beside, with the owner rule', () => {
  const slot = loadSlotManifest().slots.find((entry) => entry.id === 'be.integrations.keycloak');
  assert.ok(slot);
  assert.deepEqual(slot.editions, ['full']);
  assert.equal(slot.presence, 'optional');
  assert.equal(slot.path, 'src/modules/integrations/keycloak/');
  for (const required of slot.requires ?? []) assert.ok((slot.allows ?? []).includes(required), `${required} is required and admitted`);
  assert.ok((slot.rules ?? []).includes('BE_AUTH_PASSPORT_OWNER'));
  assert.ok((slot.rules ?? []).includes('BE_INTEGRATION_SPEC_MISSING'));
  assert.ok((slot.allows ?? []).includes('errors/'));
});

test('the front-end stack admits the package client in modules/auth only', () => {
  const stack = parseYaml(fs.readFileSync(path.join(import.meta.dirname, '..', 'runtime', 'knowledge', 'hfs', 'fe-stack.yaml'), 'utf8'));
  const concern = (stack.concerns as Array<{ id: string; packages: string[]; home: string[]; forbids: string[] }>).find((entry) => entry.id === 'auth');
  assert.ok(concern);
  assert.deepEqual(concern.packages, ['@starci/auth', '@starci/auth-oidc']);
  assert.deepEqual(concern.home, ['fe.modules.auth']);
  for (const library of ['jose', 'oidc-client-ts', 'keycloak-js']) assert.ok(concern.forbids.includes(library), library);
});

test('R328, the rule that owns the identity libraries, names the package as the owner of jose', () => {
  const rules = parseYaml(fs.readFileSync(path.join(import.meta.dirname, '..', 'runtime', 'knowledge', 'hfs', 'rules.yaml'), 'utf8'));
  const rule = (rules.rules as Array<{ id: string; law: string }>).find((entry) => entry.id === 'R328');
  assert.match(rule?.law ?? '', /@starci\/auth-oidc \(full, which owns jose/u);
});

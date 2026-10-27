import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonBindingVersionLines, inspectInstalledCanons, profileCanonBindings, selectedProfileCanonBindings } from '../runtime/scripts/gates/canon-pins.mjs';
import { canonContentDigest, installedFiles } from '../runtime/scripts/gates/canon-digest.mjs';

const POLICY = Object.freeze({ algorithm: 'sha256', include: ['**/*.mjs', '**/*.json'], exclude: [], framing: 'sorted-posix-relative-path-null-raw-bytes-null' });
const NAMES = Object.freeze({ universal: '@starci/eslint-canon-fe', starci: '@starci/eslint-grammar-core', 'offset-pop': '@starci/eslint-grammar-offset-pop' });

function fixture(t, { family = 'core', install = ['universal', 'starci'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-family-canon-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'family-consumer', private: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', sides: { fe: { ...(family === null ? {} : { grammar: family }) } } }));
  const pins = {}, canons = {}, directories = {};
  for (const [id, name] of Object.entries(NAMES)) {
    const directory = path.join(root, 'node_modules', ...name.split('/'));
    pins[name] = { side: 'fe' };
    canons[id] = { package: name, version: '1.0.0', contentDigest: { ...POLICY, value: '0'.repeat(64), files: 2 } };
    if (!install.includes(id)) continue;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...(id === 'offset-pop' ? { dependencies: { [NAMES.starci]: '1.0.0' } } : {}) }));
    fs.writeFileSync(path.join(directory, 'index.mjs'), `export const family = ${JSON.stringify(id)};\n`);
    canons[id].contentDigest = { ...POLICY, ...canonContentDigest(directory, POLICY, installedFiles(directory)) };
    directories[id] = directory;
  }
  const profile = { canon: canons.universal, familyCanons: { core: canons.starci, 'offset-pop': canons['offset-pop'] } };
  const inspect = () => inspectInstalledCanons(root, { pins, profiles: { next: profile } });
  return { root, pins, profile, directories, inspect };
}

test('source publication enumerates universal and every independent family binding', t => {
  const { profile } = fixture(t);
  assert.deepEqual(profileCanonBindings(profile).map(row => row.binding), ['canon', 'familyCanons.core', 'familyCanons.offset-pop']);
  for (const family of ['core']) {
    assert.deepEqual(selectedProfileCanonBindings(profile, family).map(row => row.binding), ['canon', 'familyCanons.core']);
    assert.deepEqual(selectedProfileCanonBindings(profile, family).map(row => row.canon.package), [NAMES.universal, NAMES.starci]);
  }
});

test('a selected family requires its own installed package without requiring the unrelated family', t => {
  const { inspect } = fixture(t);
  const result = inspect();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.checked.map(row => row.package), [NAMES.universal, NAMES.starci]);
});

test('a missing selected family package cannot pass a universal-only install', t => {
  const { inspect } = fixture(t, { install: ['universal'] });
  const result = inspect();
  assert.equal(result.checked.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /CANON_INSTALL_MISSING.*eslint-grammar-core/);
});

test('a selected family byte change is a finding under its independent binding', t => {
  const { inspect, directories } = fixture(t);
  fs.appendFileSync(path.join(directories.starci, 'index.mjs'), 'export const changed = true;\n');
  const result = inspect();
  assert.deepEqual(result.errors, []);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, 'installed-canon-mismatch');
  assert.match(result.findings[0].message, /eslint-grammar-core/);
});

test('a family adapter checks its independently published implementation dependency too', t => {
  const { inspect, directories } = fixture(t, { family: 'offset-pop', install: ['universal', 'starci', 'offset-pop'] });
  assert.deepEqual(inspect().checked.map(row => row.package), [NAMES.universal, NAMES['offset-pop'], NAMES.starci]);
  fs.appendFileSync(path.join(directories.starci, 'index.mjs'), 'export const changed = true;\n');
  const result = inspect();
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /eslint-grammar-core/);
});

test('an undeclared family and a mismatched family-package binding both fail closed', t => {
  const missing = fixture(t, { family: null });
  assert.match(missing.inspect().errors[0], /explicitly name/);
  assert.throws(() => selectedProfileCanonBindings(missing.profile, 'unknown'), /no declared lint contract/);
  missing.profile.familyCanons.core.package = NAMES['offset-pop'];
  assert.throws(() => selectedProfileCanonBindings(missing.profile, 'core'), /no matching code-pattern canon binding/);
});

test('version authorities follow structured universal and family binding paths rather than family names', () => {
  const source = [
    'profiles:',
    '  next:',
    '    canon:',
    "      package: '@starci/eslint-canon-fe'",
    '      version: 9.0.0',
    '    familyCanons:',
    '      a-new-family:',
    "        package: '@starci/eslint-grammar-new-family'",
    '        version: 1.0.0',
    '    notes:',
    '      canon:',
    "        package: '@starci/eslint-canon-fe'",
    '        version: 9.0.0',
  ].join('\n');
  assert.deepEqual([...canonBindingVersionLines(source)], [
    [4, { package: '@starci/eslint-canon-fe', version: '9.0.0' }],
    [8, { package: '@starci/eslint-grammar-new-family', version: '1.0.0' }],
  ]);
});

test('a lookalike canon key outside the actual profile structure grants no version authority', () => {
  const source = [
    'notes:',
    '  profiles:',
    '    next:',
    "      canon: { package: '@starci/eslint-canon-fe', version: 9.0.0 }",
    'profiles:',
    '  next:',
    '    familyCanons:',
    '      starci:',
    '        notes:',
    "          package: '@starci/eslint-grammar-core'",
    '          version: 1.0.0',
  ].join('\n');
  assert.equal(canonBindingVersionLines(source).size, 0);
});

test('inline universal and family canon mappings keep their structured version authority', () => {
  const source = [
    'profiles:',
    '  next:',
    "    canon: { package: '@starci/eslint-canon-fe', version: 9.0.0 }",
    '    familyCanons:',
    "      starci: { package: '@starci/eslint-grammar-core', version: 1.0.0 }",
  ].join('\n');
  assert.deepEqual([...canonBindingVersionLines(source).keys()], [2, 4]);
});

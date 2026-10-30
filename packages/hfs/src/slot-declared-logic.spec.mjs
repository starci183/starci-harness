// A slot may declare which of its own files carry logic (`logic`): each is measured at 100 per file like a logic-role file
// (scripts/hfs/coverage-scope.mjs, R204, R273), and its `<file>.spec.ts` beside it is admitted by the slot without being listed
// (scripts/hfs/allows.mjs). No role name joins ruleParams.be.logicRoles. be.integrations.passport declares its tokens, password and
// cookie files. The same file also proves the object-storage slot's names are the capability folder's (`object-storage.*`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { allowsFile, slotAdmitsFile } from '../runtime/scripts/hfs/allows.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { coverageScope, isMeasured, jestCoverage, sonarCoverageExclusions, withoutCovered } from '../runtime/scripts/hfs/coverage-scope.mjs';
import { slotLogicProblems } from '../runtime/scripts/hfs/manifest-shape.mjs';
import { coverageBelowReport } from '../runtime/scripts/hfs/rules/coverage-below.mjs';
import { createSlotResolver, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { jestCoverageSource } from '../sync/index.mjs';
import { APP, cleanup, gitAdd, installTypeScript, writeCleanRepo } from './helpers/hfs-cli-fixture.mjs';

const manifest = loadSlotManifest();
const PASSPORT = 'src/modules/integrations/passport/';
const DECLARED = ['passport.cookie.ts', 'passport.password.ts', 'passport.tokens.ts'].map((file) => `${PASSPORT}${file}`);
const STORAGE = 'src/modules/integrations/object-storage/';
const SKELETON_STORAGE = path.resolve(import.meta.dirname, '..', 'templates', 'be', 'skeleton-lite', STORAGE);
const resolverOf = (edition) => createSlotResolver(manifest, resolveRepoDeclaration(manifest, { ...APP, edition }));
const passportSlot = () => manifest.slots.find((slot) => slot.id === 'be.integrations.passport');

test('be.integrations.passport declares its tokens, password and cookie files as logic, and no role name is added for them', () => {
  assert.deepEqual(passportSlot().logic, ['passport.tokens.ts', 'passport.password.ts', 'passport.cookie.ts']);
  assert.equal(passportSlot().coverage, 'required');
  for (const part of ['tokens', 'password', 'cookie']) assert.equal(manifest.ruleParams.be.logicRoles.includes(part), false, part);
});

test('the coverage scope measures every declared logic file at 100 per file: jest files, R273 measured, never a Sonar coverage exclusion', () => {
  const scope = coverageScope(manifest);
  assert.deepEqual(scope.files, DECLARED);
  assert.deepEqual(jestCoverage(manifest).files, DECLARED);
  assert.match(jestCoverageSource(jestCoverage(manifest)), /files: \[\s*"src\/modules\/integrations\/passport\/passport\.cookie\.ts",/);
  for (const file of DECLARED) assert.equal(isMeasured(manifest, file), true, file);
  assert.equal(isMeasured(manifest, `${PASSPORT}passport.config.ts`), false, 'an undeclared file of no logic role stays unmeasured');
  assert.equal(isMeasured(manifest, `${PASSPORT}passport.tokens.spec.ts`), false);
  const sonar = sonarCoverageExclusions(manifest);
  const excluded = (file) => !withoutCovered([...sonar, file]).includes(file);
  for (const file of DECLARED) assert.equal(excluded(`be/${file}`), false, `${file} is measured, so no Sonar coverage exclusion covers it`);
  assert.equal(excluded(`be/${PASSPORT}passport.config.ts`), true, 'an undeclared file of no logic role stays excluded');
});

test('R273 counts a declared logic file in the lite scope, where the passport slot exists', () => {
  const files = DECLARED.map((file) => `be/${file}`);
  const lite = coverageBelowReport({ repoRoot: '.', files, repo: resolveRepoDeclaration(manifest, { ...APP, edition: 'lite' }), manifest, lcov: '' });
  assert.deepEqual(lite.measured, files);
  const full = coverageBelowReport({ repoRoot: '.', files, repo: resolveRepoDeclaration(manifest, { ...APP, edition: 'full' }), manifest, lcov: '' });
  assert.deepEqual(full.measured, [], 'full has no passport slot');
});

test('the passport slot admits the spec beside each declared logic file, and no spec beside an undeclared file of no logic role', () => {
  const resolver = resolverOf('lite');
  for (const file of DECLARED) {
    const spec = `be/${file.replace(/\.ts$/, '.spec.ts')}`;
    assert.equal(allowsFile(resolver, spec)?.allowed, true, spec);
    assert.equal(slotAdmitsFile(resolver, spec), true, spec);
  }
  for (const spec of ['passport.config.spec.ts', 'passport.options.spec.ts', 'passport.unknown.spec.ts']) {
    assert.equal(allowsFile(resolver, `be/${PASSPORT}${spec}`)?.allowed, false, spec);
  }
});

test('logic is refused off a coverage-required unit-beside directory slot, outside the names the slot lists, on a logic role and in a bad shape', () => {
  const base = { id: 'be.integrations.x', path: 'src/modules/integrations/x/', profiles: ['be'], tracked: 'tracked', coverage: 'required', tests: 'unit-beside', requires: ['x.tokens.ts', 'x.client.ts'] };
  const roles = manifest.ruleParams.be.logicRoles;
  assert.deepEqual(slotLogicProblems({ ...base, logic: ['x.tokens.ts'] }, 'slot x', roles), []);
  assert.match(slotLogicProblems({ ...base, coverage: 'none', logic: ['x.tokens.ts'] }, 'slot x', roles).join('\n'), /coverage is required/);
  assert.match(slotLogicProblems({ ...base, tests: 'none', logic: ['x.tokens.ts'] }, 'slot x', roles).join('\n'), /unit-beside/);
  assert.match(slotLogicProblems({ ...base, logic: ['x.other.ts'] }, 'slot x', roles).join('\n'), /x\.other\.ts must be one the slot requires or allows/);
  assert.match(slotLogicProblems({ ...base, logic: ['x.client.ts'] }, 'slot x', roles).join('\n'), /logic role client/);
  for (const logic of [[], ['x.tokens.ts', 'x.tokens.ts'], ['tokens.ts'], ['<x>.tokens.ts'], ['x.tokens.spec.ts'], 'x.tokens.ts']) {
    assert.match(slotLogicProblems({ ...base, logic }, 'slot x', roles).join('\n'), /logic must be a non-empty list/, JSON.stringify(logic));
  }
});

const STORAGE_FILES = ['index.ts', 'object-storage.client.ts', 'object-storage.client.spec.ts', 'object-storage.config.ts', 'object-storage.decorators.ts', 'object-storage.options.ts'];
const OLD_STORAGE_FILES = ['index.ts', 'storage.client.ts', 'storage.config.ts', 'storage.decorators.ts', 'storage.options.ts'];

/** A clean lite app whose object-storage folder holds exactly `names` (with the skeleton's own content where it has the file). */
function storageApp(made, names) {
  const dir = writeCleanRepo({ ...APP, edition: 'lite' });
  made.push(dir);
  const folder = path.join(dir, 'be', ...STORAGE.split('/'));
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(folder, name), 'export {};\n');
  return installTypeScript(gitAdd(dir));
}

const SLOT_CODES = /^(?:HFS_SLOT_|HFS_REQUIRED_FILE_MISSING|BE_SOURCE_FORM|BE_SPEC_PLACEMENT)/;
const storageFindings = (result) => result.findings.filter((finding) => SLOT_CODES.test(finding.code) && String(finding.path).includes('integrations/object-storage'));

test('a scaffold-shaped object-storage tree with the skeleton names is complete and every file is one the slot admits', (t) => {
  const made = [];
  t.after(() => cleanup(made));
  assert.deepEqual(fs.readdirSync(SKELETON_STORAGE).sort(), [...STORAGE_FILES].sort(), 'the lite skeleton ships these names');
  const repoRoot = storageApp(made, STORAGE_FILES);
  assert.deepEqual(storageFindings(checkRepo({ repoRoot, manifest })), []);
  const resolver = resolverOf('lite');
  for (const name of [...STORAGE_FILES, 'object-storage.module.ts', 'object-storage.module-definition.ts', 'errors/object-storage.error.ts']) {
    assert.equal(allowsFile(resolver, `be/${STORAGE}${name}`)?.allowed, true, name);
  }
});

test('the old storage.* names leave the object-storage slot incomplete and are not names it admits', (t) => {
  const made = [];
  t.after(() => cleanup(made));
  const repoRoot = storageApp(made, OLD_STORAGE_FILES);
  const missing = storageFindings(checkRepo({ repoRoot, manifest })).filter((finding) => finding.code === 'HFS_SLOT_REQUIRED_MISSING').map((finding) => finding.path).sort();
  assert.deepEqual(missing, ['client', 'config', 'decorators', 'options'].map((part) => `be/${STORAGE}object-storage.${part}.ts`));
  const resolver = resolverOf('lite');
  for (const name of OLD_STORAGE_FILES.filter((name) => name !== 'index.ts')) assert.equal(allowsFile(resolver, `be/${STORAGE}${name}`)?.allowed, false, name);
});

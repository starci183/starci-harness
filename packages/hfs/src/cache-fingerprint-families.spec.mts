// The fingerprint of the app check cache is judged per family (check-cache.md, "The fingerprint"): a part invalidates only the families that read it, the
// lockfile counts per tool family by the toolchain it resolves and is no part of any other, and a library bump reaches ESLint only through the files that import
// the library (the records that loaded it carry it themselves: package-closure.mts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { computeFingerprint, differencesByFamily, familiesOfPart, familyOfFolder, fingerprintDifferences, localReasonOf, lockPackageName, packageDigests } from '../cache/fingerprint.mjs';
import { dirtySetOf, packageOf, resolveReferences, type ImportGraph, type ImportNode } from '../cache/import-graph.mjs';
import { FAMILIES } from '../cache/types.mjs';

const node = (hash: string, imports: string[] = [], packages: string[] | undefined = []): ImportNode => ({ hash, imports, declaresGlobals: false, api: hash, open: false, refs: imports, packages });

const lock = (versions: Record<string, string>): string => JSON.stringify({
  lockfileVersion: 3,
  packages: { '': { name: 'demo' }, 'fe': { name: 'fe' }, ...Object.fromEntries(Object.entries(versions).map(([key, version]) => [key, { version, integrity: `sha512-${version}` }])) },
});

function app(t: { after(fn: () => void): void }, versions: Record<string, string>, manifest: object): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-fingerprint-families-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), lock(versions));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'eslint.config.mjs'), 'export default []\n');
  return root;
}

const families = (root: string, before: string): Map<string, string[]> => {
  const tracked = ['package.json', 'package-lock.json', 'eslint.config.mjs'];
  const hfsDir = path.join(root, 'node_modules', '@starci', 'hfs');
  const first = computeFingerprint({ root: before, tracked, hfsDir });
  const second = computeFingerprint({ root, tracked, hfsDir });
  return differencesByFamily(fingerprintDifferences(first.parts, second.parts));
};

test('every part names the families that read it, and nothing else is invalidated by it', () => {
  assert.deepEqual(familiesOfPart('cache-format'), FAMILIES);
  assert.deepEqual(familiesOfPart('hfs'), ['hfs', 'secrets', 'wiring', 'db']);
  assert.deepEqual(familiesOfPart('pkg:@starci/hfs'), ['hfs', 'secrets', 'wiring', 'db']);
  assert.deepEqual(familiesOfPart('node'), ['test', 'sonar']);
  assert.deepEqual(familiesOfPart('pkg:@starci/auth'), [], 'a library is no toolchain');
  assert.deepEqual(familiesOfPart('pkg:@starci/eslint-canon-be'), ['lint', 'sonar']);
  assert.deepEqual(familiesOfPart('pkg:@starci/prettier-config'), ['format']);
  assert.deepEqual(familiesOfPart('pkg:@starci/jest-preset'), ['test', 'sonar']);
  assert.deepEqual(familiesOfPart('lock:lint'), ['lint', 'sonar']);
  assert.deepEqual(familiesOfPart('lock:test'), ['test', 'sonar']);
  assert.deepEqual(familiesOfPart('lock:format'), ['format']);
  assert.deepEqual(familiesOfPart('lock:unknown'), []);
  assert.deepEqual(familiesOfPart('shape:fe/package.json'), ['hfs', 'lint', 'types', 'test', 'format', 'sonar']);
  assert.deepEqual(familiesOfPart('file:hfs.json'), ['hfs', 'secrets', 'wiring', 'db', 'lint', 'sonar']);
  assert.deepEqual(familiesOfPart('file:be/tsconfig.build.json'), ['types', 'lint', 'test', 'sonar']);
  assert.deepEqual(familiesOfPart('file:fe/eslint.config.mjs'), ['lint', 'sonar']);
  assert.deepEqual(familiesOfPart('file:fe/stylelint.config.mjs'), ['lint', 'sonar']);
  assert.deepEqual(familiesOfPart('file:be/jest.config.js'), ['test', 'sonar']);
  assert.deepEqual(familiesOfPart('file:.prettierrc.json'), ['format']);
  assert.deepEqual(familiesOfPart('file:prettier.config.mjs'), ['format']);
  assert.deepEqual(familiesOfPart('file:.editorconfig'), ['format']);
  assert.deepEqual(familiesOfPart('file:codecov.yml'), ['sonar']);
  assert.deepEqual(familiesOfPart('file:sonar-project.properties'), ['sonar']);
  assert.deepEqual(familiesOfPart('unknown-part'), FAMILIES, 'a part no family claims invalidates all of them');
});

test('a cache folder belongs to the family that writes it', () => {
  assert.equal(familyOfFolder('check/hfs'), 'hfs');
  assert.equal(familyOfFolder('check/secrets'), 'secrets');
  assert.equal(familyOfFolder('check/build'), 'build');
  assert.equal(familyOfFolder('check/other'), null);
  assert.equal(familyOfFolder('lint/be'), 'lint');
  assert.equal(familyOfFolder('test-coverage'), 'test');
  assert.equal(familyOfFolder('sonar-baseline'), 'sonar');
  assert.equal(familyOfFolder('codecov-baseline'), 'sonar');
  assert.equal(familyOfFolder('elsewhere'), null);
});

test('a lock path names its installed package, and a package digest covers each of its installs', () => {
  assert.equal(lockPackageName('node_modules/eslint'), 'eslint');
  assert.equal(lockPackageName('fe/node_modules/@s/y/node_modules/z'), 'z');
  assert.equal(lockPackageName('fe'), null);
  const digests = packageDigests({ 'node_modules/x': { version: '1' }, 'fe/node_modules/x': { version: '2', resolved: 'r' }, '': {} });
  assert.deepEqual([...digests.keys()], ['x']);
  assert.notEqual(digests.get('x'), packageDigests({ 'node_modules/x': { version: '1' } }).get('x'));
});

test('a library bump leaves the lint fingerprint as it was; a toolchain bump makes lint full; a dependency version is no manifest change outside the hfs-run families', (t) => {
  const base = app(t, { 'node_modules/@starci/auth': '0.3.0', 'node_modules/eslint': '10.0.0' }, { name: 'demo', dependencies: { '@starci/auth': '0.3.0' } });
  const library = app(t, { 'node_modules/@starci/auth': '0.4.0', 'node_modules/eslint': '10.0.0' }, { name: 'demo', dependencies: { '@starci/auth': '0.4.0' } });
  const byLibrary = families(library, base);
  assert.equal(byLibrary.has('lint'), false, 'an @starci/auth bump never cold-starts ESLint');
  assert.equal(byLibrary.has('format'), false);
  assert.deepEqual([...byLibrary.keys()], [], 'no family: the records that loaded the library carry it in their own key');
  const toolchain = app(t, { 'node_modules/@starci/auth': '0.3.0', 'node_modules/eslint': '10.1.0' }, { name: 'demo', dependencies: { '@starci/auth': '0.3.0' } });
  assert.deepEqual(families(toolchain, base).get('lint'), ['lock:lint']);
  const workspaces = app(t, { 'node_modules/@starci/auth': '0.3.0', 'node_modules/eslint': '10.0.0' }, { name: 'demo', workspaces: ['packages/*'], dependencies: { '@starci/auth': '0.3.0' } });
  assert.deepEqual(families(workspaces, base).get('lint'), ['shape:package.json'], 'a manifest whose shape changed reaches every family');
});

test('a package name is the scope and name of a bare specifier', () => {
  assert.equal(packageOf('@starci/auth/server'), '@starci/auth');
  assert.equal(packageOf('lodash/fp'), 'lodash');
  assert.equal(packageOf('react'), 'react');
});

test('the graph records the installed packages a file imports, never a relative or unresolved one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-graph-packages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules', '@s', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '@s', 'lib', 'package.json'), JSON.stringify({ name: '@s/lib', types: 'index.d.ts' }));
  fs.writeFileSync(path.join(root, 'node_modules', '@s', 'lib', 'index.d.ts'), 'export declare const lib: number;\n');
  fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 1;\n');
  const host = { ts, sideRoot: root, readText: (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null), fileExists: (file: string) => fs.existsSync(file), hashOf: () => 'h' };
  const found = resolveReferences(host, { moduleResolution: ts.ModuleResolutionKind.Node10 }, 'a.ts', "import { lib } from '@s/lib';\nimport { b } from './b';\nimport { gone } from 'missing';\n");
  assert.deepEqual(found, { imports: ['b.ts'], packages: ['@s/lib'] });
});

test('a changed package dirties the files that import it and, through their surface, their importers; an unchanged one dirties nothing', () => {
  const before: ImportGraph = new Map([['a', node('a', ['b'])], ['b', node('b', [], ['@s/lib'])], ['c', node('c', [], ['other'])], ['d', node('d')]]);
  const after: ImportGraph = new Map(before);
  assert.deepEqual([...dirtySetOf(before, after).dirty], []);
  assert.deepEqual([...dirtySetOf(before, after, new Set(['@s/lib'])).dirty].sort(), ['a', 'b']);
  const unknown: ImportGraph = new Map([...after, ['d', { ...node('d'), packages: undefined }]]);
  assert.ok(dirtySetOf(before, unknown, new Set(['@s/lib'])).dirty.has('d'), 'a record that never listed its packages is judged again');
});

type Install = { version: string; dependencies?: Record<string, string> };

/** An app whose lock holds `installs` (by lock path), whose root manifest declares `rootDeps` and whose `be/package.json` declares `beDeps`. */
function workspaces(t: { after(fn: () => void): void }, installs: Record<string, Install>, rootDeps: Record<string, string>, beDeps: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-fingerprint-reach-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packages = { '': { name: 'demo' }, be: { name: 'be' }, ...Object.fromEntries(Object.entries(installs).map(([key, install]) => [key, { ...install, integrity: `sha512-${install.version}` }])) };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', workspaces: ['be'], devDependencies: rootDeps }));
  fs.mkdirSync(path.join(root, 'be'));
  fs.writeFileSync(path.join(root, 'be', 'package.json'), JSON.stringify({ name: 'be', dependencies: beDeps }));
  return root;
}

const differing = (after: string, before: string): Map<string, string[]> => {
  const tracked = ['package.json', 'be/package.json', 'package-lock.json'];
  const hfsDir = path.join(after, 'node_modules', '@starci', 'hfs');
  return differencesByFamily(fingerprintDifferences(computeFingerprint({ root: before, tracked, hfsDir }).parts, computeFingerprint({ root: after, tracked, hfsDir }).parts));
};

const TOOLS = { '@starci/hfs': '6.0.1', 'starci-harness': '1.1.0-alpha.82', eslint: '10.0.0', prettier: '3.6.0', stylelint: '17.0.0', '@starci/eslint-canon-be': '3.19.3' };
const installsOf = (tools: Record<string, string>, extra: Record<string, Install> = {}): Record<string, Install> => ({
  ...Object.fromEntries(Object.entries(tools).map(([name, version]) => [`node_modules/${name}`, { version }])),
  'node_modules/typescript': { version: '5.9.0' },
  'node_modules/jest': { version: '30.0.0' },
  ...extra,
});

test('a bump of the harness packages re-runs the hfs-run families and neither types, test, lint, format nor sonar', (t) => {
  const base = workspaces(t, installsOf(TOOLS), TOOLS);
  const bumped = { ...TOOLS, '@starci/hfs': '6.0.2', 'starci-harness': '1.1.0-alpha.83' };
  const byFamily = differing(workspaces(t, installsOf(bumped), bumped), base);
  assert.deepEqual([...byFamily.keys()], [], 'the installed versions are no part: the hfs that runs is (hfsDir), and a dependency version is no manifest shape');
  const hfsRun = differencesByFamily(fingerprintDifferences(
    computeFingerprint({ root: base, tracked: [], hfsDir: hfsAt(t, '6.0.1') }).parts,
    computeFingerprint({ root: base, tracked: [], hfsDir: hfsAt(t, '6.0.2') }).parts,
  ));
  assert.deepEqual([...hfsRun.keys()].sort(), ['db', 'hfs', 'secrets', 'wiring'], 'a new hfs re-runs what hfs computes and no unit spec, program or lint file');
});

test('a tool bump re-runs the families whose toolchain it is', (t) => {
  const base = workspaces(t, installsOf(TOOLS), TOOLS);
  const eslintBump = { ...TOOLS, eslint: '10.1.0' };
  const eslint = differing(workspaces(t, installsOf(eslintBump), eslintBump), base);
  assert.deepEqual([...eslint.keys()].sort(), ['lint', 'sonar']);
  assert.deepEqual(eslint.get('lint'), ['lock:lint']);
  const prettierBump = { ...TOOLS, prettier: '3.7.0' };
  assert.deepEqual([...differing(workspaces(t, installsOf(prettierBump), prettierBump), base).keys()], ['format']);
});

test('the test runner, its transform and the compiler re-run every spec; a library a spec loads is no part', (t) => {
  const base = workspaces(t, installsOf(TOOLS, { 'node_modules/lib': { version: '1.0.0' } }), TOOLS, { lib: '1.0.0' });
  const library = differing(workspaces(t, installsOf(TOOLS, { 'node_modules/lib': { version: '1.1.0' } }), TOOLS, { lib: '1.1.0' }), base);
  assert.deepEqual([...library.keys()], []);
  const jest = differing(workspaces(t, { ...installsOf(TOOLS, { 'node_modules/lib': { version: '1.0.0' } }), 'node_modules/jest': { version: '30.1.0' } }, TOOLS, { lib: '1.0.0' }), base);
  assert.deepEqual(jest.get('test'), ['lock:test']);
  assert.equal(jest.has('types'), false, 'a program reads its compiler through its own record, never through Jest');
  const typescript = differing(workspaces(t, { ...installsOf(TOOLS, { 'node_modules/lib': { version: '1.0.0' } }), 'node_modules/typescript': { version: '5.9.1' } }, TOOLS, { lib: '1.0.0' }), base);
  assert.deepEqual(typescript.get('test'), ['lock:test'], 'ts-jest compiles every spec with it');
  assert.deepEqual(typescript.get('lint'), ['lock:lint']);
  assert.equal(typescript.has('types'), false, 'each program lists the TypeScript lib it read: its own record moves');
});

test('the Node major is a part of the unit specs alone, and a jest configuration change re-runs every spec', (t) => {
  const root = workspaces(t, installsOf(TOOLS), TOOLS);
  const hfsDir = path.join(root, 'node_modules', '@starci', 'hfs');
  const on = (nodeVersion: string, tracked: string[] = []) => computeFingerprint({ root, tracked, hfsDir, nodeVersion }).parts;
  assert.deepEqual(differencesByFamily(fingerprintDifferences(on('24.1.0'), on('24.9.0'))).size, 0, 'a minor of Node is no part');
  assert.deepEqual([...differencesByFamily(fingerprintDifferences(on('24.1.0'), on('26.0.0'))).keys()].sort(), ['sonar', 'test']);
  fs.writeFileSync(path.join(root, 'be', 'jest.config.js'), 'module.exports = {};\n');
  const before = on('24.1.0', ['be/jest.config.js']);
  fs.writeFileSync(path.join(root, 'be', 'jest.config.js'), 'module.exports = { clearMocks: true };\n');
  assert.deepEqual([...differencesByFamily(fingerprintDifferences(before, on('24.1.0', ['be/jest.config.js']))).keys()].sort(), ['sonar', 'test']);
});

test('the hfs-run families read the hfs that runs and hfs.json, never the manifests by content', (t) => {
  const base = workspaces(t, installsOf(TOOLS), TOOLS, { lib: '1.0.0' });
  const tracked = ['package.json', 'be/package.json', 'hfs.json', 'turbo.json', '.gitignore'];
  const hfsDir = path.join(base, 'node_modules', '@starci', 'hfs');
  fs.writeFileSync(path.join(base, 'hfs.json'), JSON.stringify({ edition: 'lite' }));
  fs.writeFileSync(path.join(base, 'turbo.json'), '{}');
  fs.writeFileSync(path.join(base, '.gitignore'), 'node_modules\n');
  const before = computeFingerprint({ root: base, tracked, hfsDir }).parts;
  fs.writeFileSync(path.join(base, 'turbo.json'), '{"tasks":{}}');
  fs.writeFileSync(path.join(base, '.gitignore'), 'node_modules\ndist\n');
  fs.writeFileSync(path.join(base, 'be', 'package.json'), JSON.stringify({ name: 'be', dependencies: { lib: '2.0.0' } }));
  assert.deepEqual([...differencesByFamily(fingerprintDifferences(before, computeFingerprint({ root: base, tracked, hfsDir }).parts)).keys()], [], 'turbo.json and .gitignore are read by the rules that run every run, a dependency version by no family');
  fs.writeFileSync(path.join(base, 'hfs.json'), JSON.stringify({ edition: 'full' }));
  assert.deepEqual([...differencesByFamily(fingerprintDifferences(before, computeFingerprint({ root: base, tracked, hfsDir }).parts)).keys()].sort(), ['db', 'hfs', 'lint', 'secrets', 'sonar', 'wiring'], 'the declaration is read by the rules, the custody and the proof');
});

/** An installed @starci/hfs at `version` (its folder under a node_modules, so the fingerprint stays portable). */
function hfsAt(t: { after(fn: () => void): void }, version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-fingerprint-hfs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'node_modules', '@starci', 'hfs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@starci/hfs', version }));
  return dir;
}

test('a @starci package resolved from a registry on this machine, linked, or without integrity has no portable fingerprint; a published install has', () => {
  const published = { version: '1.0.0', integrity: 'sha512-a', resolved: 'https://registry.npmjs.org/@starci/x/-/x-1.0.0.tgz' };
  assert.equal(localReasonOf('x', published, false), null);
  assert.match(localReasonOf('x', { ...published, resolved: 'http://127.0.0.1:4873/@starci/x/-/x-1.0.1-local.1.tgz' }, false) ?? '', /installed from a registry on this machine \(starci deps install-local\)/u);
  assert.match(localReasonOf('x', { ...published, resolved: 'http://localhost:4873/x.tgz' }, false) ?? '', /registry on this machine/u);
  assert.match(localReasonOf('x', published, true) ?? '', /linked or copied from a local folder/u);
  assert.match(localReasonOf('x', { version: '1.0.0' }, false) ?? '', /no recorded integrity/u);
});

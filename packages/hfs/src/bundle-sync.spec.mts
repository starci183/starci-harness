import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePackages, classifyRuntime, readManifest, runtimeFiles, syncBundles } from '../scripts/sync-bundles.mjs';

const packagesDir = fileURLToPath(new URL('../../', import.meta.url));
const hfsRuntimeDir = join(packagesDir, 'hfs', 'runtime');
// Never the real packages: no canon bundles a copy of the hfs runtime any more (CONTRIBUTING.md CONTRIB-20), so the generator is proved on a
// temp package whose manifest lists two copies of hfs runtime files and one file of its own.
const pkg = 'bundling-fixture';
const GENERATED = ['knowledge/hfs/canon-pins.yaml', 'knowledge/hfs/rules.yaml'];
const OWN = ['own/rule.mjs'];

function tempPackages() {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-sync-'));
  const runtime = join(dir, pkg, 'runtime');
  for (const path of GENERATED) cpSync(join(hfsRuntimeDir, path), join(runtime, path));
  mkdirSync(join(runtime, 'own'), { recursive: true });
  mkdirSync(join(runtime, 'engine'), { recursive: true });
  writeFileSync(join(runtime, OWN[0] as string), 'export const rule = 1;\n');
  writeFileSync(join(runtime, 'bundle.json'), `${JSON.stringify({ generated: GENERATED, own: OWN }, null, 2)}\n`);
  return dir;
}
const run = (dir: string, check: boolean) => syncBundles({ packagesDir: dir, hfsRuntimeDir, check, packages: [pkg] });
const bytes = (dir: string, path: string) => readFileSync(join(dir, pkg, 'runtime', path));

test('no package bundles a copy of the hfs runtime: each reads it from the installed hfs and keeps only its own files', () => {
  for (const name of bundlePackages) assert.deepEqual(readManifest(join(packagesDir, name, 'runtime', 'bundle.json')).generated, [], name);
});

test('the committed manifests are exactly what the packages hold today', () => {
  for (const name of bundlePackages) {
    const runtimeDir = join(packagesDir, name, 'runtime');
    const manifest = readManifest(join(runtimeDir, 'bundle.json'));
    assert.deepEqual([...manifest.generated, ...manifest.own].sort(), runtimeFiles(runtimeDir), name);
    assert.deepEqual(classifyRuntime(runtimeDir, hfsRuntimeDir).generated, [...manifest.generated].sort(), name);
  }
});

test('the generator reproduces every generated file byte for byte', () => {
  const dir = tempPackages();
  try {
    const { generated } = readManifest(join(dir, pkg, 'runtime', 'bundle.json'));
    assert.ok(generated.length > 0);
    for (const path of generated) writeFileSync(join(dir, pkg, 'runtime', path), 'stale\n');
    const result = run(dir, false);
    assert.equal(result.drift.length, 0);
    assert.equal(result.written.length, generated.length);
    for (const path of generated) assert.ok(bytes(dir, path).equals(readFileSync(join(hfsRuntimeDir, path))), path);
    assert.equal(run(dir, false).written.length, 0, 'a second run writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the generator recreates a deleted generated file', () => {
  const dir = tempPackages();
  try {
    const { generated } = readManifest(join(dir, pkg, 'runtime', 'bundle.json'));
    rmSync(join(dir, pkg, 'runtime', generated[0] as string));
    assert.deepEqual(run(dir, false).written, [`${pkg}/runtime/${generated[0]}`]);
    assert.ok(existsSync(join(dir, pkg, 'runtime', generated[0] as string)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('own files are left alone', () => {
  const dir = tempPackages();
  try {
    const { own, generated } = readManifest(join(dir, pkg, 'runtime', 'bundle.json'));
    assert.ok(own.length > 0);
    for (const path of own) writeFileSync(join(dir, pkg, 'runtime', path), `own edit of ${path}\n`);
    writeFileSync(join(dir, pkg, 'runtime', generated[0] as string), 'stale\n');
    const result = run(dir, false);
    assert.deepEqual(result.written, [`${pkg}/runtime/${generated[0]}`]);
    for (const path of own) assert.equal(bytes(dir, path).toString('utf8'), `own edit of ${path}\n`);
    assert.equal(run(dir, true).drift.length, 0, 'an edited own file is not drift');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check passes on a clean copy and writes nothing', () => {
  const dir = tempPackages();
  try {
    assert.deepEqual(run(dir, true), { written: [], drift: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check reports a drifted, a missing and an unlisted file without writing', () => {
  const dir = tempPackages();
  try {
    const { generated } = readManifest(join(dir, pkg, 'runtime', 'bundle.json'));
    writeFileSync(join(dir, pkg, 'runtime', generated[0] as string), 'stale\n');
    rmSync(join(dir, pkg, 'runtime', generated[1] as string));
    writeFileSync(join(dir, pkg, 'runtime', 'engine', 'extra.mjs'), 'export {}\n');
    const result = run(dir, true);
    assert.deepEqual(result.written, []);
    assert.deepEqual(
      result.drift.map((item) => `${item.reason}:${item.path}`).sort(),
      [`differs:${generated[0]}`, `missing:${generated[1]}`, 'unlisted:engine/extra.mjs'].sort(),
    );
    assert.equal(readFileSync(join(dir, pkg, 'runtime', generated[0] as string), 'utf8'), 'stale\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

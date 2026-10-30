import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePackages, classifyRuntime, readManifest, runtimeFiles, syncBundles } from '../scripts/sync-bundles.mjs';

const packagesDir = fileURLToPath(new URL('../../', import.meta.url));
const hfsRuntimeDir = join(packagesDir, 'hfs', 'runtime');
// Never the real packages: each test works on a temp copy of one bundling package's runtime/ folder.
const pkg = 'eslint-grammar-offset-pop';

function tempPackages() {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-sync-'));
  cpSync(join(packagesDir, pkg, 'runtime'), join(dir, pkg, 'runtime'), { recursive: true });
  return dir;
}
const run = (dir, check) => syncBundles({ packagesDir: dir, hfsRuntimeDir, check, packages: [pkg] });
const bytes = (dir, path) => readFileSync(join(dir, pkg, 'runtime', path));

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
    for (const path of generated) assert.ok(bytes(dir, path).equals(readFileSync(join(packagesDir, pkg, 'runtime', path))), path);
    assert.equal(run(dir, false).written.length, 0, 'a second run writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the generator recreates a deleted generated file', () => {
  const dir = tempPackages();
  try {
    const { generated } = readManifest(join(dir, pkg, 'runtime', 'bundle.json'));
    rmSync(join(dir, pkg, 'runtime', generated[0]));
    assert.deepEqual(run(dir, false).written, [`${pkg}/runtime/${generated[0]}`]);
    assert.ok(existsSync(join(dir, pkg, 'runtime', generated[0])));
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
    writeFileSync(join(dir, pkg, 'runtime', generated[0]), 'stale\n');
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
    writeFileSync(join(dir, pkg, 'runtime', generated[0]), 'stale\n');
    rmSync(join(dir, pkg, 'runtime', generated[1]));
    writeFileSync(join(dir, pkg, 'runtime', 'engine', 'extra.mjs'), 'export {}\n');
    const result = run(dir, true);
    assert.deepEqual(result.written, []);
    assert.deepEqual(
      result.drift.map((item) => `${item.reason}:${item.path}`).sort(),
      [`differs:${generated[0]}`, `missing:${generated[1]}`, 'unlisted:engine/extra.mjs'].sort(),
    );
    assert.equal(readFileSync(join(dir, pkg, 'runtime', generated[0]), 'utf8'), 'stale\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

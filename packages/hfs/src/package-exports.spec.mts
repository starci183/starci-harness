// The public specifiers of @starci/hfs keep resolving after the move to TypeScript sources: the same path strings
// name the same files in the packed tarball. Two proofs: `npm pack --dry-run --json` lists every file the tarball
// ships (each specifier's file must be in it, and no .mts source may leak), and `import.meta.resolve` of this
// package's own name proves the exports map answers each specifier as written. The list is every specifier
// cli/src, the sibling packages and the shipped scripts use; a new public specifier is added here when it is
// made public.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every specifier another package or a shipped script uses, exactly as written, and the file inside the tarball
// the specifier must land on.
const SPECIFIERS: [string, string][] = [
  ['@starci/hfs', 'src/main.mjs'],
  ['@starci/hfs/form-bounds', 'emit/form-bounds.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/slots.mjs', 'runtime/scripts/hfs/slots.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/secret-store.mjs', 'runtime/scripts/hfs/secret-store.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/secret-document.mjs', 'runtime/scripts/hfs/secret-document.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/secret-sops.mjs', 'runtime/scripts/hfs/secret-sops.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/check.mjs', 'runtime/scripts/hfs/check.mjs'],
  ['@starci/hfs/runtime/scripts/hfs/example-secrets.mjs', 'runtime/scripts/hfs/example-secrets.mjs'],
  ['@starci/hfs/runtime/scripts/guards/release-push-gate.mjs', 'runtime/scripts/guards/release-push-gate.mjs'],
  ['@starci/hfs/runtime/engine/yaml.mjs', 'runtime/engine/yaml.mjs'],
  ['@starci/hfs/runtime/knowledge/hfs/slots.yaml', 'runtime/knowledge/hfs/slots.yaml'],
  ['@starci/hfs/runtime/knowledge/hfs/design-truths.yaml', 'runtime/knowledge/hfs/design-truths.yaml'],
];

test('every public specifier resolves through the exports map', () => {
  for (const [specifier] of SPECIFIERS) {
    assert.doesNotThrow(() => import.meta.resolve(specifier), specifier);
  }
});

// Normal pack lifecycles rebuild HFS's collocated .mjs files. Build a private copy so workers in other spec processes never
// import a file while prepack is rewriting it, and the pack walk never meets another spec's temporary fixture directory.
function packDryRun(t: TestContext): string {
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'starci-hfs-pack-'));
  const install = path.join(scratch, 'node_modules');
  t.after(() => {
    assert.equal(path.dirname(scratch), parent);
    assert.ok(path.basename(scratch).startsWith('starci-hfs-pack-'));
    const dependencyLink = fs.lstatSync(install, { throwIfNoEntry: false });
    if (dependencyLink) {
      assert.ok(dependencyLink.isSymbolicLink());
      fs.unlinkSync(install);
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const sources = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const source of sources) {
    const target = path.join(scratch, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, source), target);
  }
  fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'node_modules')), install, 'junction');
  return execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: scratch, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('the packed tarball ships every specifier\'s file and no .mts source without rebuilding live workers', t => {
  const compiler = path.join(ROOT, 'emit/compiler.mjs');
  const before = fs.statSync(compiler, { bigint: true }).mtimeNs;
  const packed = JSON.parse(packDryRun(t));
  assert.equal(fs.statSync(compiler, { bigint: true }).mtimeNs, before, 'prepack must not rewrite the compiler imported by live workers');
  const files = new Set<string>(packed.flatMap((entry: { files: { path: string }[] }) => entry.files.map((file) => file.path)));
  for (const [specifier, target] of SPECIFIERS) {
    assert.ok(files.has(target), `${specifier} -> ${target} missing from the tarball`);
  }
  for (const file of files) {
    assert.ok(!file.endsWith('.mts') || file.endsWith('.d.mts'), `source ${file} leaks into the tarball`);
  }
});

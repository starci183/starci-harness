// Every non-empty set of sides (PROJECT-1) at the scaffold: a project with be scaffolds in both editions and its own check raises nothing a default
// starter of its edition does not; the front end's codegen script and `codegen` script exist exactly when fe is declared (managedWhenSides of
// slot app.scripts). A project without be is lawful in hfs.json but has no starter yet: the scaffold refuses it (HFS_SCAFFOLD_SIDES).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { ScaffoldError } from '../scaffold/service.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import type { ProjectSide } from '../runtime/scripts/hfs/project-sides.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A starter of `edition` and `sides`: its root, files and the error codes of its own check. */
function starter(t: TestContext, edition: string, sides: readonly ProjectSide[], contract: 'graphql' | 'rest' = 'graphql'): { root: string; files: string[]; codes: string[] } {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-side-combo-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init, sides, contract });
  const codes = checkRepo({ repoRoot: root, harness: HARNESS, files }).findings.filter((finding) => finding.level === 'error').map((finding) => finding.code);
  return { root, files, codes };
}
const scripts = (root: string): Record<string, string> => (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

const WITH_BE: ReadonlyArray<readonly ProjectSide[]> = [['be'], ['be', 'fe'], ['be', 'packages'], ['be', 'fe', 'packages']];

for (const edition of ['lite', 'full']) {
  test(`${edition}: every side set with be scaffolds and checks as clean as the default starter, with the codegen exactly when fe is declared`, (t) => {
    const baseline = new Set(starter(t, edition, ['be', 'fe']).codes);
    for (const sides of WITH_BE) {
      for (const contract of ['graphql', 'rest'] as const) {
        const label = `${edition} ${sides.join('+')} ${contract}`;
        const { root, files, codes } = starter(t, edition, sides, contract);
        assert.deepEqual(codes.filter((code) => !baseline.has(code)), [], label);
        const fe = sides.includes('fe');
        assert.equal(files.includes('scripts/codegen.mjs'), fe, `${label}: scripts/codegen.mjs`);
        assert.equal(typeof scripts(root).codegen === 'string', fe, `${label}: the codegen script`);
        assert.equal(files.some((file) => file.startsWith('fe/')), fe, `${label}: the fe folder`);
        assert.equal(files.some((file) => file.startsWith('packages/')), sides.includes('packages'), `${label}: the packages folder`);
      }
    }
  });
}

test('a project without be is lawful in hfs.json but has no starter yet: the scaffold refuses it', (t) => {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-side-combo-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  for (const sides of [['fe'], ['packages'], ['fe', 'packages']] as const) {
    assert.throws(() => scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit: init, sides }),
      (error: unknown) => error instanceof ScaffoldError && error.code === 'HFS_SCAFFOLD_SIDES' && /without be is lawful in hfs\.json but has no starter yet/u.test(error.message), sides.join('+'));
  }
  assert.deepEqual(fs.readdirSync(into), [], 'nothing is written');
});

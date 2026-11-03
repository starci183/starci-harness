// proves: STACKS_LOCAL_CONFIG_INVALID@full
// proves: STACKS_RUNBOOK_DOCKER_COMMAND@full
// A fresh starter of either edition passes its own check on what it declares: the dev environment carries the local block `starci app stack up`
// runs and a runbook that names that verb (R372, R373), and every Dockerfile copies only folders the app holds (R187: a back end that emits no
// contract has no be/contracts/, so no Next image copies it).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const JUDGED = /^(?:STACKS_|HFS_DOCKER_)/u;

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** Scaffolds a starter of `edition` into a temporary folder and answers the stack and image findings its own check raises. */
function starterFindings(t: TestContext, edition: string): { root: string; codes: string[] } {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-scaffold-check-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
  const codes = checkRepo({ repoRoot: root, harness: HARNESS, files }).findings.map((finding) => finding.code).filter((code) => JUDGED.test(code));
  return { root, codes };
}

for (const edition of ['lite', 'full']) {
  test(`a fresh ${edition} starter raises no stack or image finding of its own check`, (t) => {
    const { root, codes } = starterFindings(t, edition);
    assert.deepEqual(codes, []);
    assert.match(fs.readFileSync(path.join(root, '.starcistacks', 'dev', 'README.md'), 'utf8'), /starci app stack up --env dev --execute/u);
  });
}

test('the full starter\'s Next images copy no be/contracts while its back end emits no contract', (t) => {
  const { root } = starterFindings(t, 'full');
  assert.equal(fs.existsSync(path.join(root, 'be', 'contracts')), false);
  for (const app of ['app', 'landing']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'fe', 'apps', app, 'Dockerfile'), 'utf8'), /COPY be\/contracts/u, app);
  }
});

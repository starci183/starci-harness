// Spec: the release check is `starci app check --release`; `starci app release gate` is its deprecated spelling, which says so on stderr and runs the
// same check (release/index.mts releaseCheckMain, RENAMED_GATE).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { RENAMED_GATE } from '../release/index.mjs';
import { main, USAGE } from './main.mjs';

/** Runs `starci app <argv>` in a folder with no package.json: the release check refuses it after parsing its flags, so the path it took is visible. */
async function app(t: TestContext, argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const cwd = fs.mkdtempSync(path.join(tempRoot(), 'hfs-release-check-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let out = '';
  let err = '';
  const code = await main(argv, { cwd, stdout: (text: string) => { out += text; }, stderr: (text: string) => { err += text; } });
  return { code, out, err };
}

test('app check --release runs the release check and prints no rename notice', async (t) => {
  const run = await app(t, ['check', '--release', '--fresh']);
  assert.match(run.err, /^starci app check --release: RELEASE_PACKAGE_UNREADABLE: package\.json is not readable JSON/mu);
  assert.ok(!run.err.includes(RENAMED_GATE));
});

test('app release gate says it was renamed, then runs the same check with the same flags', async (t) => {
  const run = await app(t, ['release', 'gate', '--fresh']);
  assert.ok(run.err.startsWith(`${RENAMED_GATE}\n`), run.err);
  assert.equal(RENAMED_GATE, 'renamed: use starci app check --release');
  assert.match(run.err, /package\.json is not readable JSON/u);
});

test('app check --release refuses a check flag that is no release flag, and accepts --full without printing it in the usage', async (t) => {
  const refused = await app(t, ['check', '--release', '--gate', 'lint']);
  assert.match(refused.err, /unknown flag --gate/u);
  const full = await app(t, ['check', '--release', '--full']);
  assert.match(full.err, /package\.json is not readable JSON/u, '--full still parses');
  const line = USAGE.split('\n').find((text) => text.startsWith('starci app check --release '));
  assert.ok(line?.includes('[--fresh]'), line);
  assert.ok(!line?.includes('[--full]'), line);
  assert.ok(USAGE.includes('starci app release gate') && USAGE.includes('(deprecated: starci app check --release)'));
});

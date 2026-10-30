// `starci app db post-cutover` opens its time gate one way: --green-at <ISO> old enough, or else --owner-confirms-old-app-gone. Given both,
// the owner's word would skip the age check and the --green-at would be dropped, so the pair is refused before the app is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbPostCutoverMain } from '../db/post-cutover.mjs';

test('--green-at and --owner-confirms-old-app-gone together are refused as alternatives', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-post-cutover-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let err = '';
  const code = await dbPostCutoverMain(['--green-at', '2026-01-01T00:00:00Z', '--owner-confirms-old-app-gone'], { cwd, stdout: () => {}, stderr: (text) => { err += text; } });
  assert.equal(code, 2);
  assert.equal(err, 'starci app db post-cutover: DB_USAGE: --green-at and --owner-confirms-old-app-gone are alternative openings of the time gate: give one\n');
});

test('either opening alone passes the flag check and reaches the app', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-post-cutover-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const argv of [['--green-at', '2026-01-01T00:00:00Z'], ['--owner-confirms-old-app-gone']]) {
    let err = '';
    await dbPostCutoverMain(argv, { cwd, stdout: () => {}, stderr: (text) => { err += text; } });
    assert.doesNotMatch(err, /DB_USAGE/, argv.join(' '));
  }
});

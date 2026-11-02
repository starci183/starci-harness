// The whole-program steps of the structure pass (the architecture machine and the unused-symbol analysis of a side) are reused by the side key, which covers the untracked program
// inputs of the side (generated code the tsconfig includes): contexts/project/check-cache.md "Which step reuses what". Each test runs the real pass over a small two-sided app in a temp git
// repository, with the machine and the contract emit as doubles that count their runs; the fe side includes a git-ignored generated file, the case that never reused its steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATED, appRepo, changed, runPass, write } from './check-cache-structure-support.mjs';

const WHOLE_PROGRAM = (side: string): string[] => [`${side} machine`, `${side} unused-symbol`];
const sorted = (list: readonly string[]): string[] => [...list].sort();
/** The records a run rewrote other than the always-run rules' own findings (step `hfs`). */
const steps = (keys: readonly string[]): string[] => keys.filter((key) => !key.endsWith(' hfs'));

test('S1 cold run records every step of both sides, the side with untracked generated inputs included', async (t) => {
  const root = appRepo(t);
  const { calls, hfs, pass } = await runPass(root);
  assert.deepEqual(sorted(calls), ['be', 'fe']);
  assert.equal(pass.report?.mode, 'full');
  const keys = new Set(hfs.map((record) => `${record.path} ${record.step}`));
  for (const key of [...WHOLE_PROGRAM('be'), ...WHOLE_PROGRAM('fe'), 'be contract-emit']) assert.ok(keys.has(key), `${key} is recorded: ${[...keys].filter((each) => /machine|unused|emit/.test(each)).join(', ')}`);
});

test('S1 warm unchanged run reuses every step (checked 0) and finds what the cold run found', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  const warm = await runPass(root);
  assert.deepEqual(warm.calls, [], 'neither machine ran');
  assert.equal(warm.pass.report?.mode, 'diff');
  assert.equal(warm.pass.report?.checked, 0);
  assert.ok((warm.pass.report?.reused ?? 0) > 0);
  assert.deepEqual(steps(changed(cold.hfs, warm.hfs)), [], 'no step record was rewritten');
  // The first run wrote the cache folder, which the fixture neither tracks nor ignores (a real app does), so the untracked-entry rule sees it from the second run on.
  const render = (findings: readonly { code: string }[]): string[] => findings.filter((finding) => finding.code !== 'HFS_UNTRACKED_ROOT_ENTRY').map((finding) => JSON.stringify(finding, Object.keys(finding).sort())).sort();
  assert.deepEqual(render(warm.pass.result.findings), render(cold.pass.result.findings), 'a reused pass finds exactly what a full pass finds');
});

test('S1 a generated (untracked) input changing re-runs that side\'s whole-program steps and only that side\'s', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  write(root, GENERATED, 'export const generated = 2;\n');
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['fe']);
  assert.deepEqual(steps(changed(cold.hfs, next.hfs)), sorted(WHOLE_PROGRAM('fe')));
  const stable = await runPass(root);
  assert.deepEqual(stable.calls, [], 'the same generated code is reused');
});

test('S1 a generated input edited while the run reads it discards the record that depends on it, and only that one', async (t) => {
  const root = appRepo(t);
  const during = (side: string): void => { if (side === 'fe') write(root, GENERATED, 'export const generated = "edited during the run";\n'); };
  const { hfs } = await runPass(root, { during });
  const keys = new Set(hfs.map((record) => `${record.path} ${record.step}`));
  assert.ok(!keys.has('fe machine'), 'the fe machine read a file that changed under it');
  assert.ok(keys.has('be machine') && keys.has('be unused-symbol'));
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['fe'], 'the next run judges fe for real and reuses be');
});

test('S1 a tracked file edited during the run discards only what depends on it', async (t) => {
  const root = appRepo(t);
  const during = (side: string): void => { if (side === 'be') write(root, 'be/src/notes.ts', 'export const notes = "edited during the run";\n'); };
  const { hfs } = await runPass(root, { during });
  const keys = new Set(hfs.map((record) => `${record.path} ${record.step}`));
  assert.ok(!keys.has('be machine'), 'the be machine ran over a file that changed under it');
  assert.ok(keys.has('fe machine') && keys.has('fe unused-symbol'), 'the other side keeps its steps');
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['be']);
});

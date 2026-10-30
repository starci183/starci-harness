// Spec: the release tag is <tagPrefix><package.json version>, never the first free patch tag
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { normalizeRelease, releaseGate } from '../release/gate.mjs';
import type { Spawn } from '../stack/context.mjs';
import type { VerbContext } from '../release/index.mjs';

const HEAD = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

/** A checkout whose git answers: existing tags `tags` (name -> commit), the release dry run asks nothing else. */
const checkout = (t: TestContext, tags: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-release-tag-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const spawn = (command: string, args: string[]) => {
    assert.equal(command, 'git');
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: HEAD };
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main' };
    if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { status: 0, stdout: path.join(root, '.git') };
    if (args[0] === 'status') return { status: 0, stdout: '' };
    if (args[0] === 'tag' && args[1] === '--list') return { status: 0, stdout: Object.keys(tags).join('\n') };
    if (args[0] === 'tag' && args[1] === '--points-at') return { status: 0, stdout: Object.keys(tags).filter((name) => tags[name] === HEAD).join('\n') };
    if (args[0] === 'cat-file') return { status: 0, stdout: 'tag' };
    if (args[0] === 'ls-remote') return { status: 0, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: HEAD };
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  // reason: the double answers only { status, stdout }, the two fields the release gate reads; the real Spawn is overloaded and its result also carries stderr.
  return { root, spawn: spawn as unknown as Spawn };
};

const dryRun = async (t: TestContext, version: string, tags: Record<string, string>, options: { tagPrefix?: string } = {}) => {
  const { root, spawn } = checkout(t, tags);
  const { config } = normalizeRelease({ gates: [{ name: 'unit', command: ['unit-probe'] }] });
  // reason: the gate reads only cwd, spawn, now and env of the context; the rest of the stack context is not needed for a dry run.
  const ctx = { cwd: root, spawn, now: () => 1000, env: {} } as unknown as VerbContext;
  return releaseGate(ctx, { ...config!, version }, { platform: 'linux', ...options });
};

test('the release tag is the package version even when earlier patch tags are free', async (t) => {
  const result = await dryRun(t, '0.3.5', { 'v0.3.0': OTHER, 'v0.3.1': OTHER, 'v0.3.2': OTHER, 'v0.3.3': OTHER });
  assert.equal(result.ok, true);
  assert.equal(result.data!.tag, 'v0.3.5');
});

test('a tag of the package version that sits on another commit refuses the gate instead of taking another name', async (t) => {
  const result = await dryRun(t, '0.3.5', { 'v0.3.5': OTHER });
  assert.equal(result.ok, false);
  assert.equal(result.data!.tag, 'v0.3.5');
  assert.match((result.data!.red as string[]).join('\n'), /v0\.3\.5 already exists on another commit/u);
});

test('an annotated tag of the package version already on HEAD is reused', async (t) => {
  const result = await dryRun(t, '0.3.5', { 'v0.3.5': HEAD });
  assert.equal(result.ok, true);
  assert.equal(result.data!.tag, 'v0.3.5');
});

test('HEAD tagged with another version than package.json refuses the gate instead of adding a second tag', async (t) => {
  const result = await dryRun(t, '0.3.5', { 'v0.3.4': HEAD });
  assert.equal(result.ok, false);
  assert.match((result.data!.red as string[]).join(' '), /HEAD already carries the release tag v0\.3\.4 but package\.json version 0\.3\.5 gives v0\.3\.5/u);
});

test('release.tagMatchesVersion is removed: the block refuses it and says to delete it', () => {
  for (const value of [true, false]) {
    const { problems, config } = normalizeRelease({ tagMatchesVersion: value });
    assert.equal(config, undefined);
    assert.match(problems.join('\n'), /release\.tagMatchesVersion: is removed .*delete the key/u);
  }
});

test('a tag of another version on HEAD refuses the gate under any prefix, annotated or not', async (t) => {
  const prefixed = await dryRun(t, '0.3.5', { 'v0.3.4': HEAD }, { tagPrefix: 'r' });
  assert.equal(prefixed.ok, false);
  assert.equal(prefixed.data!.tag, 'r0.3.5');
  assert.equal((prefixed.data!.red as string[]).length, 1);
  const unrelated = await dryRun(t, '0.3.5', { nightly: HEAD });
  assert.equal(unrelated.ok, true, 'a tag with no version in its name is no release tag');
});

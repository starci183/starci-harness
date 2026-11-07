// Spec: every push carries the warm cache a real run on its tree writes (`starci app check --env prod`, the managed pre-push hook; check-cache.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freshnessFindings, uncommittedCacheFiles, UNPORTABLE, UNWARMED } from '../cache/freshness.mjs';

function repo(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-cache-fresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'fingerprint.jsonl'), '{"name":"hfs","sha256":"a"}\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'root.jsonl'), '{}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'warm');
  return root;
}

const portable = { portable: true, localReasons: [] as string[], written: [] as string[], removed: [] as string[] };

test('a committed cache the run left as it was passes; a written, removed or uncommitted cache file refuses the push', (t) => {
  const root = repo(t);
  assert.deepEqual(uncommittedCacheFiles(root), []);
  assert.deepEqual(freshnessFindings({ root, ...portable }), []);
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'root.jsonl'), '{"edited":true}\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'new.jsonl'), '{}\n');
  assert.deepEqual(uncommittedCacheFiles(root), ['.starcistacks/cache/check/hfs/new.jsonl', '.starcistacks/cache/check/hfs/root.jsonl']);
  const [refusal] = freshnessFindings({ root, ...portable, written: ['.starcistacks/cache/lint/be/src.jsonl'] });
  assert.equal(refusal?.code, UNWARMED);
  assert.equal(refusal?.level, 'error');
  assert.match(refusal?.message ?? '', /\.starcistacks\/cache\/check\/hfs\/new\.jsonl, .*lint\/be\/src\.jsonl.*commit \.starcistacks\/cache as this run left it/u);
  const many = freshnessFindings({ root, ...portable, uncommitted: [], removed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.match(many[0]?.message ?? '', /a, b, c, d, e, and 2 more/u);
});

test('a host that cannot write a portable cache refuses the push and names the remedy; git that cannot answer refuses too', (t) => {
  const root = repo(t);
  const [unportable] = freshnessFindings({ root, ...portable, portable: false, localReasons: ['@starci/hfs runs from a local folder (hfs)'] });
  assert.equal(unportable?.code, UNPORTABLE);
  assert.match(unportable?.message ?? '', /@starci\/hfs runs from a local folder \(hfs\).*starci deps install-local --restore/u);
  assert.match(freshnessFindings({ root, ...portable, portable: false, localReasons: [] })[0]?.message ?? '', /\(a local package\)/u);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-cache-fresh-nogit-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.deepEqual(uncommittedCacheFiles(outside), ['.starcistacks/cache (git status failed)']);
});

// Spec: every push carries the warm cache a real run on its tree writes (`starci app check --env prod`, the managed pre-push hook; check-cache.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freshnessFindings, pristineFirstCommit, uncommittedCacheFiles, UNPORTABLE, UNWARMED } from '../cache/freshness.mjs';

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

test('a committed cache the run left as it was passes; a written, removed or uncommitted cache file is info in a run and an error at the push gate', (t) => {
  const root = repo(t);
  assert.deepEqual(uncommittedCacheFiles(root), []);
  assert.deepEqual(freshnessFindings({ root, ...portable }), []);
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'root.jsonl'), '{"edited":true}\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'new.jsonl'), '{}\n');
  assert.deepEqual(uncommittedCacheFiles(root), ['.starcistacks/cache/check/hfs/new.jsonl', '.starcistacks/cache/check/hfs/root.jsonl']);
  // A run that wrote records is judged on its findings alone: the unwarmed cache is info, never an error, so the run is not red for it.
  const [reported] = freshnessFindings({ root, ...portable, written: ['.starcistacks/cache/lint/be/src.jsonl'] });
  assert.equal(reported?.code, UNWARMED);
  assert.equal(reported?.level, 'info');
  assert.match(reported?.message ?? '', /\.starcistacks\/cache\/check\/hfs\/new\.jsonl, .*lint\/be\/src\.jsonl.*report only/u);
  // The managed pre-push hook's run (STARCI_PUSH_GATE=1) is the one place a cold cache costs something: there it refuses and names `app push`.
  const [refusal] = freshnessFindings({ root, ...portable, pushGate: true, written: ['.starcistacks/cache/lint/be/src.jsonl'] });
  assert.equal(refusal?.code, UNWARMED);
  assert.equal(refusal?.level, 'error');
  assert.match(refusal?.message ?? '', /\.starcistacks\/cache\/check\/hfs\/new\.jsonl, .*lint\/be\/src\.jsonl.*starci app push/u);
  const many = freshnessFindings({ root, ...portable, uncommitted: [], removed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.match(many[0]?.message ?? '', /a, b, c, d, e, and 2 more/u);
});

test('a host that cannot write a portable cache refuses the push and names the remedy; git that cannot answer refuses too', (t) => {
  const root = repo(t);
  const [unportable] = freshnessFindings({ root, ...portable, portable: false, localReasons: ['@starci/hfs runs from a local folder (hfs)'] });
  assert.equal(unportable?.code, UNPORTABLE);
  assert.match(unportable?.message ?? '', /@starci\/hfs runs from a local folder \(hfs\).*starci deps install-local --restore/u);
  assert.match(freshnessFindings({ root, ...portable, portable: false, localReasons: [] })[0]?.message ?? '', /\(a local package\)/u);
  // The integrity-side findings stay errors in every run, push gate or not: only the unwarmed one was ever a fact about the commit.
  for (const pushGate of [false, true]) assert.equal(freshnessFindings({ root, ...portable, portable: false, localReasons: [], pushGate })[0]?.level, 'error');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-cache-fresh-nogit-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.deepEqual(uncommittedCacheFiles(outside), ['.starcistacks/cache (git status failed)']);
});

test('the pristine first commit (a root commit with no cache, what app scaffold records) passes the push gate; any later commit is judged', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-cache-first-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'hfs.json'), '{}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'scaffold');
  assert.equal(pristineFirstCommit(root), true);
  // The hook's run writes the cache into the working tree: the first commit does not carry it, so there is nothing stale to push.
  fs.mkdirSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'cache', 'check', 'hfs', 'root.jsonl'), '{}\n');
  const written = ['.starcistacks/cache/check/hfs/root.jsonl'];
  assert.deepEqual(freshnessFindings({ root, ...portable, written }), []);
  assert.deepEqual(freshnessFindings({ root, ...portable, portable: false, localReasons: ['@starci/x is linked'], written }), [], 'the first commit pushes no cache, so none can be unportable');
  // The next commit (the cache on dev, or any work) has a parent: the push gate judges it.
  git('commit', '-q', '--allow-empty', '-m', 'work');
  assert.equal(pristineFirstCommit(root), false);
  assert.equal(freshnessFindings({ root, ...portable, written })[0]?.code, UNWARMED);
  // A root commit that carries a cache is judged like any other.
  const warm = repo(t);
  assert.equal(pristineFirstCommit(warm), false);
  assert.equal(freshnessFindings({ root: warm, ...portable, written })[0]?.code, UNWARMED);
  assert.equal(freshnessFindings({ root: warm, ...portable, written, firstCommit: true }).length, 0, 'the caller may answer the question itself');
});

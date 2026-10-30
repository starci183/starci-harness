import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskSession } from '../cache/session.mjs';
import { silentProgress, createProgress, elapsedText } from '../cache/progress.mjs';
import { fingerprintDifferences, parseFingerprint, serializeFingerprint } from '../cache/fingerprint.mjs';
import { diffIndex } from '../cache/content-index.mjs';
import { resolveTrust, readCacheAt, verifyCommitted, FORGED, STALE, MISSING } from '../cache/trust.mjs';
import { hashText } from '../cache/hash.mjs';
import { git } from '../cache/git.mjs';
import { toolCacheDir } from '../cache/run-log.mjs';
import type { CacheRecord, FingerprintPart } from '../cache/types.mjs';

const PORTABLE = { parts: [{ name: 'hfs', sha256: 'h1' }] as FingerprintPart[], portable: true, localReasons: [] };
const rec = (file: string, text: string, findings: CacheRecord['findings'] = []): CacheRecord => ({ path: file, step: 'prettier', hash: hashText(text), findings });

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-session-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  git(root, ['init', '-q', '-b', 'main']);
  return root;
}

function commit(root: string, message: string): string {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

const options = (root: string, tracked: string[], extra: object = {}) => ({ root, tracked, env: {}, progress: silentProgress, fingerprint: PORTABLE, ...extra });

test('a tree with no cache runs full, writes the records byte-stably and the next run is diff', (t) => {
  const root = repo({ 'a.ts': 'x\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = createDiskSession(options(root, ['a.ts']));
  assert.deepEqual(first.decide('format'), { mode: 'full', reason: 'no cache in the tree' });
  first.replace('check/format', [rec('a.ts', 'x\n')], { depth: 3 });
  const written = first.flush();
  assert.ok(written.written.includes('.starcistacks/cache/check/format/root.jsonl'));
  assert.ok(written.written.includes('.starcistacks/cache/fingerprint.jsonl'));
  const bytes = fs.readFileSync(path.join(root, '.starcistacks/cache/check/format/root.jsonl'), 'utf8');
  const second = createDiskSession(options(root, ['a.ts']));
  assert.equal(second.decide('format').mode, 'diff');
  assert.equal(second.records('check/format').length, 1);
  second.replace('check/format', second.records('check/format'), { depth: 3 });
  assert.deepEqual(second.flush().written, []);
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks/cache/check/format/root.jsonl'), 'utf8'), bytes);
});

test('--full, a release env and a differing fingerprint each force a full run with their reason', (t) => {
  const root = repo({ 'a.ts': 'x\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = createDiskSession(options(root, ['a.ts']));
  seed.replace('check/format', [rec('a.ts', 'x\n')]);
  seed.flush();
  assert.equal(createDiskSession(options(root, ['a.ts'], { full: new Set(['format']) })).decide('format').reason, '--full');
  assert.equal(createDiskSession(options(root, ['a.ts'], { full: new Set(['format']) })).decide('lint').mode, 'diff');
  const release = createDiskSession(options(root, ['a.ts'], { env: { STARCI_APP_CHECK_CACHE: 'full' } }));
  assert.equal(release.decide('lint').mode, 'full');
  assert.equal(release.writes, false);
  const changed = createDiskSession(options(root, ['a.ts'], { fingerprint: { ...PORTABLE, parts: [{ name: 'hfs', sha256: 'h2' }] } }));
  assert.match(changed.decide('lint').reason, /the fingerprint differs \(hfs\)/);
  const local = createDiskSession(options(root, ['a.ts'], { fingerprint: { parts: [], portable: false, localReasons: ['@starci/x is linked'] } }));
  assert.match(local.decide('lint').reason, /no portable fingerprint, nothing is written/);
  assert.equal(local.writes, false);
});

test('a new fingerprint drops the folders the run did not rewrite', (t) => {
  const root = repo({ 'a.ts': 'x\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = createDiskSession(options(root, ['a.ts']));
  seed.replace('check/format', [rec('a.ts', 'x\n')]);
  seed.replace('lint/be', [rec('a.ts', 'x\n')]);
  seed.flush();
  const next = createDiskSession(options(root, ['a.ts'], { fingerprint: { ...PORTABLE, parts: [{ name: 'hfs', sha256: 'h2' }] } }));
  next.replace('check/format', [rec('a.ts', 'x\n')]);
  next.flush();
  assert.ok(fs.existsSync(path.join(root, '.starcistacks/cache/check/format/root.jsonl')));
  assert.ok(!fs.existsSync(path.join(root, '.starcistacks/cache/lint')));
  assert.deepEqual(parseFingerprint(fs.readFileSync(path.join(root, '.starcistacks/cache/fingerprint.jsonl'), 'utf8')), [{ name: 'hfs', sha256: 'h2' }]);
});

test('a file edited while the run read it gets no record', (t) => {
  const root = repo({ 'a.ts': 'x\n', 'b.ts': 'y\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = createDiskSession(options(root, ['a.ts', 'b.ts']));
  fs.writeFileSync(path.join(root, 'a.ts'), 'edited\n');
  assert.equal(session.unchanged(['a.ts']), false);
  assert.equal(session.unchanged(['b.ts']), true);
  session.replace('check/format', [rec('a.ts', 'x\n'), rec('b.ts', 'y\n')]);
  session.flush();
  const text = fs.readFileSync(path.join(root, '.starcistacks/cache/check/format/root.jsonl'), 'utf8');
  assert.ok(text.includes('"b.ts"') && !text.includes('"a.ts"'));
});

test('a union-merged fingerprint with two digests for one part never matches', () => {
  const merged = parseFingerprint(`${serializeFingerprint([{ name: 'hfs', sha256: 'a' }])}${serializeFingerprint([{ name: 'hfs', sha256: 'b' }])}`);
  assert.deepEqual(fingerprintDifferences(merged, [{ name: 'hfs', sha256: 'a' }]), ['hfs']);
  assert.deepEqual(fingerprintDifferences([{ name: 'a', sha256: '1' }], [{ name: 'a', sha256: '1' }, { name: 'b', sha256: '2' }]), ['b']);
});

test('the content index diff names modified, added and deleted paths; a rename is a deletion and an addition', () => {
  const hashes: Record<string, string> = { a: '1', b: 'new', c2: '3' };
  const index = { paths: ['a', 'b', 'c2'], hashOf: (f: string) => hashes[f] };
  assert.deepEqual(diffIndex(index, new Map([['a', '1'], ['b', 'old'], ['c', '3']])), { modified: ['b'], added: ['c2'], deleted: ['c'] });
});

test('CI trusts the cache at the merge-base, not the change own edits', (t) => {
  const root = repo({ 'a.ts': 'x\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = createDiskSession(options(root, ['a.ts']));
  seed.replace('check/format', [rec('a.ts', 'x\n')]);
  seed.flush();
  const base = commit(root, 'base');
  git(root, ['checkout', '-q', '-b', 'change']);
  git(root, ['update-ref', 'refs/remotes/origin/main', base]);
  fs.writeFileSync(path.join(root, '.starcistacks/cache/check/format/root.jsonl'), '{"findings":[],"hash":"forged","path":"a.ts","step":"prettier"}\n');
  commit(root, 'forged');
  const env = { CI: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' };
  const trust = resolveTrust({ root, env });
  assert.equal(trust.kind, 'base');
  assert.equal(trust.base, base);
  assert.equal(readCacheAt(root, base)?.get('check/format/root.jsonl')?.includes('forged'), false);
  const ci = createDiskSession(options(root, ['a.ts'], { env, trust }));
  assert.equal(ci.records('check/format').length, 1);
  assert.equal(ci.records('check/format')[0]?.hash, hashText('x\n'));
  assert.equal(ci.writes, false);
  assert.equal(resolveTrust({ root, env: { CI: 'true', GITHUB_EVENT_NAME: 'schedule' } }).kind, 'none');
  assert.equal(resolveTrust({ root, env: { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } }).kind, 'base');
  assert.equal(resolveTrust({ root, env: { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1' } }).kind, 'none');
});

test('a committed record that matches the tree and disagrees with the computed one is FORGED, a touched key with no record STALE', () => {
  const finding = { path: 'a.ts', line: 0, column: 0, rule: 'HFS_FORMAT', message: 'm' };
  const clean = rec('a.ts', 'x\n');
  const forged = verifyCommitted({ trusted: new Map(), computed: new Map([['check/format', [{ ...clean, findings: [finding] }]]]), committed: new Map([['check/format', [clean]]]) });
  assert.deepEqual(forged.map((v) => [v.code, v.level]), [[FORGED, 'error']]);
  const stale = verifyCommitted({ trusted: new Map([['check/format', [rec('a.ts', 'old\n')]]]), computed: new Map([['check/format', [clean, rec('b.ts', 'b\n')]]]), committed: new Map([['check/format', [rec('b.ts', 'b\n')]]]) });
  assert.deepEqual(stale.map((v) => [v.code, v.path]), [[STALE, 'a.ts']]);
  const untouched = verifyCommitted({ trusted: new Map([['check/format', [clean]]]), computed: new Map([['check/format', [clean]]]), committed: new Map([['check/format', [clean]]]) });
  assert.deepEqual(untouched, []);
  const missing = verifyCommitted({ trusted: new Map(), computed: new Map([['check/format', [clean]]]), committed: new Map() });
  assert.deepEqual(missing.map((v) => [v.code, v.level]), [[MISSING, 'warning']]);
});

test('progress writes whole lines off a terminal and rewrites running lines on one', () => {
  let t = Date.UTC(2026, 0, 1, 12, 0, 0);
  const plain: string[] = [];
  const sink = createProgress({ write: (s) => plain.push(String(s)), now: () => t, planned: 100 });
  const step = sink.step('lint', 'fe', 100);
  t += 11_000;
  step.tick(50, 40, 10);
  step.end();
  assert.ok(plain.every((line) => line.endsWith('\n') && !line.includes('\r')));
  assert.match(plain[1] ?? '', /^\[\d\d:\d\d:\d\d \+11s 50%\] lint fe 50\/100 \(50%\) reused 40 checked 10\n$/);
  const tty: string[] = [];
  const live = createProgress({ write: (s) => tty.push(String(s)), now: () => t, tty: true }).step('format', 'prettier', 10);
  live.tick(5, 0, 5);
  live.end();
  assert.ok(tty[1]?.startsWith('\r'));
  assert.ok(tty[2]?.startsWith('\r') && tty[2].endsWith('\n'));
  assert.equal(elapsedText(187_000), '3m07s');
  assert.equal(elapsedText(42_000), '42s');
});

test('the run log lives in the untracked tool cache, named by the app folder and the hash of its real path', () => {
  const dir = toolCacheDir('/some/where/my-app', { STARCI_CACHE_HOME: '/cache' });
  assert.match(dir.replaceAll('\\', '/'), /\/cache\/my-app-[0-9a-f]{12}\/app-check$/);
});

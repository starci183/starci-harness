// The managed hook executes the bundled policy against real commits and outgoing ranges.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, push, ref, repository, ZERO } from './helpers/pre-push-fixture.mjs';

const HOOK = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-push', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
const fixture = (t: TestContext) => repository(t, HOOK);

test('fast-forward main needs no annotated tag or release record, including a first push', t => {
  const repo = fixture(t);
  for (const base of [ZERO, repo.older]) {
    const result = push(repo, [ref('refs/heads/main', repo.head, base)]);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('the pushed main commit is judged even when it is not checkout HEAD', t => {
  const repo = fixture(t);
  const result = push(repo, [ref('refs/heads/main', repo.older)]);
  assert.equal(result.status, 0, result.stderr);
});

test('main deletion, rewind, divergent history and an unavailable remote tip refuse the push', t => {
  const repo = fixture(t);
  git(repo.root, 'checkout', '-q', '-b', 'other', repo.older);
  fs.writeFileSync(path.join(repo.root, 'a.txt'), 'divergent');
  git(repo.root, 'commit', '-qam', 'divergent');
  const divergent = git(repo.root, 'rev-parse', 'HEAD');
  for (const [local, remote] of [[ZERO, repo.head], [repo.older, repo.head], [divergent, repo.head], [repo.head, 'a'.repeat(40)]] as [string, string][]) {
    const result = push(repo, [ref('refs/heads/main', local, remote)]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /RIGHTS_PUSH_NOT_RELEASE/);
  }
});

test('a dirty secret range and an unreadable range fail closed without printing a value', t => {
  const repo = fixture(t);
  fs.writeFileSync(path.join(repo.root, '.env'), 'fixture only\n');
  git(repo.root, 'add', '.env');
  git(repo.root, 'commit', '-qm', 'forbidden file');
  const head = git(repo.root, 'rev-parse', 'HEAD');
  const result = push(repo, [ref('refs/heads/main', head, repo.head)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret scan found.*\.env/);
  assert.doesNotMatch(result.stderr, /fixture only/);
  const unavailable = push(repo, [ref('refs/heads/main', 'b'.repeat(40))]);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /secret scan.*could not run/);
});

test('annotated v tags can name any commit; lightweight tags and tag deletions refuse', t => {
  const repo = fixture(t);
  git(repo.root, 'tag', '-a', 'v0.3.4', repo.older, '-m', 'notes');
  const tag = git(repo.root, 'rev-parse', 'refs/tags/v0.3.4');
  assert.equal(push(repo, [ref('refs/tags/v0.3.4', tag)]).status, 0);
  git(repo.root, 'tag', 'v0.3.5');
  for (const [name, sha] of [['v0.3.5', repo.head], ['v0.3.4', ZERO]] as [string, string][]) {
    const result = push(repo, [ref(`refs/tags/${name}`, sha)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RIGHTS_PUSH_NOT_RELEASE/);
  }
});

test('a push the bundled gate allows is still refused when the dependency push gate refuses', t => {
  const repo = repository(t, HOOK, { depsExit: 1 });
  const result = push(repo, [ref('refs/heads/main', repo.head, repo.older)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEPS_PIN_UNPUBLISHED/);
});

test('backups retain their push and delete behavior; another allowed ref cannot hide a main refusal', t => {
  const repo = fixture(t);
  for (const sha of [repo.head, ZERO]) assert.equal(push(repo, [ref('refs/backup/lane', sha)]).status, 0);
  const result = push(repo, [ref('refs/backup/lane', repo.head), ref('refs/heads/main', ZERO, repo.head)]);
  assert.equal(result.status, 1);
});

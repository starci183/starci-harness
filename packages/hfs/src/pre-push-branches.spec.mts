// proves: BRANCH_MAIN_NOT_ON_DEV@lite
// proves: BRANCH_MAIN_NOT_ON_DEV@full
// proves: BRANCH_DEV_NOT_ON_MAIN@lite
// proves: BRANCH_DEV_NOT_ON_MAIN@full
// proves: BRANCH_MAIN_NOT_CHECKED_OUT@lite
// proves: BRANCH_MAIN_NOT_CHECKED_OUT@full
// The two long-lived branches of an app (contexts/project/branches.md PROJECT-BRANCH-1) held by the managed pre-push hook, run against disposable git repositories:
// main moves only to a commit on dev, dev always contains main, and a push of main is judged as main.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, push, ref, repository, ZERO } from './helpers/pre-push-fixture.mjs';

const HOOK = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-push', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
const fixture = (t: TestContext) => repository(t, HOOK);
const commit = (root: string, text: string): string => {
  fs.writeFileSync(path.join(root, 'a.txt'), text);
  git(root, 'commit', '-qam', text);
  return git(root, 'rev-parse', 'HEAD');
};

test('the happy path: main fast-forwards to a commit on dev, judged as main by the full gate; dev and a lane branch run under their own branch', t => {
  const repo = fixture(t);
  const released = push(repo, [ref('refs/heads/main', repo.head, repo.older)]);
  assert.equal(released.status, 0, released.stderr);
  assert.match(released.stdout, /app check judged branch: main/);
  const worked = push(repo, [ref('refs/heads/dev', repo.head, repo.older)]);
  assert.equal(worked.status, 0, worked.stderr);
  assert.match(worked.stdout, /judged branch: \(the checkout\)/);
  assert.equal(push(repo, [ref('refs/heads/ui/3', repo.head)]).status, 0);
});

test('a push of main from a dev checkout, and a release tag, are judged as main whatever branch is checked out', t => {
  const repo = fixture(t);
  git(repo.root, 'checkout', '-q', 'dev');
  const tip = commit(repo.root, 'work on dev');
  const promoted = push(repo, [ref('refs/heads/main', tip, repo.head)]);
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.match(promoted.stdout, /app check judged branch: main/);
  git(repo.root, 'tag', '-a', 'v1.0.0', tip, '-m', 'notes');
  const tagged = push(repo, [ref('refs/tags/v1.0.0', git(repo.root, 'rev-parse', 'refs/tags/v1.0.0'))]);
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.match(tagged.stdout, /app check judged branch: main/);
});

test('BRANCH_MAIN_NOT_ON_DEV: a main commit that dev, local or on origin, does not hold is refused; a missing dev is refused except for the first push of main', t => {
  const repo = fixture(t);
  const ahead = commit(repo.root, 'committed on main directly');
  const direct = push(repo, [ref('refs/heads/main', ahead, repo.head)]);
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /BRANCH_MAIN_NOT_ON_DEV: refs\/heads\/main is closed: the commit is not on dev/);
  git(repo.root, 'branch', '-f', 'dev');
  assert.equal(push(repo, [ref('refs/heads/main', ahead, repo.head)]).status, 0, 'local dev holds it, no origin dev is known yet');
  git(repo.root, 'update-ref', 'refs/remotes/origin/dev', repo.head);
  const stale = push(repo, [ref('refs/heads/main', ahead, repo.head)]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /BRANCH_MAIN_NOT_ON_DEV.*not on origin\/dev/);
  git(repo.root, 'update-ref', 'refs/remotes/origin/dev', ahead);
  assert.equal(push(repo, [ref('refs/heads/main', ahead, repo.head)]).status, 0);
  git(repo.root, 'branch', '-D', 'dev');
  git(repo.root, 'update-ref', '-d', 'refs/remotes/origin/dev');
  const none = push(repo, [ref('refs/heads/main', ahead, repo.head)]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /BRANCH_MAIN_NOT_ON_DEV.*there is no dev branch/);
  assert.equal(push(repo, [ref('refs/heads/main', ahead)]).status, 0, 'the first push of main has no dev yet');
});

test('main and dev pushed together: the dev being pushed is the dev main must be on', t => {
  const repo = fixture(t);
  const ahead = commit(repo.root, 'one commit for both');
  const both = push(repo, [ref('refs/heads/main', ahead, repo.head), ref('refs/heads/dev', ahead, repo.head)]);
  assert.equal(both.status, 1, 'local dev still lacks it');
  git(repo.root, 'branch', '-f', 'dev');
  assert.equal(push(repo, [ref('refs/heads/main', ahead, repo.head), ref('refs/heads/dev', ahead, repo.head)]).status, 0);
});

test('BRANCH_MAIN_NOT_CHECKED_OUT: the commit of a main push is the checked-out HEAD, the tree the check judges', t => {
  const repo = fixture(t);
  const result = push(repo, [ref('refs/heads/main', repo.older, repo.older)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BRANCH_MAIN_NOT_CHECKED_OUT: refs\/heads\/main is closed: it is not the checked-out commit/);
});

test('BRANCH_DEV_NOT_ON_MAIN: dev that lacks main, diverges from it or is deleted is refused; dev ahead of main passes', t => {
  const repo = fixture(t);
  const behind = push(repo, [ref('refs/heads/dev', repo.older, repo.head)]);
  assert.equal(behind.status, 1);
  assert.match(behind.stderr, /BRANCH_DEV_NOT_ON_MAIN: refs\/heads\/dev is closed: dev does not contain main/);
  git(repo.root, 'checkout', '-q', '-b', 'fork', repo.older);
  const diverged = commit(repo.root, 'diverged from main');
  assert.match(push(repo, [ref('refs/heads/dev', diverged, repo.head)]).stderr, /BRANCH_DEV_NOT_ON_MAIN/);
  const deleted = push(repo, [ref('refs/heads/dev', ZERO, repo.head)]);
  assert.equal(deleted.status, 1);
  assert.match(deleted.stderr, /a push never deletes dev/);
  git(repo.root, 'checkout', '-q', 'main');
  git(repo.root, 'checkout', '-q', '-b', 'ahead');
  const forward = commit(repo.root, 'dev ahead of main');
  assert.equal(push(repo, [ref('refs/heads/dev', forward, repo.head)]).status, 0);
  git(repo.root, 'update-ref', 'refs/remotes/origin/main', forward);
  const origin = push(repo, [ref('refs/heads/dev', repo.head, repo.head)]);
  assert.equal(origin.status, 1, 'dev must contain the main origin holds too');
  assert.match(origin.stderr, /does not contain origin\/main/);
});

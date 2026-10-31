// proves: DB_MIGRATION_DESTRUCTIVE@lite
// A contract migration must not ship in the same release as the code change it depends on (R259, cicd.md Database migrations): the deploy applies it
// right after the accept, while the release it replaced is still the rollback target. The check reads the be/src sources AS THEY WERE at the previous
// release tag; a contract migration that is new since that tag and destroys an object those sources still reference is a DB_MIGRATION_DESTRUCTIVE
// finding. The git history is injected: previous-release, ls-tree and show.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultGit } from '../runtime/scripts/hfs/rules/database-migrations.mjs';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';

const CONTRACT = 'db/migrations/20261103000000_orders_contract_drop-legacy.sql';
const EARLIER = 'db/migrations/20261101000000_orders.sql';
const SOURCE = 'be/src/features/orders/orders.sql.ts';
const DROP = 'alter table public.orders drop column legacy;\n';
const sql = (text: string) => `export const QUERY = ${JSON.stringify(text)};\n`;

/** What the previous release tag held: `files` (path to text). `tag` null: the repository has no earlier release tag. */
interface History { tag: string | null; files: Record<string, string> }

/** A git double over a history: previous-release answers the tag, ls-tree lists the files under the pathspec at the tag, show reads one. */
function gitOf(history: History) {
  return (args: string[]) => {
    const [verb, ...rest] = args;
    if (verb === 'previous-release') return history.tag === null ? { ok: false, stdout: '' } : { ok: true, stdout: history.tag };
    if (verb === 'ls-tree') {
      const pathspec = rest.at(-1) as string;
      return { ok: true, stdout: Object.keys(history.files).filter((file) => file.startsWith(`${pathspec}/`)).map((file) => `${file}\0`).join('') };
    }
    if (verb === 'show') {
      const file = /:\.\/(.+)$/u.exec(rest[0] as string)?.[1] as string;
      return Object.hasOwn(history.files, file) ? { ok: true, stdout: history.files[file] } : { ok: false, stdout: '' };
    }
    return { ok: false, stdout: '' }; // merge-base: no base branch in this double
  };
}

/** The DB_MIGRATION_DESTRUCTIVE findings of the working tree `head` (path to text) against the history. */
async function judge(t: TestContext, head: Record<string, string>, history: History) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-contract-release-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({ kind: 'app', edition: 'lite' }));
  for (const [file, text] of Object.entries(head)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), text);
  }
  const findings = await checkDatabase({ repoRoot, files: Object.keys(head), edition: 'lite', git: gitOf(history) });
  return findings.filter((finding) => finding.code === 'DB_MIGRATION_DESTRUCTIVE');
}

const HEAD = { [EARLIER]: 'create table public.orders (id bigint primary key, legacy text);\n', [CONTRACT]: DROP, [SOURCE]: sql('select public.orders.id from public.orders') };

test('a new contract migration whose target the previous release still used is a finding naming that release and that source', async (t) => {
  const findings = await judge(t, HEAD, { tag: 'v1.4.0', files: { [EARLIER]: 'create table public.orders (id bigint primary key, legacy text);\n', [SOURCE]: sql('select public.orders.legacy from public.orders') } });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.path, CONTRACT);
  assert.equal(findings[0]!.release, 'v1.4.0');
  assert.equal(findings[0]!.reference, SOURCE);
  assert.match(findings[0]!.message, /previous release v1\.4\.0 still references .* ship the code change in one release and this contract migration in the next/u);
});

test('the same contract migration one release later is clean: the previous release already stopped using the column', async (t) => {
  const findings = await judge(t, HEAD, { tag: 'v1.5.0', files: { [EARLIER]: '', [SOURCE]: sql('select public.orders.id from public.orders') } });
  assert.deepEqual(findings, []);
});

test('a contract migration that already existed at the previous release ran with it and is not judged again', async (t) => {
  const findings = await judge(t, HEAD, { tag: 'v1.4.0', files: { [CONTRACT]: DROP, [SOURCE]: sql('select public.orders.legacy from public.orders') } });
  assert.deepEqual(findings, []);
});

test('a same-named column of another table at the previous release is not a reference', async (t) => {
  const findings = await judge(t, HEAD, { tag: 'v1.4.0', files: { [SOURCE]: sql('select public.invoices.legacy from public.invoices') } });
  assert.deepEqual(findings, []);
});

test('no release tag yet, or a history git cannot read, has no previous release and no finding', async (t) => {
  assert.deepEqual(await judge(t, HEAD, { tag: null, files: { [SOURCE]: sql('select public.orders.legacy from public.orders') } }), []);
});

test('a repository without a contract migration is not read at all', async (t) => {
  let asked = false;
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-contract-release-none-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({ kind: 'app', edition: 'lite' }));
  fs.mkdirSync(path.join(repoRoot, 'db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, EARLIER), 'create table public.orders (id bigint primary key);\n');
  await checkDatabase({ repoRoot, files: [EARLIER], edition: 'lite', git: (args: string[]) => { if (args[0] === 'previous-release') asked = true; return { ok: false, stdout: '' }; } });
  assert.equal(asked, false);
});

test('previous-release (the real git reader) names the newest release tag before HEAD by version, skipping a tag on HEAD itself', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-previous-release-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  const commit = (message: string) => git('commit', '--allow-empty', '-m', message);
  assert.equal(git('init', '-q').status, 0);
  commit('one'); git('tag', 'v1.9.0');
  commit('two'); git('tag', 'v1.10.0');
  commit('three'); git('tag', 'other-tag');
  const previous = () => defaultGit(['previous-release', 'v*'], { cwd: repo });
  assert.deepEqual(previous(), { ok: true, stdout: 'v1.10.0' }, 'an untagged HEAD: the newest release tag (1.10 sorts after 1.9)');
  git('tag', 'v1.11.0');
  assert.deepEqual(previous(), { ok: true, stdout: 'v1.10.0' }, 'HEAD is the release v1.11.0 itself: the one before it');
});

test('previous-release finds nothing in a repository without a release tag', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-previous-release-none-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'one'], { cwd: repo });
  assert.equal(defaultGit(['previous-release', 'v*'], { cwd: repo }).ok, false);
});

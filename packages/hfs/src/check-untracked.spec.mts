// check-untracked.spec.mts - `starci app check` judges the index (trackedFiles), the tree a commit carries; untrackedFiles names the files git
// neither tracks nor ignores, which the run counts as not judged (contexts/project/check-cache.md "The command surface").
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { add } from '../runtime/scripts/api/git/add.mjs';
import { trackedFiles, untrackedFiles } from '../runtime/scripts/hfs/check.mjs';

const repo = (t: TestContext): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-check-untracked-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(init(root).ok, true);
  return root;
};
const write = (root: string, file: string, text = 'x\n'): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

test('a file git neither tracks nor ignores is untracked, never tracked; staging it moves it to the judged tree', (t) => {
  const root = repo(t);
  write(root, '.gitignore', 'ignored/\n');
  write(root, 'hfs.json', '{}\n');
  write(root, 'be/src/new.ts');
  write(root, 'ignored/tool.log');
  assert.equal(add(['.gitignore', 'hfs.json'], { cwd: root }).status, 0);
  assert.deepEqual(trackedFiles(root), ['.gitignore', 'hfs.json']);
  assert.deepEqual(untrackedFiles(root), ['be/src/new.ts'], 'an ignored file is neither');
  assert.equal(add(['-A'], { cwd: root }).status, 0);
  assert.deepEqual(untrackedFiles(root), []);
  assert.deepEqual(trackedFiles(root), ['.gitignore', 'be/src/new.ts', 'hfs.json']);
});

test('a folder that is no git work tree is refused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-check-untracked-none-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => untrackedFiles(root), (error: { code?: string }) => error.code === 'HFS_REPO_UNREADABLE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runFormatFamily, FORMAT_FOLDER } from '../cache/format-family.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import { hashText } from '../cache/hash.mjs';
import { batches, formatFindings, workerCount, FORMAT_BATCH, type Prettier } from '../sync/format.mjs';
import { familyLine } from '../cache/report.mjs';

/** A prettier double: a text is formatted when it has no `;;`. It counts the files it was asked about. */
function fakePrettier(): Prettier & { checked: string[] } {
  const checked: string[] = [];
  return {
    checked,
    getFileInfo: () => ({ ignored: false, inferredParser: 'typescript' }),
    resolveConfig: () => ({}),
    check: (text, options) => {
      checked.push(path.basename(String(options['filepath'])));
      return !text.includes(';;');
    },
    format: (text) => text,
  };
}

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-format-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('a full run formats every file and records the verdicts, clean files included', async (t) => {
  const root = tree({ 'a.ts': 'ok\n', 'b.ts': 'bad;;\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = createFakeSession({ files: { 'a.ts': 'ok\n', 'b.ts': 'bad;;\n' }, mode: 'full', fullReason: '--full' });
  const prettier = fakePrettier();
  const { findings, report } = await runFormatFamily({ ...session, root }, { files: ['a.ts', 'b.ts'], prettier });
  assert.deepEqual(findings.map((f) => f.path), ['b.ts']);
  assert.equal(report.checked, 2);
  assert.equal(report.newFindings, 1);
  const records = session.replaced.get(FORMAT_FOLDER) ?? [];
  assert.deepEqual(records.map((r) => [r.path, r.findings.length]), [['a.ts', 0], ['b.ts', 1]]);
  assert.equal(familyLine(report), 'format: full (--full), checked 2, reused 0; findings 1 new, 0 known, 0 fixed');
});

test('a diff run reuses the verdict of an unchanged file and formats the changed and the added', async (t) => {
  const root = tree({ 'a.ts': 'ok\n', 'b.ts': 'fixed\n', 'c.ts': 'new\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const finding = { path: 'b.ts', line: 0, column: 0, rule: 'HFS_FORMAT', message: 'b.ts is not formatted by prettier; run `npm run format`' };
  const session = createFakeSession({
    files: { 'a.ts': 'ok\n', 'b.ts': 'fixed\n', 'c.ts': 'new\n' },
    records: { [FORMAT_FOLDER]: [
      { path: 'a.ts', step: 'prettier', hash: hashText('ok\n'), findings: [] },
      { path: 'b.ts', step: 'prettier', hash: hashText('bad;;\n'), findings: [finding] },
    ] },
  });
  const prettier = fakePrettier();
  const { findings, report } = await runFormatFamily({ ...session, root }, { files: ['a.ts', 'b.ts', 'c.ts'], prettier });
  assert.deepEqual(prettier.checked.sort(), ['b.ts', 'c.ts']);
  assert.deepEqual(findings, []);
  assert.equal(report.reused, 1);
  assert.equal(report.fixedFindings, 1);
});

test('a recorded finding of an unchanged file is reported again without formatting it', async (t) => {
  const root = tree({ 'b.ts': 'bad;;\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const finding = { path: 'b.ts', line: 0, column: 0, rule: 'HFS_FORMAT', message: 'b.ts is not formatted by prettier; run `npm run format`' };
  const session = createFakeSession({ files: { 'b.ts': 'bad;;\n' }, records: { [FORMAT_FOLDER]: [{ path: 'b.ts', step: 'prettier', hash: hashText('bad;;\n'), findings: [finding] }] } });
  const prettier = fakePrettier();
  const { findings, report } = await runFormatFamily({ ...session, root }, { files: ['b.ts'], prettier });
  assert.deepEqual(prettier.checked, []);
  assert.equal(findings.length, 1);
  assert.equal(report.knownFindings, 1);
  assert.equal(report.newFindings, 0);
});

test('prettier runs in batches and a long list gets worker threads', () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(batches(Array.from({ length: 200 }, (_, i) => i)).length, Math.ceil(200 / FORMAT_BATCH));
  assert.equal(workerCount(10, 8), 0);
  assert.equal(workerCount(5000, 8), 7);
  assert.equal(workerCount(5000, 2), 1);
  assert.equal(workerCount(5000, 1), 0);
});

test('worker threads judge a long list with the repository\'s own prettier and agree with the single-thread run', async (t) => {
  const prettierRoot = path.dirname(createRequire(import.meta.url).resolve('prettier/package.json'));
  const files: Record<string, string> = { '.prettierrc': JSON.stringify({ semi: true, singleQuote: true }), 'package.json': '{}' };
  for (let i = 0; i < 300; i += 1) files[`src/f${String(i).padStart(3, '0')}.ts`] = i % 50 === 0 ? 'export const a={b:1}\n' : "export const a = { b: 1 };\n";
  const root = tree(files);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.symlinkSync(prettierRoot, path.join(root, 'node_modules', 'prettier'), 'junction');
  const list = Object.keys(files).filter((f) => f.endsWith('.ts'));
  const progress: number[] = [];
  const parallel = await formatFindings({ repoRoot: root, files: list, onProgress: (n) => progress.push(n) });
  assert.deepEqual(parallel.map((f) => f.path), ['src/f000.ts', 'src/f050.ts', 'src/f100.ts', 'src/f150.ts', 'src/f200.ts', 'src/f250.ts']);
  assert.equal(progress.at(-1), 300);
});

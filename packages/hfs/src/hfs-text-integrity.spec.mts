// proves: HFS_TEXT_CORRUPT@lite HFS_TEXT_CORRUPT@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { textIntegrityFindings } from '../runtime/scripts/hfs/rules/text-integrity.mjs';

const GOOD = 'Kh\u00F3a thao t\u00E1c \u0111\u00E3 \u0111\u01B0\u1EE3c d\u00F9ng cho n\u1ED9i dung kh\u00E1c.';
const bundle = (vi: string) => `export const M = {\n    vi: {\n        "errors.A": ${JSON.stringify(vi)},\n    },\n    en: {\n        "errors.A": "Is this right? Yes.",\n    },\n}\n`;

type Files = Record<string, string | Buffer>;

function tree(t: TestContext, files: Files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  return root;
}

const run = (root: string, files: Files, edition: string) => textIntegrityFindings({ repoRoot: root, files: Object.keys(files), repo: { profile: 'be', edition } });
const CATALOG = 'src/modules/platform/idempotency/messages/idempotency.messages.ts';

for (const edition of ['lite', 'full']) {
  test(`HFS_TEXT_CORRUPT ${edition}: a vi string whose diacritics became question marks is refused`, (t) => {
    const files = { [CATALOG]: bundle('Kh?a thao t?c ?? ???c d?ng cho n?i dung kh?c.'), 'src/b.messages.ts': bundle('Kh\u00F3a, ph?m vi kh\u00F4ng h?p l?.') };
    const findings = run(tree(t, files), files, edition);
    assert.deepEqual(findings.map((item) => [item.code, item.path, item.line, item.level]), [
      ['HFS_TEXT_CORRUPT', CATALOG, 3, 'error'],
      ['HFS_TEXT_CORRUPT', 'src/b.messages.ts', 3, 'error'],
    ]);
  });

  test(`HFS_TEXT_CORRUPT ${edition}: a tail-only loss and a leading question mark are refused`, (t) => {
    const files = { [CATALOG]: bundle('Kh\u00F4ng h\u1EE3p l?.'), 'src/b.messages.ts': bundle('?ng d\u1EE5ng') };
    assert.equal(run(tree(t, files), files, edition).length, 2);
  });

  test(`HFS_TEXT_CORRUPT ${edition}: intact Vietnamese, a final question mark and English question marks pass`, (t) => {
    const files = { [CATALOG]: bundle(GOOD), 'src/b.messages.ts': bundle('B\u1EA1n ch\u1EAFc ch\u1EE9?'), 'src/c.messages.ts': bundle('\u00D4 ? ') };
    assert.deepEqual(run(tree(t, files), files, edition), []);
  });

  test(`HFS_TEXT_CORRUPT ${edition}: a file that is not valid UTF-8 is refused once`, (t) => {
    const files = { [CATALOG]: Buffer.concat([Buffer.from('export const M = {\n    vi: {\n        "errors.A": "Kh'), Buffer.from([0xf3]), Buffer.from('a",\n    },\n}\n')]) };
    const findings = run(tree(t, files), files, edition);
    assert.equal(findings.length, 1);
    assert.match(findings[0]?.message ?? '', /not valid UTF-8/);
    assert.equal(findings[0]?.line, 3);
  });

  test(`HFS_TEXT_CORRUPT ${edition}: a vi.json locale file is judged by its string values`, (t) => {
    const files = { 'src/modules/i18n/messages/vi.json': JSON.stringify({ home: { title: 'Trang ch?nh', ok: GOOD } }), 'src/modules/i18n/messages/en.json': JSON.stringify({ home: { title: 'Home?' } }) };
    const findings = run(tree(t, files), files, edition);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.path, 'src/modules/i18n/messages/vi.json');
  });

  test(`HFS_TEXT_CORRUPT ${edition}: unreadable, unrelated and non-catalog files are skipped`, (t) => {
    const files = { 'src/a.ts': bundle('Kh?a thao t?c'), 'node_modules/x/a.messages.ts': bundle('Kh?a thao t?c'), 'src/bad.vi.json': '{' };
    assert.deepEqual(run(tree(t, files), { ...files, 'src/missing.messages.ts': '' }, edition), []);
    assert.deepEqual(textIntegrityFindings({ repoRoot: tree(t, files), files: ['src/missing.messages.ts', 'src/modules/vi.json'], repo: { edition } }), []);
  });
}

test('HFS_TEXT_CORRUPT: the runtime repository, an unknown edition and files out of scope are not judged', (t) => {
  const files = { [CATALOG]: bundle('Kh?a thao t?c') };
  const root = tree(t, files);
  assert.deepEqual(textIntegrityFindings({ repoRoot: root, files: Object.keys(files), repo: { kind: 'runtime' } }), []);
  assert.deepEqual(textIntegrityFindings({ repoRoot: root, files: Object.keys(files), repo: { edition: 'other' } }), []);
  assert.deepEqual(textIntegrityFindings({ repoRoot: root, files: Object.keys(files), repo: { edition: 'full' }, inScope: () => false }), []);
  assert.equal(textIntegrityFindings({ repoRoot: root, files: Object.keys(files), repo: {} }).length, 1);
});

test('HFS_TEXT_CORRUPT: a catalog without a vi map has nothing to judge', (t) => {
  const files = { [CATALOG]: 'export const M = { en: { "errors.A": "a?b" } }\n' };
  assert.deepEqual(run(tree(t, files), files, 'full'), []);
});

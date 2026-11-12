// format-files.spec.mts - a generator's output is written as the app's own prettier prints it (formatFiles, sync/format.mts), so it passes the
// HFS_FORMAT check (R19) it ships with whatever the lengths of the names it filled in; an ignored, unknown or unparsable file is left as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatFiles, type Prettier } from '../sync/format.mjs';

/** A prettier double: it knows `.ts`, ignores `ignored/`, refuses a file holding `!!` and prints by collapsing runs of spaces. */
const prettier: Prettier = {
  getFileInfo: (file) => ({ ignored: file.includes(`${path.sep}ignored${path.sep}`), inferredParser: file.endsWith('.ts') ? 'typescript' : null }),
  resolveConfig: () => ({}),
  check: () => true,
  format: (text) => { if (text.includes('!!')) throw new SyntaxError('unexpected token'); return text.replace(/ {2,}/gu, ' '); },
};

test('formatFiles rewrites what prettier prints differently, answers those files and leaves the rest', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-format-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = { 'a.ts': 'const a  =  1\n', 'b.ts': 'const b = 2\n', 'ignored/c.ts': 'const c  = 3\n', 'd.md': 'x  y\n', 'e.ts': 'const e  = !!x\n', 'package-lock.json': '{  }\n' };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  assert.deepEqual(await formatFiles({ repoRoot: root, files: [...Object.keys(files), 'missing.ts'], prettier }), ['a.ts']);
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'const a = 1\n');
  for (const file of ['b.ts', 'ignored/c.ts', 'd.md', 'e.ts', 'package-lock.json']) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), files[file], file);
});

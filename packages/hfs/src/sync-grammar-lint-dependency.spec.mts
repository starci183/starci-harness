// `starci app sync` keeps the root package.json on the selected Grammar family's lint package: fe/eslint.config.mjs is rendered from hfs.json
// `sides.fe.grammar`, so an app that switches its family (core to offset-pop) gets the dependency the rendered config imports, renamed in place
// at the same version (the family lint packages release in step), and nothing else of package.json changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upgradeEdits } from '../sync/index.mjs';
import { grammarLintDependencyEdits } from '../sync/grammar-lint-dependency.mjs';
import { grammarLintPackages } from '../runtime/scripts/lib/grammar-lint.mjs';

const made: string[] = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const hfs = (grammar: string | undefined): string => JSON.stringify({ hfs: 3, kind: 'app', project: 'demo', sides: { fe: { ...(grammar === undefined ? {} : { grammar }), apps: [{ name: 'web', kind: 'next' }] } } });
const manifest = (lint: Record<string, string>): string => `${JSON.stringify({
  name: 'demo', private: true,
  devDependencies: { '@starci/eslint-canon-fe': '9.30.0', ...lint, eslint: '10.0.0', typescript: '5.9.3' },
}, null, 4)}\n`;
const reader = (files: Record<string, string>) => (file: string): string | null => files[file] ?? null;

test('the catalog names one lint package per family that has rules', () => {
  assert.deepEqual(grammarLintPackages(), ['@starci/eslint-grammar-core', '@starci/eslint-grammar-offset-pop']);
});

test('a family switch renames the stale lint dependency to the selected one, in place, at its version', () => {
  const edits = grammarLintDependencyEdits(reader({ 'hfs.json': hfs('offset-pop'), 'package.json': manifest({ '@starci/eslint-grammar-core': '0.59.0' }) }));
  assert.equal(edits.length, 1);
  assert.match(edits[0]!.reason, /devDependencies @starci\/eslint-grammar-core becomes @starci\/eslint-grammar-offset-pop/u);
  assert.equal(edits[0]!.content, manifest({ '@starci/eslint-grammar-offset-pop': '0.59.0' }), 'same key position, same version, same indentation');
  const back = grammarLintDependencyEdits(reader({ 'hfs.json': hfs('core'), 'package.json': edits[0]!.content }));
  assert.equal(back[0]!.content, manifest({ '@starci/eslint-grammar-core': '0.59.0' }), 'and back');
});

test('nothing changes when the selected package is declared, the family is unnamed or unknown, or the manifest is unreadable', () => {
  const none = (files: Record<string, string>): void => assert.deepEqual(grammarLintDependencyEdits(reader(files)), []);
  none({ 'hfs.json': hfs('offset-pop'), 'package.json': manifest({ '@starci/eslint-grammar-offset-pop': '0.59.0' }) });
  none({ 'hfs.json': hfs('offset-pop'), 'package.json': manifest({ '@starci/eslint-grammar-core': '0.59.0', '@starci/eslint-grammar-offset-pop': '0.59.0' }) });
  none({ 'hfs.json': hfs(undefined), 'package.json': manifest({ '@starci/eslint-grammar-core': '0.59.0' }) });
  none({ 'hfs.json': hfs('unlisted'), 'package.json': manifest({ '@starci/eslint-grammar-core': '0.59.0' }) });
  none({ 'hfs.json': hfs('offset-pop'), 'package.json': manifest({}) });
  none({ 'hfs.json': hfs('offset-pop'), 'package.json': 'not json' });
  none({ 'package.json': manifest({ '@starci/eslint-grammar-core': '0.59.0' }) });
});

test('app sync proposes the swap as an upgrade edit of package.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-grammar-lint-dep-'));
  made.push(root);
  fs.writeFileSync(path.join(root, 'hfs.json'), hfs('offset-pop'));
  fs.writeFileSync(path.join(root, 'package.json'), manifest({ '@starci/eslint-grammar-core': '0.59.0' }));
  const edit = upgradeEdits(root).edits.find((candidate) => candidate.path === 'package.json');
  assert.ok(edit, 'package.json is edited');
  assert.equal(edit.content, manifest({ '@starci/eslint-grammar-offset-pop': '0.59.0' }));
});

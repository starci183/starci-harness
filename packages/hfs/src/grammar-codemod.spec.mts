import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codemodMain } from '../codemod/main.mjs';
import { rangeArguments, runGrammarCodemods } from '../codemod/grammar.mjs';

/** A stand-in @starci/grammar/codemods: two codemods that report the file they would change and write a marker on --execute. */
const STUB = `
const make = (id, version) => ({
  id, version, summary: 'stub ' + id,
  run: ({ root, write, ts }) => {
    if (!ts || typeof ts.createSourceFile !== 'function') throw new Error('no compiler handed in');
    const file = root + '/apps/web/src/A.tsx';
    if (write) require('node:fs').appendFileSync(file, '// ' + id + '\\n');
    return { codemod: id, version, mode: write ? 'execute' : 'dry', findings: id === 'v0560' ? [{ reason: 'left' }] : [] };
  },
  markdown: (report) => '# ' + report.codemod + ' ' + report.mode + '\\n',
});
`;

/** An app checkout with apps/web/src/A.tsx and an installed @starci/grammar at `version`, with codemods unless `bare`. */
function app(context: TestContext, version: string, bare = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grammar-codemod-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'src', 'A.tsx'), 'export const A = 1\n');
  const grammar = path.join(root, 'node_modules', '@starci', 'grammar');
  fs.mkdirSync(path.join(grammar, 'dist', 'codemods'), { recursive: true });
  fs.writeFileSync(path.join(grammar, 'package.json'), JSON.stringify({ name: '@starci/grammar', version, type: 'module', exports: bare ? { './package.json': './package.json' } : { './codemods': { import: './dist/codemods/index.mjs' }, './package.json': './package.json' } }));
  fs.writeFileSync(path.join(grammar, 'dist', 'codemods', 'index.mjs'), `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n${STUB}\nexport const CODEMODS = [make('v0540', '0.54.0'), make('v0560', '0.56.0')];\nconst n = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);\nexport const codemodsBetween = (from, to) => CODEMODS.filter((c) => n(c.version) > n(from) && n(c.version) <= n(to));\n`);
  return root;
}

const io = (cwd: string) => { let out = ''; return { cwd, stdout: (text: string) => { out += text; }, text: () => out }; };
const ts = { createSourceFile: () => null };

test('starci app codemod --list prints each Grammar codemod of the installed Grammar with its version and summary', async (context) => {
  const root = app(context, '0.56.0');
  const run = io(root);
  assert.equal(await codemodMain(['--list'], run), 0);
  assert.match(run.text(), /\| v0540 \| 0\.54\.0 \| stub v0540 \|/);
  assert.match(run.text(), /\| v0560 \| 0\.56\.0 \| stub v0560 \|/);
});

test('starci app codemod v0540 is dry until --execute: it writes nothing, then writes', async (context) => {
  const root = app(context, '0.56.0');
  const file = path.join(root, 'apps/web/src/A.tsx');
  const dry = await runGrammarCodemods({ root, id: 'v0540', write: false, ts });
  assert.deepEqual(dry.reports.map(({ report }) => [report.codemod, report.mode]), [['v0540', 'dry']]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'export const A = 1\n');
  const run = io(root);
  assert.equal(await codemodMain(['v0540', '--execute'], run), 0);
  assert.match(run.text(), /# v0540 execute/);
});

test('--from <installed> --to <target> runs every codemod in between, in version order; a range with none says so', async (context) => {
  const root = app(context, '0.56.0');
  const all = await runGrammarCodemods({ root, from: '0.52.3', to: '0.56.0', write: false, ts });
  assert.deepEqual(all.reports.map(({ codemod }) => codemod.id), ['v0540', 'v0560']);
  const tail = await runGrammarCodemods({ root, from: '0.54.0', write: false, ts });
  assert.deepEqual(tail.reports.map(({ codemod }) => codemod.id), ['v0560'], '--to defaults to the installed Grammar');
  const run = io(root);
  assert.equal(await codemodMain(['--from', '0.52.3', '--to', '0.56.0'], run), 1, 'a case left for a person exits 1');
  assert.ok(run.text().indexOf('# v0540') < run.text().indexOf('# v0560'));
  const none = io(root);
  assert.equal(await codemodMain(['--from=0.54.0', '--to=0.55.0'], none), 0);
  assert.match(none.text(), /no Grammar codemod between 0\.54\.0 and 0\.55\.0/);
});

test('a codemod the installed Grammar lacks, a target above it and a Grammar with no codemods are refused with what to do', async (context) => {
  const root = app(context, '0.54.0');
  await assert.rejects(runGrammarCodemods({ root, id: 'v0999', write: false, ts }), /has no codemod v0999.*--list/);
  await assert.rejects(runGrammarCodemods({ root, from: '0.52.3', to: '0.56.0', write: false, ts }), /above the installed @starci\/grammar 0\.54\.0: install 0\.56\.0 first/);
  const old = app(context, '0.52.3', true);
  await assert.rejects(runGrammarCodemods({ root: old, id: 'v0540', write: false, ts }), /ships no codemods/);
  assert.throws(() => rangeArguments(['--from', 'latest']), /x\.y\.z/);
});

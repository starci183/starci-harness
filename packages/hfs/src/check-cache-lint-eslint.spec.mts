// The lint family against the real ESLint with a type-aware rule: the answer from the records plus a lint of the dirty set is the answer of a
// full lint, after each kind of edit. The rule reads a type that lives in another file, which is exactly what ESLint's own cache cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import { createFakeSession } from '../cache/fake-session.mjs';
import { lintSide, type EslintResult, type LintSideOutcome } from '../cache/lint-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';

/**
 * The ESLint child: a fresh process per lint, as the real launcher runs it (typescript-eslint's project service keeps the files it has read, so
 * an in-process second lint after an edit would see stale types, which no real run does). The rule reports a variable whose initialiser has the
 * string-literal type "BAD": the type comes from wherever the initialiser was declared, a type ESLint's own cache cannot see change.
 */
const CHILD = `
import { ESLint } from ${JSON.stringify(import.meta.resolve('eslint'))};
import tsParser from ${JSON.stringify(import.meta.resolve('@typescript-eslint/parser'))};
const [root, ...files] = process.argv.slice(2);
const rule = {
  meta: { type: 'problem', schema: [], messages: { bad: 'the type of {{name}} is "BAD"' } },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services.program.getTypeChecker();
    return {
      VariableDeclarator(node) {
        if (!node.init || node.id.type !== 'Identifier') return;
        if (checker.typeToString(checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.init))) === '"BAD"') context.report({ node, messageId: 'bad', data: { name: node.id.name } });
      },
    };
  },
};
const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
  files: ['**/*.ts'],
  languageOptions: { parser: tsParser, parserOptions: { projectService: true, tsconfigRootDir: root } },
  plugins: { fixture: { rules: { 'no-bad-type': rule } } },
  rules: { 'fixture/no-bad-type': 'error' },
}] });
const results = await eslint.lintFiles(files);
process.stdout.write(JSON.stringify(results.map((result) => ({ filePath: result.filePath, messages: result.messages.map((m) => ({ ruleId: m.ruleId, message: m.message, line: m.line, column: m.column, severity: m.severity })) }))));
`;

function fixture(context: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-eslint-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true, noEmit: true }, include: ['src'] }));
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('src/c.ts', 'export const c = 1 as const;\n');
  write('src/b.ts', "import { c } from './c';\nexport const b = c;\n");
  write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
  write('src/t.ts', 'export type T = number;\n');
  write('src/x.ts', "import type { T } from './t';\nexport const x: T = 1;\n");
  write('src/d.ts', 'export const d = 2;\n');
  return root;
}

async function run(root: string, records: readonly CacheRecord[], calls: (string[] | null)[], options: { full?: string } = {}): Promise<{ outcome: LintSideOutcome; written: readonly CacheRecord[] | undefined }> {
  const files: Record<string, string> = {};
  const visit = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) visit(rel); else files[`be/${rel}`] = fs.readFileSync(path.join(root, rel), 'utf8');
    }
  };
  visit('');
  const scope = Object.keys(files).map((file) => file.slice(3)).filter((file) => file.endsWith('.ts')).sort();
  const session = createFakeSession({ files, records: { 'lint/be': records } });
  const outcome = await lintSide({
    session, side: 'be', sideRoot: root, scope, stylesheets: [], report: null, extraKey: '', full: options.full ?? null, write: true, typescript: () => ts,
    canons: [{ name: 'fixture', crossFileInputs: [], graphRules: false, projectGraph: null }], styleCanon: null,
    eslint: async (list) => {
      calls.push(list === null ? null : [...list]);
      const script = path.join(root, 'lint-child.mjs');
      fs.writeFileSync(script, CHILD);
      const out = execFileSync(process.execPath, [script, root, ...(list === null ? scope : list)], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
      fs.rmSync(script);
      return { errors: [], results: JSON.parse(out.toString('utf8')) as EslintResult[] };
    },
    stylelint: null,
  });
  return { outcome, written: session.replaced.get('lint/be') };
}

const shape = (results: readonly EslintResult[]): string[] => results.map((result) => `${path.basename(result.filePath)}|${result.messages.map((message) => `${message.ruleId}:${message.line}:${message.column}:${message.message}`).join('~')}`).sort();

test('with the real ESLint and a type-aware rule, records plus the dirty set equal a full lint after each kind of edit', async (context) => {
  const root = fixture(context);
  const write = (file: string, text: string): void => fs.writeFileSync(path.join(root, file), text);
  const calls: (string[] | null)[] = [];
  let state = await run(root, [], calls);
  assert.equal(state.outcome.errors.length, 0);
  assert.deepEqual(shape(state.outcome.eslint).filter((line) => line.includes('fixture/')), []);

  // a type three files away changes: its importers are judged again, though their text is the same
  calls.length = 0;
  write('src/c.ts', 'export const c = "BAD" as const;\n');
  state = await run(root, state.written as CacheRecord[], calls);
  assert.deepEqual(calls, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
  const afterC = shape(state.outcome.eslint);
  assert.ok(afterC.some((line) => line.startsWith('a.ts|fixture/no-bad-type')), `a.ts reports the type it reads through b.ts: ${JSON.stringify(afterC)}`);
  assert.deepEqual(afterC, shape((await run(root, [], [], { full: 'compare' })).outcome.eslint));

  // a type-only import carries the change as well
  calls.length = 0;
  write('src/t.ts', 'export type T = "BAD";\n');
  state = await run(root, state.written as CacheRecord[], calls);
  assert.deepEqual(calls, [['src/t.ts', 'src/x.ts']]);
  assert.deepEqual(shape(state.outcome.eslint), shape((await run(root, [], [], { full: 'compare' })).outcome.eslint));

  // the type is fixed again: the importers lose the finding they never had a line of their own for
  calls.length = 0;
  write('src/c.ts', 'export const c = 2 as const;\n');
  state = await run(root, state.written as CacheRecord[], calls);
  assert.deepEqual(calls, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
  assert.equal(shape(state.outcome.eslint).filter((line) => line.includes('fixture/')).length, 0);
  assert.deepEqual(shape(state.outcome.eslint), shape((await run(root, [], [], { full: 'compare' })).outcome.eslint));

  // nothing changed: nothing is judged
  calls.length = 0;
  state = await run(root, state.written ?? [], calls);
  assert.deepEqual(calls, []);
});

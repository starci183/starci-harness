// `starci app lint` through the result cache: the flags that read and write it, and that the second run over one tree judges nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { TestContext } from 'node:test';
import { createFakeSession } from '../cache/fake-session.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import { lintRepository, parseLintArgs, type LinterRunner } from '../lint/run.mjs';

interface Fixture { root: string; files: Record<string, string[]> }
interface Call { side: string; files: string[] }

function installedPackage(root: string, name: string, source: string): void {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), source);
}

function fixture(context: TestContext, canon: { crossFileInputs: boolean } = { crossFileInputs: true }): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-cache-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: {
    be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] },
  } }));
  // the app's own TypeScript, as the cache resolves it from the side folder
  const typescript = path.join(root, 'node_modules', 'typescript');
  fs.mkdirSync(typescript, { recursive: true });
  fs.writeFileSync(path.join(typescript, 'package.json'), '{"name":"typescript","main":"index.js"}');
  fs.writeFileSync(path.join(typescript, 'index.js'), `module.exports = require(${JSON.stringify(createRequire(import.meta.url).resolve('typescript'))});\n`);
  const files: Record<string, string[]> = { be: ['src/backend.ts'], fe: ['src/universal.ts', 'src/family.tsx'] };
  for (const side of ['be', 'fe']) {
    const cwd = path.join(root, side);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve' } }));
    for (const file of files[side] as string[]) fs.writeFileSync(path.join(cwd, file), 'export const value = 1;\n');
    const factory = side === 'be' ? 'starciBeConfig' : 'starciFeConfig';
    installedPackage(root, `@starci/eslint-canon-${side}`, [
      "import fs from 'node:fs';", "import path from 'node:path';", "import { fileURLToPath } from 'node:url';",
      `export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.${side};`,
      `export const ${factory} = () => [{ files: ['src/**/*.ts', 'src/**/*.tsx'] }];`,
      ...(canon.crossFileInputs ? ['export const crossFileInputs = [];'] : []),
      ...(side === 'be' ? ['export const projectGraph = () => ({ byFile: {} });'] : []),
    ].join('\n'));
    fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), [
      `import { loadHfs, ${factory} } from '@starci/eslint-canon-${side}';`, 'const hfs = loadHfs(import.meta.url);', `export default [...${factory}({ hfs })];`,
    ].join('\n'));
  }
  installedPackage(root, '@starci/eslint-grammar-core', "export const coreGrammarConfig = () => [{ files: ['src/**/*.tsx'] }];\nexport const crossFileInputs = [];\n");
  return { root, files };
}

/** The tree as a fake session sees it: every file below the app, app-relative. */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) visit(rel);
      else out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
    }
  };
  visit('');
  return out;
}

const cleanCheck = () => ({ findings: [] as Record<string, unknown>[], tracked: 3 });

/** A linter that answers one finding per file named `bad.ts`, and records what it was asked. */
function linter(calls: Call[]): LinterRunner {
  return async ({ cwd, pkg, args }) => {
    assert.equal(pkg, 'eslint');
    const side = path.basename(cwd);
    const requested = args.slice(2);
    const files = requested[0] === '.' ? fs.readdirSync(path.join(cwd, 'src')).map((name) => `src/${name}`) : requested;
    calls.push({ side, files });
    return { results: files.map((file) => ({ filePath: path.join(cwd, file), messages: fs.readFileSync(path.join(cwd, file), 'utf8').includes('BAD') ? [{ ruleId: 'fake/no-bad', message: `BAD in ${file}`, line: 1, column: 1 }] : [] })) };
  };
}

async function lint(app: Fixture, argv: string[], records: Record<string, readonly CacheRecord[]>, calls: Call[], mode: 'diff' | 'full' = 'diff') {
  const session = createFakeSession({ files: treeOf(app.root), records, mode });
  const out = await lintRepository({ repoRoot: app.root, opts: parseLintArgs(argv), hfsCheck: cleanCheck, runLinter: linter(calls), cache: { session } });
  return { ...out, session };
}

const recordsOf = (session: { replaced: ReadonlyMap<string, readonly CacheRecord[]> }): Record<string, readonly CacheRecord[]> => Object.fromEntries(session.replaced);

test('--full parses; the lint usage keeps its other flags', () => {
  assert.equal(parseLintArgs(['--full']).full, true);
  assert.equal(parseLintArgs(['--json']).full, undefined);
});

test('the first lint judges both sides and writes their records; the second judges nothing and reports the same findings', async (context) => {
  const app = fixture(context);
  fs.writeFileSync(path.join(app.root, 'fe/src/universal.ts'), 'export const value = "BAD";\n');
  const calls: Call[] = [];
  const first = await lint(app, [], {}, calls);
  assert.deepEqual(calls.map((call) => call.side), ['be', 'fe']);
  assert.deepEqual([...first.session.replaced.keys()].sort(), ['lint/be', 'lint/fe']);
  assert.equal(first.report.counts.error, 1);
  assert.equal(first.session.reports.length, 1);
  assert.equal(first.session.reports[0]?.family, 'lint');
  assert.equal(first.session.reports[0]?.checked, 3);
  calls.length = 0;
  const second = await lint(app, [], recordsOf(first.session), calls);
  assert.deepEqual(calls, []);
  assert.deepEqual(second.report.findings, first.report.findings);
  assert.equal(second.session.reports[0]?.reused, 3);
  assert.equal(second.session.replaced.size, 0, 'nothing to rewrite when nothing changed');
  assert.equal(second.exit, first.exit);
});

test('a changed file is the only one sent to the linter, through the same launcher as a full run', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const first = await lint(app, [], {}, calls);
  calls.length = 0;
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = "BAD";\n');
  const second = await lint(app, [], recordsOf(first.session), calls);
  assert.deepEqual(calls, [{ side: 'be', files: ['src/backend.ts'] }]);
  assert.equal(second.report.counts.error, 1);
  assert.deepEqual(second.report.findings.map((finding: { path: string }) => finding.path), ['be/src/backend.ts']);
});

test('--side judges and writes only its side; --changed and --fix neither read nor write', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const side = await lint(app, ['--side', 'fe'], {}, calls);
  assert.deepEqual(calls.map((call) => call.side), ['fe']);
  assert.deepEqual([...side.session.replaced.keys()], ['lint/fe']);
  calls.length = 0;
  const changed = await lint(app, ['--changed', 'fe/src/family.tsx'], recordsOf(side.session), calls);
  assert.deepEqual(calls, [{ side: 'fe', files: ['src/family.tsx'] }]);
  assert.equal(changed.session.replaced.size, 0);
  assert.equal(changed.session.reports.length, 0);
  calls.length = 0;
  const fixing = await lint(app, ['--fix', '--side', 'be'], {}, calls);
  assert.equal(fixing.session.replaced.size, 0);
  assert.equal(fixing.session.reports.length, 0);
});

test('--full ignores the records and rewrites them', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const first = await lint(app, [], {}, calls);
  calls.length = 0;
  const second = await lint(app, ['--full'], recordsOf(first.session), calls);
  assert.deepEqual(calls.map((call) => call.side), ['be', 'fe']);
  assert.deepEqual([...second.session.replaced.keys()].sort(), ['lint/be', 'lint/fe']);
  assert.equal(second.session.reports[0]?.mode, 'full');
});

test('a full decision of the session (fingerprint, no cache) judges everything and writes', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const first = await lint(app, [], {}, calls);
  calls.length = 0;
  const second = await lint(app, [], recordsOf(first.session), calls, 'full');
  assert.deepEqual(calls.map((call) => call.side), ['be', 'fe']);
  assert.equal(second.session.reports[0]?.mode, 'full');
});

test('an installed canon without crossFileInputs makes a change a whole-side lint', async (context) => {
  const app = fixture(context, { crossFileInputs: false });
  const calls: Call[] = [];
  const first = await lint(app, ['--side', 'be'], {}, calls);
  calls.length = 0;
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = 2;\n');
  const second = await lint(app, ['--side', 'be'], recordsOf(first.session), calls);
  assert.deepEqual(calls, [{ side: 'be', files: ['src/backend.ts'] }]);
  assert.equal(second.session.reports[0]?.mode, 'full');
  assert.match(second.session.reports[0]?.reason ?? '', /declares no crossFileInputs/);
});

test('a tool error stores nothing', async (context) => {
  const app = fixture(context);
  const session = createFakeSession({ files: treeOf(app.root) });
  const out = await lintRepository({ repoRoot: app.root, opts: parseLintArgs([]), hfsCheck: cleanCheck, runLinter: async () => ({ error: 'eslint did not start' }), cache: { session } });
  assert.equal(out.exit, 2);
  assert.equal(session.replaced.size, 0);
});

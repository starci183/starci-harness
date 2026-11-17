// The types step builds the workspace packages that programs resolve through a build output before it runs `tsc` (contexts/project/check-cache.md, "Which step reuses what"):
// a fresh tree holds no dist, so a program that imports one would report every import. The key of such a program changes with the package's tracked sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTypesForApp } from '../cache/app-families.mjs';
import { buildPackages, builtPackagesOf, programsWithBuiltReads, TYPES_PACKAGE_BUILD_FAILED } from '../cache/built-packages.mjs';
import { generatedInputs, TYPES_CODEGEN_FAILED } from '../cache/codegen.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';
import { programKey, type TypesProgram } from '../cache/types-family.mjs';

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;
const built = (name: string, extra: Record<string, unknown> = {}): string => json({ name, version: '0.0.0', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, scripts: { build: 'tsc' }, ...extra });

/** An app on disk: a root with workspaces, `ui` and `i18n` built into dist, `tracked` exporting tracked source, `web` importing ui, `be` importing nothing built. */
function app(): { root: string; files: Record<string, string>; tracked: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-packages-'));
  const files: Record<string, string> = {
    'package.json': json({ name: 'app', workspaces: ['fe/apps/*', 'fe/packages/*'] }),
    'package-lock.json': '{}\n',
    'fe/packages/ui/package.json': built('@app/ui', { dependencies: { '@app/i18n': '0.0.0' } }),
    'fe/packages/ui/src/index.ts': 'export const ui = 1;\n',
    'fe/packages/ui/tsconfig.json': '{}\n',
    'fe/packages/i18n/package.json': built('@app/i18n'),
    'fe/packages/i18n/src/index.ts': 'export const t = 1;\n',
    'fe/packages/i18n/tsconfig.json': '{}\n',
    'fe/packages/tracked/package.json': json({ name: '@app/tracked', main: './index.ts', exports: './index.ts' }),
    'fe/packages/tracked/index.ts': 'export const x = 1;\n',
    'fe/apps/web/package.json': json({ name: '@app/web', dependencies: { '@app/ui': '0.0.0' } }),
    'fe/apps/web/tsconfig.json': '{}\n',
    'fe/apps/web/src/page.ts': "import { ui } from '@app/ui';\n",
    'be/tsconfig.json': '{}\n',
    'be/src/a.ts': 'export const a = 1;\n',
  };
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  return { root, files, tracked: Object.keys(files).sort() };
}

/** A command port that "builds" a package by writing its dist, and records the folders it was asked for. */
function builder(root: string, order: string[], fail: ReadonlySet<string> = new Set()): ParityRun {
  return async (request) => {
    const dir = /--workspace (\S+)/u.exec(request.argv.at(-1) ?? '')?.[1] ?? '';
    order.push(dir);
    if (fail.has(dir)) return { status: 1, stdout: '', stderr: `error TS2307: boom in ${dir}\n` };
    fs.mkdirSync(path.join(root, dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'dist', 'index.js'), '');
    fs.writeFileSync(path.join(root, dir, 'dist', 'index.d.ts'), '');
    return { status: 0, stdout: '', stderr: '' };
  };
}

const BE: TypesProgram = { name: 'be', tsconfig: 'be/tsconfig.json', reads: ['be'] };
const WEB: TypesProgram = { name: 'fe/apps/web', tsconfig: 'fe/apps/web/tsconfig.json', reads: ['fe/apps/web'] };

test('a package that exports a build output is found, dependencies first; one that exports tracked source is not', () => {
  const { root, tracked } = app();
  const found = builtPackagesOf(root, tracked);
  assert.deepEqual(found.map((pkg) => pkg.name), ['@app/i18n', '@app/ui']);
  assert.deepEqual(found[1]?.needs, ['@app/i18n']);
  assert.deepEqual(found[1]?.outputs, ['fe/packages/ui/dist/index.d.ts', 'fe/packages/ui/dist/index.js']);
});

test('the key of a program that depends on a built package changes with that package source, and no other program key does', () => {
  const { root, files, tracked } = app();
  const [be, web] = programsWithBuiltReads([BE, WEB], builtPackagesOf(root, tracked), root) as [TypesProgram, TypesProgram];
  assert.deepEqual(be.reads, ['be']);
  assert.deepEqual(web.reads, ['fe/apps/web', 'fe/packages/ui', 'fe/packages/i18n'], 'web reads ui and, through it, i18n');
  const before = createFakeSession({ files });
  const after = createFakeSession({ files: { ...files, 'fe/packages/i18n/src/index.ts': 'export const t = 2;\n' } });
  assert.notEqual(programKey(web, before), programKey(web, after));
  assert.equal(programKey(be, before), programKey(be, after));
  assert.equal(programKey(WEB, before), programKey(WEB, after), 'without the built reads the change would not re-key the program: the hole this closes');
});

test('buildPackages builds dependencies first, skips an unchanged package whose output is present, and rebuilds one whose source changed or whose output is gone', async () => {
  const { root, files, tracked } = app();
  const found = builtPackagesOf(root, tracked);
  const toolCacheDir = path.join(root, '.tool');
  const order: string[] = [];
  const run = (changes: Record<string, string> = {}): ReturnType<typeof buildPackages> => buildPackages({ session: createFakeSession({ files: { ...files, ...changes } }), repoRoot: root, built: found, toolCacheDir, env: {}, run: builder(root, order) });
  assert.deepEqual((await run()).built, ['@app/i18n', '@app/ui']);
  assert.deepEqual(order, ['fe/packages/i18n', 'fe/packages/ui']);
  order.length = 0;
  assert.deepEqual((await run()).skipped, ['@app/i18n', '@app/ui']);
  assert.deepEqual(order, []);
  const edit = { 'fe/packages/i18n/src/index.ts': 'export const t = 2;\n' };
  assert.deepEqual((await run(edit)).built, ['@app/i18n', '@app/ui'], 'ui depends on i18n, so it rebuilds with it');
  fs.rmSync(path.join(root, 'fe/packages/ui/dist'), { recursive: true });
  assert.deepEqual((await run(edit)).built, ['@app/ui'], 'a missing output rebuilds its package alone');
});

test('a failed package build is one coded failure, its dependents are not built and the programs that read it do not run', async () => {
  const { root, files, tracked } = app();
  const order: string[] = [];
  const ran: string[] = [];
  const outcome = await runTypesForApp(createFakeSession({ files }), {
    repoRoot: root, tracked, env: { STARCI_CACHE_HOME: path.join(root, '.home') }, parity: builder(root, order, new Set(['fe/packages/i18n'])),
    tsc: (program) => { ran.push(program.name); return { status: 0, output: '', files: [] }; },
  });
  assert.deepEqual(order, ['fe/packages/i18n'], 'ui depends on the failed i18n and is not built');
  assert.deepEqual(outcome.findings.map((found) => [found.code, found.path]), [[TYPES_PACKAGE_BUILD_FAILED, 'fe/packages/i18n/package.json']]);
  assert.match(outcome.findings[0]?.message ?? '', /boom in fe\/packages\/i18n/u);
  assert.deepEqual(ran.sort(), ['be', 'fe/packages/i18n'], 'ui and web read the failed package through its dist and do not run; the failed package own program and be do');
  assert.deepEqual([...outcome.result.incomplete].sort(), ['fe/apps/web', 'fe/packages/ui']);
});

test('the types step builds the packages before the first tsc, so a program that imports a dist finds it', async () => {
  const { root, files, tracked } = app();
  const order: string[] = [];
  const seen: Record<string, boolean> = {};
  const outcome = await runTypesForApp(createFakeSession({ files }), {
    repoRoot: root, tracked, env: { STARCI_CACHE_HOME: path.join(root, '.home') }, parity: builder(root, order),
    tsc: (program) => { seen[program.name] = ['ui', 'i18n'].every((pkg) => fs.existsSync(path.join(root, 'fe/packages', pkg, 'dist/index.d.ts'))); return { status: 0, output: '', files: [] }; },
  });
  assert.deepEqual(order, ['fe/packages/i18n', 'fe/packages/ui']);
  assert.equal(seen['fe/apps/web'], true);
  assert.equal(outcome.result.ok, true);
});

/** `app()` with a root `codegen` script, a `.gitignore` for `__generated__` and a git repository, so generated files are untracked and ignored. */
function appWithCodegen(): ReturnType<typeof app> {
  const made = app();
  fs.writeFileSync(path.join(made.root, 'package.json'), json({ name: 'app', workspaces: ['fe/apps/*', 'fe/packages/*'], scripts: { codegen: 'node scripts/codegen.mjs' } }));
  made.files['package.json'] = fs.readFileSync(path.join(made.root, 'package.json'), 'utf8');
  fs.writeFileSync(path.join(made.root, '.gitignore'), '__generated__/\n');
  execFileSync('git', ['init', '-q'], { cwd: made.root });
  return made;
}

/** A command port: `npm run codegen` writes the generated file (or fails), a workspace build writes its dist. */
function generator(root: string, calls: string[], failCodegen = false): ParityRun {
  const build = builder(root, calls);
  return async (request) => {
    if (!/codegen/u.test(request.argv.at(-1) ?? '')) return build(request);
    calls.push('codegen');
    if (failCodegen) return { status: 1, stdout: '', stderr: 'Unable to find any GraphQL type definitions\n' };
    fs.mkdirSync(path.join(root, 'fe/apps/web/src/__generated__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fe/apps/web/src/__generated__/graphql.ts'), 'export type T = 1;\n');
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('the types step runs the app codegen before the first tsc, skips it while its inputs and outputs are unchanged, and runs it again when an input changed', async () => {
  const { root, files } = appWithCodegen();
  const tracked = Object.keys(files).sort();
  const calls: string[] = [];
  const env = { STARCI_CACHE_HOME: path.join(root, '.home') };
  const seen: boolean[] = [];
  const tsc = (): { status: number; output: string; files: string[] } => { seen.push(fs.existsSync(path.join(root, 'fe/apps/web/src/__generated__/graphql.ts'))); return { status: 0, output: '', files: [] }; };
  const step = (changes: Record<string, string> = {}): ReturnType<typeof runTypesForApp> => runTypesForApp(createFakeSession({ files: { ...files, ...changes } }), { repoRoot: root, tracked, env, parity: generator(root, calls), tsc });
  await step();
  assert.equal(calls[0], 'codegen', 'codegen runs before the package builds and the first tsc');
  assert.ok(seen.length > 0 && seen.every(Boolean), 'every program ran with the generated file present');
  calls.length = 0;
  await step();
  assert.ok(!calls.includes('codegen'), 'unchanged inputs and present outputs skip it');
  await step({ 'be/contracts/schema.graphql': 'type Q { a: Int }\n' });
  assert.equal(calls.filter((call) => call === 'codegen').length, 1, 'a changed schema runs it again');
  assert.ok(generatedInputs(root, 'fe/apps/web/').includes('fe/apps/web/src/__generated__/graphql.ts'));
});

test('a failed codegen is one coded failure and no program runs', async () => {
  const { root, files } = appWithCodegen();
  const calls: string[] = [];
  const ran: string[] = [];
  const outcome = await runTypesForApp(createFakeSession({ files }), {
    repoRoot: root, tracked: Object.keys(files).sort(), env: { STARCI_CACHE_HOME: path.join(root, '.home') }, parity: generator(root, calls, true),
    tsc: (program) => { ran.push(program.name); return { status: 0, output: '', files: [] }; },
  });
  assert.deepEqual(outcome.findings.map((found) => found.code), [TYPES_CODEGEN_FAILED]);
  assert.match(outcome.findings[0]?.message ?? '', /Unable to find any GraphQL/u);
  assert.deepEqual(ran, []);
  assert.deepEqual(calls, ['codegen'], 'the package builds are not started either');
});

test('the key of a program holds the generated files it reads: a changed output re-keys it', () => {
  const { root, files } = appWithCodegen();
  fs.mkdirSync(path.join(root, 'fe/apps/web/src/__generated__'), { recursive: true });
  const generated = path.join(root, 'fe/apps/web/src/__generated__/graphql.ts');
  fs.writeFileSync(generated, 'export type T = 1;\n');
  const session = createFakeSession({ files });
  const inputs = { untracked: generatedInputs(root, 'fe/apps/web/') };
  const same = programKey({ ...WEB, tsconfig: 'fe/apps/web/tsconfig.json' }, { ...session, root } as never, inputs);
  fs.writeFileSync(generated, 'export type T = 2;\n');
  assert.notEqual(programKey(WEB, { ...session, root } as never, inputs), same);
});

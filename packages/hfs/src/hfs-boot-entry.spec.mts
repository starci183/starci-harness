// proves: BE_BOOT_ENTRY_FAILED@lite
// proves: BE_BOOT_ENTRY_UNJUDGED@lite
// R448: a back-end app that declares a boot entry (hfs.json sides.be.apps[].boot) is composed for real without listening (the incident: a provider
// injecting a token its module did not export passed every gate and failed the stack seed), and the stack's withheld output names its error lines
// only, redacted (error-tail.mts). The boot runs through the real Nest of this package's devDependencies, so the fixtures live under packages/hfs.
import test, { after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFakeSession } from '../cache/fake-session.mjs';
import { BOOT_ENTRY_STEP, runBootEntryChecks } from '../cache/boot-entry-check.mjs';
import { VERDICT_FOLDER } from '../cache/check-verdicts.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import { BOOT_PROOF_TIMEOUT } from '../runtime/scripts/hfs/app-wiring.mjs';
import { appBootAsync, bootEntries, BOOT_ENTRY_FAILED, BOOT_ENTRY_UNJUDGED, type BootResult } from '../runtime/scripts/hfs/app-boot.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { errorTail, maskValues, withTail } from '../runtime/scripts/lib/error-tail.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const FIXTURES = fileURLToPath(new URL('../.tmp-docs/', import.meta.url));
const FIXTURES_EXISTED = fs.existsSync(FIXTURES);
after(() => {
  if (FIXTURES_EXISTED) return;
  try { fs.rmdirSync(FIXTURES); } catch { /* another test run owns files in it */ }
});
const MODULE = 'apps/api/src/app.module.ts';
const config = { compilerOptions: { target: 'ES2022', module: 'CommonJS', experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true, skipLibCheck: true } };
const SECRET = 'hunter2-stub-value';

/** The incident: a provider injects a token its own module does not import, because the module that provides it does not export it. */
const unexported = (exported: boolean): string => `import { Module, Injectable, Inject } from '@nestjs/common';
const OPTIONS = Symbol('options');
@Module({ providers: [{ provide: OPTIONS, useValue: {} }]${exported ? ', exports: [OPTIONS]' : ''} }) class OptionsModule {}
@Injectable() class Statics { constructor(@Inject(OPTIONS) readonly options: unknown) {} }
@Module({ imports: [OptionsModule], providers: [Statics] }) class StaticsModule {}
@Module({ imports: [StaticsModule] }) export class AppModule {}`;

/** The real child, unmetered: the heavy governor is the CLI's, the child itself is what the spec runs. */
const execute: HeavyNodeRun = async (request) => {
  const run = spawnSync(process.execPath, request.args, { cwd: request.cwd, env: { ...request.env, ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }) }, encoding: 'utf8', timeout: request.timeoutMs });
  return { status: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr, error: run.error };
};

function fixture(t: TestContext, files: Record<string, string>, boot: unknown = { env: { DATABASE_URL: `postgres://app:${SECRET}@db/x` } }) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURES, 'boot-entry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }));
  const repo = { kind: 'app', edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api', ...(boot === null ? {} : { boot }) }] } } };
  const all: Record<string, unknown> = { 'hfs.json': repo, 'be/tsconfig.json': config, ...Object.fromEntries(Object.entries(files).map(([file, text]) => [`be/${file}`, text])) };
  for (const [file, value] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { repoRoot: dir, repo, execute };
}

test('a boot entry whose module does not export what a provider injects fails with Nest\'s own message; the exported one composes', async (t) => {
  const red = await appBootAsync(fixture(t, { [MODULE]: unexported(false) }));
  assert.equal(red.ok, false);
  assert.equal(red.findings.length, 1);
  assert.equal(red.findings[0]?.code, BOOT_ENTRY_FAILED);
  assert.equal(red.findings[0]?.path, `be/${MODULE}`);
  assert.match(red.findings[0]?.message ?? '', /Nest can't resolve dependencies of the Statics/u);
  assert.deepEqual(red.apps, ['api']);
  assert.ok(Array.isArray(red.loaded) && red.loaded.length > 0);
  const green = await appBootAsync(fixture(t, { [MODULE]: unexported(true) }));
  assert.equal(green.ok, true);
  assert.deepEqual(green.findings, []);
});

test('lifecycle hooks never run and the network is shut: a database connect in onModuleInit does not fail a composable entry', async (t) => {
  const source = `import { Module, Injectable } from '@nestjs/common';
import net from 'node:net';
@Injectable() class Pool { onModuleInit() { net.connect(5432, '127.0.0.1'); throw new Error('connected'); } }
@Module({ providers: [Pool] }) export class AppModule {}`;
  const report = await appBootAsync(fixture(t, { [MODULE]: source }));
  assert.deepEqual(report.findings, []);
});

test('a failure outside the wiring is a warning that names it with the declared values masked, never an error', async (t) => {
  const source = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Config { constructor() { throw new Error('bad config ' + process.env.DATABASE_URL + ' via postgres://admin:' + 'top' + 'secret' + '@h/x'); } }
@Module({ providers: [Config] }) export class AppModule {}`;
  const report = await appBootAsync(fixture(t, { [MODULE]: source }));
  assert.equal(report.ok, true);
  assert.equal(report.findings[0]?.code, BOOT_ENTRY_UNJUDGED);
  assert.equal(report.findings[0]?.level, 'warning');
  assert.match(report.findings[0]?.message ?? '', /bad config/u);
  assert.doesNotMatch(report.findings[0]?.message ?? '', new RegExp(`${SECRET}|topsecret`, 'u'));
});

test('the entry may name a factory that returns the root, and its module and export; the child gets the declared env only', async (t) => {
  const source = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Env { constructor() { if (process.env.PORT !== '3000' || process.env.NODE_ENV !== 'test' || process.env.HOME !== undefined) throw new Error('env'); } }
@Module({ providers: [Env] }) class Root {}
export const bootRoot = async () => Root;`;
  const report = await appBootAsync(fixture(t, { 'apps/api/src/boot.ts': source }, { module: 'apps/api/src/boot.ts', factory: 'bootRoot', env: { PORT: '3000' } }));
  assert.deepEqual(report.findings, []);
  assert.equal(bootEntries({ sides: { be: { apps: [{ name: 'api', boot: { env: { PORT: '3000' } } }] } } })[0]?.module, 'apps/api/src/app.module.ts');
});

test('a missing module file is an error and an app that declares no boot entry is not run', async (t) => {
  const missing = await appBootAsync(fixture(t, {}));
  assert.equal(missing.findings[0]?.code, BOOT_ENTRY_FAILED);
  assert.match(missing.findings[0]?.message ?? '', /names a module file the app does not hold/u);
  const none = await appBootAsync({ ...fixture(t, { [MODULE]: unexported(false) }, null), execute: async () => assert.fail('no entry declared, no child') });
  assert.equal(none.status, 'skipped');
});

test('hfs.json declares boot on a be app as { module?, export?, factory?, env?, timeoutMs? } and refuses the rest', () => {
  const declared = (boot: unknown, side: 'be' | 'fe' = 'be') => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api', ...(side === 'be' ? { boot } : {}) }] }, fe: { apps: [{ name: 'web', kind: 'next', ...(side === 'fe' ? { boot } : {}) }], grammar: 'core' } } }, ['be', 'fe']).filter((problem) => problem.includes('boot'));
  assert.deepEqual(declared({ module: 'apps/api/src/seed.module.ts', export: 'SeedModule', env: { PORT: '3000' } }), []);
  assert.deepEqual(declared({ factory: 'bootRoot' }), []);
  assert.deepEqual(declared({ factory: 'bootRoot', timeoutMs: 60000 }), []);
  assert.equal(declared({ timeoutMs: 100 }).length, 1);
  assert.equal(declared({ timeoutMs: '60000' }).length, 1);
  assert.equal(declared({ module: '../app.module.ts' }).length, 1);
  assert.equal(declared({ module: 'apps/api/src/app.module.js' }).length, 1);
  assert.equal(declared({ export: 'a', factory: 'b' }).length, 1);
  assert.equal(declared({ env: { port: '1' } }).length, 1);
  assert.equal(declared({ env: { PORT: 3000 } }).length, 1);
  assert.equal(declared({ unknown: true }).length, 1);
  assert.equal(declared({}, 'fe').length, 1);
});

const BE_FILES = { 'be/package.json': JSON.stringify({ name: 'be' }), 'be/src/app.ts': 'export {};\n', 'package-lock.json': '{}', 'hfs.json': JSON.stringify({ edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api', boot: {} }] } } }) };
const green = (): BootResult => ({ ok: true, status: 'checked', apps: ['api'], findings: [], loaded: [], states: [{ app: 'api', state: 'green' }] });
const red = (): BootResult => ({ ok: false, status: 'checked', apps: ['api'], loaded: [], states: [{ app: 'api', state: 'red' }], findings: [{ code: BOOT_ENTRY_FAILED, level: 'error', path: 'be/apps/api/src/app.module.ts', reason: 'Nest refused the composition', message: 'does not compose' }] });

async function check(t: TestContext, stored: readonly CacheRecord[], files: Record<string, string>, boot: () => BootResult) {
  const root = mkdtemp(t, 'starci-boot-entry-');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const session = { ...createFakeSession({ files, records: { [VERDICT_FOLDER]: stored } }), root };
  let runs = 0;
  const result = await runBootEntryChecks({ repoRoot: root, session, boot: () => { runs += 1; return boot(); } });
  return { runs, result, records: [...(session.replaced.get(VERDICT_FOLDER) ?? [])] };
}

test('the boot entry is a verdict of check/build, run by the hfs gate: its error reaches the findings, an unchanged side reuses it and an app that stops declaring it drops it', async (t) => {
  const first = await check(t, [], BE_FILES, red);
  assert.equal(first.runs, 1);
  assert.deepEqual(first.result.findings.map((item) => item.code), [BOOT_ENTRY_FAILED]);
  assert.deepEqual(first.result.lines, ['  boot entry api: red']);
  assert.deepEqual(first.records.map((record) => record.step), [BOOT_ENTRY_STEP]);
  const again = await check(t, first.records, BE_FILES, red);
  assert.equal(again.runs, 0, 'nothing it reads changed');
  assert.deepEqual(again.result.findings.map((item) => item.code), [BOOT_ENTRY_FAILED]);
  assert.deepEqual(again.result.lines, ['  boot entry api: red (reused, nothing it reads changed)']);
  const changed = await check(t, first.records, { ...BE_FILES, 'be/src/app.ts': 'export const x = 1;\n' }, green);
  assert.equal(changed.runs, 1, 'a back-end change runs it again');
  assert.deepEqual(changed.result.findings, []);
  assert.deepEqual(changed.result.lines, ['  boot entry api: green']);
  const undeclared = await check(t, first.records, { ...BE_FILES, 'hfs.json': JSON.stringify({ edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api' }] } } }) }, green);
  assert.equal(undeclared.runs, 0);
  assert.deepEqual(undeclared.result, { findings: [], lines: [] });
  assert.deepEqual(undeclared.records, []);
  const timeout = (): BootResult => ({ ...green(), ok: true, findings: [{ code: BOOT_PROOF_TIMEOUT, level: 'warning', path: 'be/apps/api/src/app.module.ts', reason: 'proof worker timed out', message: 'timed out' }], states: [{ app: 'api', state: 'not judged' }] });
  assert.deepEqual((await check(t, [], BE_FILES, timeout)).records, [], 'a timeout is never stored');
});

test('the error tail keeps error lines and frames only, masks every opened value in each form and never prints an env dump or URL credentials', () => {
  const value = 'p@ss w0rd/value';
  const output = {
    stdout: ['seeding the workspace', `DATABASE_URL=postgres://app:${value}@db/x`, 'ok done'].join('\n'),
    stderr: [
      "Error: Nest can't resolve dependencies of the PackageStaticsService (?).",
      `    at Object.<anonymous> (/app/be/dist/seed.js:10:5) while opening ${encodeURIComponent(value)} for ${JSON.stringify(value).slice(1, -1)}`,
      'Error: connect ECONNREFUSED postgres://svc:hunter2@db:5432/app',
      'UnknownDependenciesException: could not resolve',
      'a plain line that says nothing',
    ].join('\n'),
  };
  const tail = errorTail(output, [value, 'ab']);
  assert.deepEqual(tail.map((line) => line.replace(/\[redacted[^\]]*\]/gu, '[x]')), [
    "Error: Nest can't resolve dependencies of the PackageStaticsService (?).",
    '    at Object.<anonymous> (/app/be/dist/seed.js:10:5) while opening [x] for [x]',
    'Error: connect ECONNREFUSED postgres://svc:[x]@db:5432/app',
    'UnknownDependenciesException: could not resolve',
  ]);
  assert.equal(tail.join('\n').includes('hunter2'), false);
  assert.equal(tail.join('\n').includes(value), false);
  assert.deepEqual(errorTail({ stdout: 'all fine\nDATABASE_URL=Error=1', stderr: '' }), []);
  assert.equal(maskValues('a ab abc', ['ab', 'abc']), 'a ab [redacted]');
  assert.equal(withTail('failed; its output is withheld', { stdout: 'nothing', stderr: '' }), 'failed; its output is withheld');
  assert.match(withTail('failed; its output is withheld', { stdout: '', stderr: 'TypeError: x is not a function' }), /^failed; its output is withheld\nerror lines of its output \(secret values masked\):\n {2}TypeError: x is not a function$/u);
});

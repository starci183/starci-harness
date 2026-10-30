// proves: BE_APP_BOOT_PROOF_MISSING@lite
// proves: BOOT_PROOF_TIMEOUT@lite
import test, { after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appWiring, appWiringMain, BOOT_PROOF_TIMEOUT, BOOT_PROOF_TIMEOUT_ENV, wiringFixturePath, workerBudget } from '../runtime/scripts/hfs/app-wiring.mjs';
import { bootProofFindings } from '../runtime/scripts/hfs/rules/boot-proof.mjs';
import { a15Findings } from '../runtime/scripts/hfs/rules/a15-findings.mjs';

const FIXTURES = fileURLToPath(new URL('../.tmp-docs/', import.meta.url));
// The wiring proof resolves @nestjs/common through this package's own node_modules (its devDependencies), so the fixtures live under
// packages/hfs, not in os.tmpdir(). Each test removes its own directory; the parent is removed too when this file created it, so no empty directory is left
// behind for the tree check (HFS_EMPTY_DIR).
const FIXTURES_EXISTED = fs.existsSync(FIXTURES);
after(() => {
  if (FIXTURES_EXISTED) return;
  try { fs.rmdirSync(FIXTURES); } catch { /* another test run owns files in it */ }
});
const APP_MODULE = 'apps/api/src/app.module.ts';
const CODE = 'BE_APP_BOOT_PROOF_MISSING';
const config = { compilerOptions: { target: 'ES2022', module: 'CommonJS', experimentalDecorators: true,
  emitDecoratorMetadata: true, esModuleInterop: true, skipLibCheck: true, paths: { '@modules/*': ['./src/modules/*'] } } };
const passingModule = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Dependency {}
@Injectable() class Subject { constructor(readonly dependency: Dependency) {} }
@Module({ providers: [Dependency, Subject] }) export class AppModule {}`;
const missingModule = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Dependency {}
@Injectable() class Subject { constructor(readonly dependency: Dependency) {} }
@Module({ providers: [Subject] }) export class AppModule {}`;

function fixture(t: TestContext, entries: Record<string, unknown>, edition = 'lite', rootScope = false) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURES, 'a13-wiring-'));
  assert.ok(path.resolve(dir).startsWith(`${path.resolve(FIXTURES)}${path.sep}`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }));
  const repo = rootScope ? { kind: 'app', edition, sides: { be: { apps: [{ name: 'api', kind: 'api' }] } } }
    : { profile: 'be', edition, apps: [{ name: 'api', kind: 'api' }] };
  const files = { 'hfs.json': repo, ...(rootScope ? { 'be/tsconfig.json': config } : { 'tsconfig.json': config }), ...entries };
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { repoRoot: dir, repo, files: Object.keys(files) };
}

test('BE_APP_BOOT_PROOF_MISSING lite: real constructor metadata refuses an unresolved provider', t => {
  const context = fixture(t, { [APP_MODULE]: missingModule });
  const findings = bootProofFindings(context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.code, CODE);
  assert.equal(findings[0]!.path, APP_MODULE);
  assert.equal(findings[0]!.reason, 'unresolved DI provider');
});

test('BE_APP_BOOT_PROOF_MISSING lite: a complete actual Nest graph passes', t => {
  assert.deepEqual(bootProofFindings(fixture(t, { [APP_MODULE]: passingModule })), []);
});

for (const scope of ['REQUEST', 'TRANSIENT']) {
  test(`BE_APP_BOOT_PROOF_MISSING lite: an unused ${scope} provider with missing DI is refused`, t => {
    const source = `import { Module, Inject, Injectable, Scope } from '@nestjs/common';
@Injectable({ scope: Scope.${scope} }) class Subject { constructor(@Inject('absent') readonly absent: unknown) {} }
@Module({ providers: [Subject] }) export class AppModule {}`;
    const report = appWiring(fixture(t, { [APP_MODULE]: source }));
    assert.equal(report.ok, false);
    assert.equal(report.findings[0]!.reason, 'unresolved DI provider');
  });
}

test('BE_APP_BOOT_PROOF_MISSING lite: scoped resolution preserves private token ownership and request doubles', t => {
  const source = `import { Module, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
@Injectable({ scope: Scope.REQUEST }) class First {
  constructor(@Inject('private') readonly value: number, @Inject(REQUEST) readonly request: { proof: boolean }) {
    if (value !== 1 || !request.proof) throw new Error('wrong module or request');
  }
}
@Injectable({ scope: Scope.TRANSIENT }) class Second {
  constructor(@Inject('private') readonly value: number) { if (value !== 2) throw new Error('wrong module'); }
}
@Module({ providers: [{ provide: 'private', useValue: 1 }, First] }) class FirstModule {}
@Module({ providers: [{ provide: 'private', useValue: 2 }, Second] }) class SecondModule {}
@Module({ imports: [FirstModule, SecondModule] }) export class AppModule {}`;
  const builder = `export const buildWiringProof = () => ({ request: { proof: true } });`;
  assert.equal(appWiring(fixture(t, { [APP_MODULE]: source, [wiringFixturePath('api')]: builder })).ok, true);
});

test('BE_APP_BOOT_PROOF_MISSING lite: circular factory dependencies are refused', t => {
  const source = `import { Module } from '@nestjs/common';
@Module({ providers: [
  { provide: 'first', inject: ['second'], useFactory: (second: unknown) => second },
  { provide: 'second', inject: ['first'], useFactory: (first: unknown) => first },
] }) export class AppModule {}`;
  const report = appWiring({ ...fixture(t, { [APP_MODULE]: source }), timeout: 2500 });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, CODE);
  assert.match(report.findings[0]!.reason, /circular|timed out/);
});

test('BE_APP_BOOT_PROOF_MISSING full: the unresolved lite fixture leaves existing e2e enforcement unchanged', t => {
  const context = fixture(t, { [APP_MODULE]: missingModule }, 'full');
  assert.deepEqual(bootProofFindings(context), []);
  assert.equal(appWiring(context).status, 'skipped');
});

test('BE_APP_BOOT_PROOF_MISSING full: the passing graph is skipped without loading Nest or a worker', t => {
  const context = fixture(t, { [APP_MODULE]: passingModule }, 'full');
  const report = appWiring({ ...context, run() { assert.fail('full must not compile a lite proof'); } });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test('BE_APP_BOOT_PROOF_MISSING lite: dynamic root cannot pass as its empty static decorator', t => {
  const source = `import { Module } from '@nestjs/common';
@Module({}) export class AppModule {
  static register(options: { providers: unknown[] }) { return { module: AppModule, providers: options.providers }; }
}`;
  const report = appWiring(fixture(t, { [APP_MODULE]: source }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, CODE);
});

test('BE_APP_BOOT_PROOF_MISSING lite: dynamic fixture options compile the real root with an explicit resource double', t => {
  const source = `import { Module, Inject, Injectable } from '@nestjs/common';
@Injectable() class Subject { constructor(@Inject('resource') readonly resource: unknown) {} }
@Module({}) export class AppModule {
  static register(options: { enabled: boolean }) {
    return { module: AppModule, providers: options.enabled ? [Subject,
      { provide: 'resource', useFactory: () => { throw new Error('real resource must not open'); } }] : [] };
  }
}`;
  const builder = `export const buildWiringProof = () => ({ options: { enabled: true }, overrides: [{ token: 'resource', value: {} }] });`;
  const report = appWiring(fixture(t, { [APP_MODULE]: source, [wiringFixturePath('api')]: builder }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test('BE_APP_BOOT_PROOF_MISSING lite: an override cannot invent a missing registered token', t => {
  const source = `import { Module, Inject, Injectable } from '@nestjs/common';
@Injectable() class Subject { constructor(@Inject('absent') readonly absent: unknown) {} }
@Module({ providers: [Subject] }) export class AppModule {}`;
  const builder = `export const buildWiringProof = () => ({ overrides: [{ token: 'absent', value: {} }] });`;
  const report = appWiring(fixture(t, { [APP_MODULE]: source, [wiringFixturePath('api')]: builder }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.reason, 'unresolved DI provider');
});

test('BE_APP_BOOT_PROOF_MISSING lite: missing exported provider remains a Nest scope failure', t => {
  const source = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Dependency {}
@Module({ providers: [Dependency] }) class PrivateModule {}
@Injectable() class Subject { constructor(readonly dependency: Dependency) {} }
@Module({ imports: [PrivateModule], providers: [Subject] }) export class AppModule {}`;
  const report = appWiring(fixture(t, { [APP_MODULE]: source }));
  assert.equal(report.findings[0]!.reason, 'unresolved DI provider');
});

test('BE_APP_BOOT_PROOF_MISSING lite: inherited TypeScript aliases resolve the actual imported module', t => {
  const source = `import { Module } from '@nestjs/common'; import { CapabilityModule } from '@modules/capability';
@Module({ imports: [CapabilityModule] }) export class AppModule {}`;
  const capability = `import { Module } from '@nestjs/common'; @Module({}) export class CapabilityModule {}`;
  const context = fixture(t, { [APP_MODULE]: source, 'src/modules/capability/index.ts': capability,
    'tsconfig.base.json': config, 'tsconfig.json': { extends: './tsconfig.base.json' } });
  assert.equal(appWiring(context).ok, true);
});

test('BE_APP_BOOT_PROOF_MISSING lite: proof does not execute main or lifecycle initialization', t => {
  const source = `import { Module, Injectable } from '@nestjs/common';
@Injectable() class Subject {
  onModuleInit() { throw new Error('initialization must not run'); }
  onModuleDestroy() { throw new Error('teardown must not run'); }
  beforeApplicationShutdown() { throw new Error('shutdown must not run'); }
  onApplicationShutdown() { throw new Error('shutdown must not run'); }
}
@Module({ providers: [Subject] }) export class AppModule {}`;
  assert.equal(appWiring(fixture(t, { [APP_MODULE]: source,
    'apps/api/src/main.ts': `throw new Error('main must not run');` })).ok, true);
});

test('BE_APP_BOOT_PROOF_MISSING lite: findings redact exception text and child output, and children inherit no secrets', t => {
  const context = fixture(t, { [APP_MODULE]: passingModule });
  const report = appWiring({ ...context, run(_command: string, _args: string[], options: object) {
    assert.deepEqual((options as { env?: unknown }).env, {});
    return { status: 1, stdout: 'private output', stderr: 'private exception' };
  } });
  assert.equal(report.findings[0]!.code, CODE);
  assert.doesNotMatch(JSON.stringify(report), /private output|private exception/);
  const forged = appWiring({ ...context, run() {
    return { status: 0, stdout: JSON.stringify({ ok: false, reason: 'private exception' }) };
  } });
  assert.doesNotMatch(JSON.stringify(forged), /private exception/);
});

test('BE_APP_BOOT_PROOF_MISSING lite: absent declared app and untracked source are refused', t => {
  assert.equal(appWiring(fixture(t, {})).findings[0]!.reason, 'app module is missing');
  const context = fixture(t, { [APP_MODULE]: passingModule });
  assert.equal(appWiring({ ...context, files: [] }).findings[0]!.reason, 'app module is missing');
});

test('BE_APP_BOOT_PROOF_MISSING lite: root, FE and changed scope avoid duplicate findings', t => {
  const context = fixture(t, { [APP_MODULE]: missingModule });
  assert.deepEqual(bootProofFindings({ ...context, isRoot: true }), []);
  assert.deepEqual(bootProofFindings({ ...context, repo: { ...context.repo, profile: 'fe' } }), []);
  assert.equal(appWiring({ ...context, repo: { kind: 'fe', edition: 'lite', apps: [{ name: 'api' }] },
    run() { assert.fail('raw FE declarations must not compile Nest'); } }).status, 'skipped');
  assert.deepEqual(bootProofFindings({ ...context, inScope: () => false }), []);
});

test('BE_APP_BOOT_PROOF_MISSING lite: raw standalone back-end declarations compile the real root', t => {
  const context = fixture(t, { [APP_MODULE]: passingModule });
  const repo = { kind: 'be', edition: 'lite', apps: [{ name: 'api', kind: 'api' }] };
  fs.writeFileSync(path.join(context.repoRoot, 'hfs.json'), JSON.stringify(repo));
  assert.equal(appWiring({ repoRoot: context.repoRoot }).ok, true);
});

test('BE_APP_BOOT_PROOF_MISSING lite: an async registration cannot replace the actual root', t => {
  const source = `import { Module } from '@nestjs/common';
@Module({}) class OtherModule {}
@Module({}) export class AppModule { static async register() { return { module: OtherModule }; } }`;
  const builder = `export const buildWiringProof = () => ({ options: {} });`;
  const report = appWiring(fixture(t, { [APP_MODULE]: source, [wiringFixturePath('api')]: builder }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, CODE);
});

test('BE_APP_BOOT_PROOF_MISSING lite: CLI reports app-relative paths and returns the finding status', t => {
  const context = fixture(t, { [`be/${APP_MODULE}`]: missingModule }, 'lite', true);
  const output: string[] = [];
  assert.equal(appWiringMain(['--wiring', '--json'], { cwd: context.repoRoot, stdout: text => output.push(text) }), 1);
  assert.equal(JSON.parse(output.join('')).findings[0]!.path, `be/${APP_MODULE}`);
  assert.equal(appWiringMain(['--unknown'], { cwd: context.repoRoot, stderr: () => {} }), 2);
});

test('BE_APP_BOOT_PROOF_MISSING lite: the append-only a15 registry invokes this finder', t => {
  const context = fixture(t, {});
  assert.ok(a15Findings(context).some(finding => finding.code === CODE));
});

const TIMED_OUT = Object.freeze({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }) });

test('BOOT_PROOF_TIMEOUT lite: a worker that runs out of its budget twice is a timeout warning, never a failed proof', t => {
  const budgets: (number | undefined)[] = [];
  const run = (_command: string, _args: string[], options: object) => { budgets.push((options as { timeout?: number }).timeout); return TIMED_OUT; };
  const previous = process.env[BOOT_PROOF_TIMEOUT_ENV];
  process.env[BOOT_PROOF_TIMEOUT_ENV] = '4000';
  t.after(() => { if (previous === undefined) delete process.env[BOOT_PROOF_TIMEOUT_ENV]; else process.env[BOOT_PROOF_TIMEOUT_ENV] = previous; });
  const report = appWiring({ ...fixture(t, { [APP_MODULE]: passingModule }), run });
  assert.deepEqual(budgets, [4000, 4000], 'its own budget from the environment, retried once');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]!.code, BOOT_PROOF_TIMEOUT);
  assert.equal(report.findings[0]!.level, 'warning');
  assert.equal(report.findings.some((finding) => finding.code === CODE), false);
});

test('BOOT_PROOF_TIMEOUT lite: a real worker stuck in a TypeScript that never returns is stopped by its budget, retried once and reported', t => {
  const hang = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000);\n';
  const context = fixture(t, { [`be/${APP_MODULE}`]: passingModule, 'be/node_modules/typescript/package.json': '{"name":"typescript","version":"0.0.0","main":"index.js"}', 'be/node_modules/typescript/index.js': hang }, 'lite', true);
  const previous = process.env[BOOT_PROOF_TIMEOUT_ENV];
  process.env[BOOT_PROOF_TIMEOUT_ENV] = '2000';
  t.after(() => { if (previous === undefined) delete process.env[BOOT_PROOF_TIMEOUT_ENV]; else process.env[BOOT_PROOF_TIMEOUT_ENV] = previous; });
  const started = Date.now();
  const report = appWiring(context);
  assert.ok(Date.now() - started >= 4000, 'two spawns, each stopped at its own budget');
  assert.deepEqual(report.findings.map((finding) => [finding.code, finding.level]), [[BOOT_PROOF_TIMEOUT, 'warning']]);
});

test('BOOT_PROOF_TIMEOUT lite: one timeout is retried and a green retry is a green proof', t => {
  let calls = 0;
  const run = () => (calls++ === 0 ? TIMED_OUT : { status: 0, stdout: JSON.stringify({ ok: true }), stderr: '' });
  const report = appWiring({ ...fixture(t, { [APP_MODULE]: passingModule }), run });
  assert.equal(calls, 2);
  assert.deepEqual(report.findings, []);
});

test('BOOT_PROOF_TIMEOUT lite: without the CLI the worker keeps the four-deadline budget', () => {
  assert.equal(workerBudget(15000, {}), 62000);
  assert.equal(workerBudget(15000, { [BOOT_PROOF_TIMEOUT_ENV]: '300000' }), 300000);
});

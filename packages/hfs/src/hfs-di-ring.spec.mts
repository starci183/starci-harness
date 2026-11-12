// proves: BE_DI_RING@lite
// R401: the boot proof's worker scans the registered root for provider rings before it compiles, and names each one.
//
// What the real Nest does with each fixture (Nest 11.2.5, Test.createTestingModule({ imports: [AppModule] }).compile() with no scan, under a
// 10 s timer, run by hand, not in CI):
//   - the fail fixture below (BankFeedTriggerService -> ProviderTriggersService -> Symbol(TRIGGER_DECIDERS) -> BankFeedTriggerService, the
//     port bound by `useExisting`): no verdict after 10 s, the compile waits forever; a plain three-class ring hangs the same way;
//   - the pass fixture (the port bound to BankFeedDeciderService): compiled;
//   - the ring of two below: CircularDependencyException, `A circular dependency has been detected inside "Second". Please, make sure that
//     each side of a bidirectional relationships are decorated with "forwardRef()"...` (the boot proof's `circular DI dependency`);
//   - a ring closed by one forwardRef edge compiles and injects the real instances, whatever its length (two, three), through a class, a
//     `useExisting` alias or a factory: Nest defers that edge, so it is no ring here, and R85 `no-forward-ref` refuses the forwardRef itself.
import test, { after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { appWiring, DI_RING_CODE } from '../runtime/scripts/hfs/app-wiring.mjs';
import { scanProviderRings, ringChain } from '../runtime/scripts/hfs/di-ring.mjs';
import { bootProofFindings } from '../runtime/scripts/hfs/rules/boot-proof.mjs';

const FIXTURES = fileURLToPath(new URL('../.tmp-docs/', import.meta.url));
// Like hfs-boot-proof.spec.mts: the worker resolves @nestjs/* through this package's node_modules, so the fixtures live under packages/hfs.
const FIXTURES_EXISTED = fs.existsSync(FIXTURES);
after(() => {
  if (FIXTURES_EXISTED) return;
  try { fs.rmdirSync(FIXTURES); } catch { /* another test run owns files in it */ }
});
const config = { compilerOptions: { target: 'ES2022', module: 'CommonJS', experimentalDecorators: true,
  emitDecoratorMetadata: true, esModuleInterop: true, skipLibCheck: true, paths: { '@modules/*': ['./src/modules/*'] } } };

function app(t: TestContext, entries: Record<string, string>) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURES, 'di-ring-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }));
  const repo = { kind: 'app', edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api' }] } } };
  const files: Record<string, string> = { 'hfs.json': JSON.stringify(repo), 'be/tsconfig.json': JSON.stringify(config) };
  for (const [file, text] of Object.entries(entries)) files[`be/${file}`] = text;
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return { repoRoot: dir, repo, files: Object.keys(files) };
}

// The SEVEN shape: two global modules; the trigger service optionally injects the deciders port, and the port is bound by `useExisting` to a
// service that injects the trigger service. `fixed` binds the port to its own provider, the decider, which injects no trigger.
const triggers = {
  'src/modules/triggers/triggers.decorators.ts': `export const TRIGGER_DECIDERS: unique symbol = Symbol('TRIGGER_DECIDERS');`,
  'src/modules/triggers/provider-triggers.service.ts': `import { Inject, Injectable, Optional } from '@nestjs/common';
import { TRIGGER_DECIDERS } from './triggers.decorators';
@Injectable() export class ProviderTriggersService { constructor(@Optional() @Inject(TRIGGER_DECIDERS) readonly deciders?: unknown) {} }`,
  'src/modules/triggers/index.ts': `import { Global, Module } from '@nestjs/common';
import { ProviderTriggersService } from './provider-triggers.service';
export { ProviderTriggersService } from './provider-triggers.service';
export { TRIGGER_DECIDERS } from './triggers.decorators';
@Global() @Module({ providers: [ProviderTriggersService], exports: [ProviderTriggersService] }) export class TriggersModule {}`,
  'src/modules/billing/bank-feed-decider.service.ts': `import { Injectable } from '@nestjs/common';
@Injectable() export class BankFeedDeciderService {}`,
  'src/modules/billing/bank-feed-trigger.service.ts': `import { Injectable } from '@nestjs/common';
import { ProviderTriggersService } from '@modules/triggers';
import { BankFeedDeciderService } from './bank-feed-decider.service';
@Injectable() export class BankFeedTriggerService { constructor(readonly triggers: ProviderTriggersService, readonly decider: BankFeedDeciderService) {} }`,
};
const billing = (port: string) => `import { Global, Module } from '@nestjs/common';
import { TRIGGER_DECIDERS } from '@modules/triggers';
import { BankFeedDeciderService } from './bank-feed-decider.service';
import { BankFeedTriggerService } from './bank-feed-trigger.service';
@Global() @Module({ providers: [BankFeedTriggerService, BankFeedDeciderService, { provide: TRIGGER_DECIDERS, useExisting: ${port} }], exports: [TRIGGER_DECIDERS] })
export class BillingModule {}`;
const root = `import { Module } from '@nestjs/common';
import { TriggersModule } from '@modules/triggers';
import { BillingModule } from '@modules/billing/billing.module';
@Module({ imports: [TriggersModule, BillingModule] }) export class AppModule {}`;
const seven = (port: string) => ({ ...triggers, 'src/modules/billing/billing.module.ts': billing(port), 'apps/api/src/app.module.ts': root });

test('BE_DI_RING lite: a three-provider ring through useExisting is named, provider by provider, and the hanging compile is never started', t => {
  const started = Date.now();
  const report = appWiring(app(t, seven('BankFeedTriggerService')));
  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((finding) => finding.code), [DI_RING_CODE]);
  const [finding] = report.findings;
  assert.equal(finding!.level, 'error');
  assert.equal(finding!.path, 'be/src/modules/billing/bank-feed-trigger.service.ts');
  assert.match(finding!.message, /provider ring BankFeedTriggerService -> ProviderTriggersService -> Symbol\(TRIGGER_DECIDERS\) -> BankFeedTriggerService /u);
  assert.match(finding!.message, /BankFeedTriggerService \[BillingModule, be\/src\/modules\/billing\/bank-feed-trigger\.service\.ts\] injects ProviderTriggersService by constructor\[0\]/u);
  assert.match(finding!.message, /ProviderTriggersService \[TriggersModule, be\/src\/modules\/triggers\/provider-triggers\.service\.ts\] injects Symbol\(TRIGGER_DECIDERS\) by @Inject constructor\[0\]/u);
  assert.match(finding!.message, /Symbol\(TRIGGER_DECIDERS\) \[BillingModule, be\/src\/modules\/triggers\/triggers\.decorators\.ts\] injects BankFeedTriggerService by useExisting/u);
  assert.match(finding!.message, /Put the port on its own provider/u);
  assert.ok(Date.now() - started < 15000, 'the scan answers before the compile deadline a hanging compile would run into');
});

test('BE_DI_RING lite: the same app with the port on its own provider passes the scan and the compile', t => {
  const report = appWiring(app(t, seven('BankFeedDeciderService')));
  assert.deepEqual(report.findings, []);
  assert.equal(report.ok, true);
});

test('BE_DI_RING lite: a ring of two, which Nest refuses itself (CircularDependencyException), is named the same way', t => {
  // One file, declared in order, so the ring is the providers' and not an import ring of files (which leaves a type undefined).
  const source = `import { Inject, Injectable, Module } from '@nestjs/common';
@Injectable() export class Second { constructor(@Inject('first') readonly first: unknown) {} }
@Injectable() export class First { constructor(readonly second: Second) {} }
@Module({ providers: [Second, { provide: 'first', useClass: First }] }) export class AppModule {}`;
  const report = appWiring(app(t, { 'apps/api/src/app.module.ts': source }));
  assert.deepEqual(report.findings.map((finding) => finding.code), [DI_RING_CODE]);
  assert.match(report.findings[0]!.message, /provider ring "first" -> Second -> "first" \("first" \[AppModule, be\/apps\/api\/src\/app\.module\.ts\] injects Second by constructor\[0\]; Second \[AppModule, be\/apps\/api\/src\/app\.module\.ts\] injects "first" by @Inject constructor\[0\]\)/u);
});

test('BE_DI_RING lite: a ring of factories is named by its inject entries', t => {
  const source = `import { Module } from '@nestjs/common';
@Module({ providers: [
  { provide: 'first', inject: ['second'], useFactory: (second: unknown) => second },
  { provide: 'second', inject: ['first'], useFactory: (first: unknown) => first },
] }) export class AppModule {}`;
  const report = appWiring(app(t, { 'apps/api/src/app.module.ts': source }));
  assert.deepEqual(report.findings.map((finding) => finding.code), [DI_RING_CODE]);
  assert.match(report.findings[0]!.message, /provider ring "first" -> "second" -> "first" .*injects "second" by useFactory inject\[0\]/u);
});

test('BE_DI_RING lite: a ring that one forwardRef closes is no finding of this rule (Nest defers that edge; R85 refuses forwardRef)', t => {
  const source = `import { Inject, Injectable, Module, forwardRef } from '@nestjs/common';
@Injectable() export class Third { constructor(@Inject(forwardRef(() => First)) readonly first: unknown) {} }
@Injectable() export class Second { constructor(readonly third: Third) {} }
@Injectable() export class First { constructor(readonly second: Second) {} }
@Module({ providers: [First, Second, Third] }) export class AppModule {}`;
  assert.equal(appWiring(app(t, { 'apps/api/src/app.module.ts': source })).ok, true);
});

test('BE_DI_RING lite: every elementary ring of a tangle is reported once, from its member that sorts first', async () => {
  const require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { Injectable, Module } = require('@nestjs/common') as typeof import('@nestjs/common');
  class A {}
  class B {}
  class C {}
  Reflect.defineMetadata('design:paramtypes', [B], A);
  Reflect.defineMetadata('design:paramtypes', [A, C], B);
  Reflect.defineMetadata('design:paramtypes', [A], C);
  for (const provider of [A, B, C]) Injectable()(provider);
  class Tangle {}
  Module({ providers: [A, B, C] })(Tangle);
  const rings = await scanProviderRings(Tangle, require, () => null);
  assert.deepEqual(rings.map(ringChain).sort(), ['A -> B -> A', 'A -> B -> C -> A']);
});

test('BE_DI_RING lite: an optional dependency nothing provides is no edge; one that resolves is', async () => {
  const require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { Inject, Injectable, Module, Optional } = require('@nestjs/common') as typeof import('@nestjs/common');
  const absent = (withPort: boolean) => {
    class Left {}
    class Right {}
    Reflect.defineMetadata('design:paramtypes', [Object], Left);
    Reflect.defineMetadata('design:paramtypes', [Left], Right);
    Optional()(Left, undefined, 0);
    Inject('port')(Left, undefined, 0);
    for (const provider of [Left, Right]) Injectable()(provider);
    class Root {}
    Module({ providers: [Left, Right, ...(withPort ? [{ provide: 'port', useExisting: Right }] : [])] })(Root);
    return Root;
  };
  assert.deepEqual(await scanProviderRings(absent(false), require, () => null), []);
  assert.deepEqual((await scanProviderRings(absent(true), require, () => null)).map(ringChain), ['"port" -> Right -> Left -> "port"']);
});

test('BE_DI_RING lite: a worker that forges ring text forwards none of it', t => {
  const context = app(t, { 'apps/api/src/app.module.ts': `import { Module } from '@nestjs/common'; @Module({}) export class AppModule {}` });
  const forged = (steps: unknown) => appWiring({ ...context, run: () => ({ status: 0, stdout: JSON.stringify({ ok: false, reason: 'provider ring', rings: [{ steps }] }) }) });
  const unsafe = forged([{ token: 'A', module: 'M', file: null, via: 'constructor[0]' }, { token: 'private\nexception text', module: 'M', file: '../../etc/passwd', via: 'anything' }]);
  assert.equal(unsafe.findings[0]!.code, 'BE_APP_BOOT_PROOF_MISSING');
  assert.doesNotMatch(JSON.stringify(unsafe), /private|passwd|anything/u);
  const safe = forged([{ token: 'A', module: 'M', file: 'src/a.ts', via: 'constructor[0]' }, { token: 'B', module: 'M', file: null, via: 'useExisting' }]);
  assert.equal(safe.findings[0]!.code, DI_RING_CODE);
  assert.equal(safe.findings[0]!.path, 'be/src/a.ts');
});

test('BE_DI_RING lite: the content finder of app check reports the ring, and full is left to its e2e boot', t => {
  const context = app(t, seven('BankFeedTriggerService'));
  const beRoot = path.join(context.repoRoot, 'be');
  const files = context.files.filter((file) => file.startsWith('be/')).map((file) => file.slice('be/'.length));
  const lite = { kind: 'be', edition: 'lite', apps: [{ name: 'api', kind: 'api' }] };
  assert.deepEqual(bootProofFindings({ repoRoot: beRoot, files, repo: lite as never, isRoot: false }).map((finding: { code: string }) => finding.code), [DI_RING_CODE]);
  assert.equal(appWiring({ ...context, repo: { ...context.repo, edition: 'full' } }).status, 'skipped');
});

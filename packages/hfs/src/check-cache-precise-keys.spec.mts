// The cached results of the hfs-run and CI-parity families are keyed on what their tool read (check-cache.md, "Which step reuses what"): the boot proof on the
// back-end side and the packages its workers loaded; a CI build step on its command, the files it builds and the lockfile installs its manifests resolve; the
// database step on the migration chain, the entity list's closure and the hfs that judges. Each keeps its verdict while that holds and runs again when it moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeSession } from '../cache/fake-session.mjs';
import { BUILD_FOLDER, buildStepKey, databaseStepKey, parityStepsOf, runParityFamilies, type ParityRun, type ParityStep } from '../cache/parity-family.mjs';
import { installOf, keyWithReads, lockClosure, readsContext, readsOfPaths } from '../cache/package-closure.mjs';
import { WIRING_FOLDER, runWiringFamily } from '../cache/wiring-family.mjs';
import type { WiringResult } from '../runtime/scripts/hfs/app-wiring.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

type Install = { version: string; dependencies?: Record<string, string> };

/** An app on disk: its files, and a lockfile of `installs` (install path to version and dependencies). */
function app(t: { after(fn: () => void): void }, files: Record<string, string>, installs: Record<string, Install>): string {
  const root = mkdtemp(t, 'starci-precise-keys-');
  write(root, files);
  lock(root, installs);
  return root;
}

function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

function lock(root: string, installs: Record<string, Install>): void {
  const packages = { '': { name: 'demo' }, ...Object.fromEntries(Object.entries(installs).map(([key, install]) => [key, { ...install, integrity: `sha512-${install.version}` }])) };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
}

test('reads reduce paths to installs and app files, and a key moves with a read package or file only', (t) => {
  assert.equal(installOf('node_modules/@nestjs/core/index.js'), 'node_modules/@nestjs/core');
  assert.equal(installOf('be/node_modules/x/node_modules/@s/y/lib/a.js'), 'be/node_modules/x/node_modules/@s/y');
  assert.equal(installOf('be/src/a.ts'), null);
  const root = app(t, { 'be/src/a.ts': 'a\n', 'packages/ui/index.ts': 'ui\n' }, { 'node_modules/x': { version: '1.0.0' }, 'node_modules/y': { version: '1.0.0' } });
  const reads = readsOfPaths(root, [path.join(root, 'node_modules/x/index.js'), path.join(root, 'be/src/a.ts'), path.join(root, 'packages/ui/index.ts'), path.join(path.dirname(root), 'elsewhere.js')], (file) => file.startsWith('be/'));
  assert.deepEqual(reads, { packages: ['node_modules/x'], files: ['packages/ui/index.ts'] }, 'a covered file and a path outside the app are not reads');
  const key = (): string => keyWithReads('base', reads, readsContext(root, () => undefined));
  const first = key();
  lock(root, { 'node_modules/x': { version: '1.0.0' }, 'node_modules/y': { version: '2.0.0' } });
  assert.equal(key(), first, 'a package it did not read');
  lock(root, { 'node_modules/x': { version: '1.0.1' }, 'node_modules/y': { version: '2.0.0' } });
  assert.notEqual(key(), first, 'a package it read');
  const second = key();
  write(root, { 'packages/ui/index.ts': 'ui 2\n' });
  assert.notEqual(key(), second, 'a file it read');
});

test('the lockfile closure of manifests follows dependencies transitively and leaves the rest out', (t) => {
  const root = app(t, { 'package.json': JSON.stringify({ devDependencies: { turbo: '2' } }), 'be/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11' }, devDependencies: { typescript: '5' } }) }, {
    'node_modules/turbo': { version: '2.0.0' },
    'node_modules/@nestjs/core': { version: '11.0.0', dependencies: { tslib: '^2' } },
    'node_modules/tslib': { version: '2.8.1' },
    'node_modules/typescript': { version: '5.9.3' },
    'node_modules/react': { version: '19.0.0' },
  });
  assert.deepEqual(lockClosure(root, ['be/package.json']), ['node_modules/@nestjs/core', 'node_modules/tslib', 'node_modules/typescript']);
  assert.deepEqual(lockClosure(root, ['package.json', 'be/package.json']).length, 4);
});

const BE_FILES = { 'be/package.json': JSON.stringify({ name: 'be', dependencies: { '@nestjs/core': '11' } }), 'be/src/app.ts': 'export {};\n', 'hfs.json': '{"edition":"lite"}' };

async function wiring(root: string, files: Record<string, string>, stored: readonly CacheRecord[], result: () => WiringResult): Promise<{ proofs: number; records: CacheRecord[] }> {
  const session = { ...createFakeSession({ files, records: { [WIRING_FOLDER]: stored } }), root };
  let proofs = 0;
  await runWiringFamily(session, { repoRoot: root, run: () => { proofs += 1; return result(); } });
  return { proofs, records: [...(session.replaced.get(WIRING_FOLDER) ?? [])] };
}

test('the boot proof keys on the back-end side and the packages its workers loaded: a package it did not load keeps the verdict', async (t) => {
  const installs = { 'node_modules/@nestjs/core': { version: '11.0.0' }, 'node_modules/@starci/hfs': { version: '6.1.1' }, 'node_modules/react': { version: '19.0.0' } };
  const root = app(t, BE_FILES, installs);
  const proof = (): WiringResult => ({ ok: true, status: 'checked', apps: ['api'], findings: [], loaded: [path.join(root, 'node_modules', '@nestjs', 'core'), path.join(root, 'be', 'src', 'app.ts')] });
  const first = await wiring(root, BE_FILES, [], proof);
  assert.equal(first.proofs, 1);
  assert.deepEqual((first.records[0]?.data as { reads: unknown }).reads, { packages: ['node_modules/@nestjs/core'], files: [] });
  assert.equal((await wiring(root, BE_FILES, first.records, proof)).proofs, 0, 'nothing it read changed');
  lock(root, { ...installs, 'node_modules/@starci/hfs': { version: '6.2.0' }, 'node_modules/react': { version: '19.1.0' } });
  assert.equal((await wiring(root, BE_FILES, first.records, proof)).proofs, 0, 'an hfs or front-end bump keeps the proof');
  lock(root, { ...installs, 'node_modules/@nestjs/core': { version: '11.1.0' } });
  assert.equal((await wiring(root, BE_FILES, first.records, proof)).proofs, 1, 'a package the boot loaded re-runs it');
  assert.equal((await wiring(root, { ...BE_FILES, 'be/src/app.ts': 'export const x = 1;\n' }, first.records, proof)).proofs, 1, 'a back-end change re-runs it');
});

test('a proof whose workers reported no list keys on every install and file, and a timeout is never stored', async (t) => {
  const installs = { 'node_modules/@nestjs/core': { version: '11.0.0' }, 'node_modules/react': { version: '19.0.0' } };
  const root = app(t, BE_FILES, installs);
  const red = (): WiringResult => ({ ok: false, status: 'checked', apps: ['api'], findings: [{ code: 'BE_APP_BOOT_PROOF_MISSING', level: 'error', path: 'be/apps/api/src/app.module.ts', message: 'boot failed', reason: 'proof worker failed or timed out' }], loaded: null });
  const first = await wiring(root, BE_FILES, [], red);
  assert.ok(((first.records[0]?.data as { reads: { packages: string[] } }).reads.packages).includes('node_modules/react'));
  lock(root, { ...installs, 'node_modules/react': { version: '19.1.0' } });
  assert.equal((await wiring(root, BE_FILES, first.records, red)).proofs, 1, 'what it might have read moved');
  const timeout = (): WiringResult => ({ ok: false, status: 'checked', apps: ['api'], findings: [{ code: 'BOOT_PROOF_TIMEOUT', level: 'warning', path: 'be/apps/api/src/app.module.ts', message: 'timed out', reason: 'timeout' }], loaded: null });
  assert.deepEqual((await wiring(root, BE_FILES, [], timeout)).records, []);
});

const WORKFLOW = `name: ci
jobs:
  fast:
    steps:
      - name: typecheck
        run: npm run typecheck
  build:
    steps:
      - name: build be
        run: npm run build:be
      - name: build fe web
        run: npx turbo run build --filter=./fe/apps/web
        env:
          NEXT_PUBLIC_API_URL: https://api.example.invalid
      - name: database migration checks
        run: npm run db:lint && npx starci app db drift
`;

const APP_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo', workspaces: ['be', 'fe/apps/*'], devDependencies: { turbo: '2' } }),
  'turbo.json': '{}\n',
  'hfs.json': '{"edition":"lite"}',
  'be/package.json': JSON.stringify({ name: 'be', dependencies: { '@nestjs/core': '11', typeorm: '0.3' } }),
  'be/tsconfig.json': '{"compilerOptions":{"module":"commonjs"}}',
  'be/src/modules/platform/database/entities.ts': "import { Order } from '../../billing/persistence/entities/order.entity';\nexport const ENTITIES = [Order];\n",
  'be/src/modules/billing/persistence/entities/order.entity.ts': "import { Entity } from 'typeorm';\n@Entity() export class Order {}\n",
  'be/src/modules/billing/billing.service.ts': 'export class BillingService {}\n',
  'fe/apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { next: '16' } }),
  'fe/apps/web/app/page.tsx': 'export default function Page() { return null; }\n',
  'db/migrations/20260101000000_init.sql': 'create table orders (id int);\n',
  'README.md': 'docs\n',
};
const APP_INSTALLS: Record<string, Install> = {
  'node_modules/turbo': { version: '2.0.0' },
  'node_modules/@nestjs/core': { version: '11.0.0' },
  'node_modules/typeorm': { version: '0.3.27', dependencies: { 'reflect-metadata': '^0.2' } },
  'node_modules/reflect-metadata': { version: '0.2.2' },
  'node_modules/typescript': { version: '5.9.3' },
  'node_modules/pg': { version: '8.23.1' },
  'node_modules/next': { version: '16.0.0' },
  'node_modules/@starci/hfs': { version: '6.1.1' },
};

function stepsByName(): Record<string, ParityStep> {
  return Object.fromEntries(parityStepsOf(WORKFLOW).map((step) => [step.name, step]));
}

test('a build step key holds what it builds: its folder, the root, the installs its manifests resolve, its command and the Node major', (t) => {
  const root = app(t, APP_FILES, APP_INSTALLS);
  const steps = stepsByName();
  const keys = (files: Record<string, string> = APP_FILES): Record<string, string> => {
    const session = { ...createFakeSession({ files }), root };
    return Object.fromEntries(['typecheck', 'build be', 'build fe web'].map((name) => [name, buildStepKey(session, steps[name] as ParityStep, '24.1.0').key]));
  };
  const base = keys();
  const moved = (after: Record<string, string>): string[] => Object.keys(base).filter((name) => base[name] !== after[name]);
  assert.deepEqual(moved(keys({ ...APP_FILES, 'be/src/modules/billing/billing.service.ts': 'export class BillingService { x = 1 }\n' })), ['typecheck', 'build be']);
  assert.deepEqual(moved(keys({ ...APP_FILES, 'fe/apps/web/app/page.tsx': 'export default function Page() { return 1; }\n' })), ['typecheck', 'build fe web']);
  assert.deepEqual(moved(keys({ ...APP_FILES, 'turbo.json': '{"tasks":{}}\n' })), ['typecheck', 'build be', 'build fe web'], 'the root config is read by every build');
  lock(root, { ...APP_INSTALLS, 'node_modules/next': { version: '16.0.1' } });
  assert.deepEqual(moved(keys()), ['typecheck', 'build fe web'], 'a package the back end does not resolve keeps its build');
  lock(root, { ...APP_INSTALLS, 'node_modules/@starci/hfs': { version: '6.2.0' } });
  assert.deepEqual(moved(keys()), [], 'an hfs bump rebuilds nothing');
  lock(root, APP_INSTALLS);
  const session = { ...createFakeSession({ files: APP_FILES }), root };
  assert.notEqual(buildStepKey(session, steps['build be'] as ParityStep, '26.0.0').key, base['build be'], 'the Node major');
  assert.notEqual(buildStepKey(session, { ...(steps['build fe web'] as ParityStep), env: { NEXT_PUBLIC_API_URL: 'https://other.invalid' } }, '24.1.0').key, base['build fe web'], 'a build arg');
});

test('the database step key holds the migration chain, the entity closure and its packages, and leaves the rest of the back end out', (t) => {
  const root = app(t, APP_FILES, APP_INSTALLS);
  const step = stepsByName()['database migration checks'] as ParityStep;
  const key = (files: Record<string, string> = APP_FILES): string => databaseStepKey({ ...createFakeSession({ files }), root }, step, 'none').key;
  const base = key();
  assert.equal(key({ ...APP_FILES, 'be/src/modules/billing/billing.service.ts': 'export class BillingService { y = 2 }\n', 'README.md': 'more\n' }), base, 'a service the entities do not import');
  write(root, { 'be/src/modules/billing/persistence/entities/order.entity.ts': "import { Entity } from 'typeorm';\n@Entity() export class Order { id = 1 }\n" });
  assert.notEqual(key({ ...APP_FILES, 'be/src/modules/billing/persistence/entities/order.entity.ts': "import { Entity } from 'typeorm';\n@Entity() export class Order { id = 1 }\n" }), base, 'an entity the list reaches');
  write(root, { 'be/src/modules/billing/persistence/entities/order.entity.ts': APP_FILES['be/src/modules/billing/persistence/entities/order.entity.ts'] as string });
  assert.notEqual(key({ ...APP_FILES, 'db/migrations/20260102000000_more.sql': 'alter table orders add column n int;\n' }), base, 'a migration');
  lock(root, { ...APP_INSTALLS, 'node_modules/reflect-metadata': { version: '0.2.3' } });
  assert.notEqual(key(), base, 'a package the entity closure loads, transitively');
  lock(root, { ...APP_INSTALLS, 'node_modules/next': { version: '16.0.1' }, 'node_modules/@nestjs/core': { version: '11.1.0' } });
  assert.equal(key(), base, 'a package the drift check does not load');
});

test('a build verdict is reused while its key holds and judged again when it moves; a run without a database records none', async (t) => {
  const root = app(t, APP_FILES, APP_INSTALLS);
  const env = { STARCI_CACHE_HOME: path.join(root, '.home') };
  const ran: string[] = [];
  const outcomes: Record<string, { status: number; stdout: string }> = {};
  const run: ParityRun = async (request) => {
    const name = request.label.replace(/^app check build /u, '');
    ran.push(name);
    return { status: outcomes[name]?.status ?? 0, stdout: outcomes[name]?.stdout ?? '', stderr: '' };
  };
  const pass = async (files: Record<string, string>, stored: readonly CacheRecord[]) => {
    ran.length = 0;
    const session = { ...createFakeSession({ files, records: { [BUILD_FOLDER]: stored } }), root };
    const result = await runParityFamilies(session, { repoRoot: root, families: new Set(['build']), env, run, steps: parityStepsOf(WORKFLOW) });
    return { ...result, records: [...(session.replaced.get(BUILD_FOLDER) ?? [])] };
  };
  outcomes['build fe web'] = { status: 1, stdout: `Error occurred prerendering page "/" at ${root}` };
  outcomes['database migration checks'] = { status: 2, stdout: 'DB_DRIFT_NEEDS_DATABASE: needs a database' };
  const first = await pass(APP_FILES, []);
  assert.deepEqual(ran, ['typecheck', 'build be', 'build fe web', 'database migration checks']);
  assert.deepEqual(first.records.map((record) => [record.path, (record.data as { verdict: string }).verdict, record.findings.length]), [
    ['build/build be', 'green', 0], ['build/build fe web', 'red', 1], ['fast/typecheck', 'green', 0],
  ], 'green and red verdicts are kept, a step with no database is not');
  assert.ok(!first.records.some((record) => record.findings.some((finding) => finding.message.includes(root))), 'a recorded message holds no host path or output tail');
  const warm = await pass(APP_FILES, first.records);
  assert.deepEqual(ran, ['database migration checks'], 'every verdict reused; the database step is judged again');
  assert.deepEqual(warm.findings.map((finding) => finding.code), ['CI_PARITY_STEP_FAILED', 'CI_PARITY_DB_SKIPPED'], 'a red verdict stays red');
  assert.deepEqual(warm.reports[0]?.reused, 3);
  outcomes['build fe web'] = { status: 0, stdout: '' };
  await pass({ ...APP_FILES, 'fe/apps/web/app/page.tsx': 'export default function Page() { return 2; }\n' }, first.records);
  assert.deepEqual(ran, ['typecheck', 'build fe web', 'database migration checks'], 'a front-end change rebuilds the typecheck and the front end, not the back end');
  outcomes['database migration checks'] = { status: 0, stdout: '' };
  const withDatabase = await pass(APP_FILES, first.records);
  assert.ok(withDatabase.records.some((record) => record.path === 'build/database migration checks'), 'a host with a database records the drift verdict');
  await pass(APP_FILES, withDatabase.records);
  assert.deepEqual(ran, [], 'and the next run reuses it');
  const fresh = { ...createFakeSession({ files: APP_FILES, records: { [BUILD_FOLDER]: withDatabase.records }, mode: 'full' }), root };
  ran.length = 0;
  await runParityFamilies(fresh, { repoRoot: root, families: new Set(['build']), env, run, steps: parityStepsOf(WORKFLOW) });
  assert.equal(ran.length, 4, '--fresh judges every step again');
});

test('a build step killed or timed out records no verdict', async (t) => {
  const root = app(t, APP_FILES, APP_INSTALLS);
  const session = { ...createFakeSession({ files: APP_FILES }), root };
  const steps = parityStepsOf(WORKFLOW).filter((step) => step.name === 'build be');
  const run: ParityRun = async () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) });
  const result = await runParityFamilies(session, { repoRoot: root, families: new Set(['build']), env: { STARCI_CACHE_HOME: path.join(root, '.home') }, run, steps });
  assert.equal(result.findings[0]?.code, 'CI_PARITY_STEP_FAILED');
  assert.deepEqual(session.replaced.get(BUILD_FOLDER), []);
});

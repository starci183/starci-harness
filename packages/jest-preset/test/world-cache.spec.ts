import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// The specs load the BUILT dist, the way jest loads the runner.
const cache: typeof import('../src/world-cache.ts') = require('../dist/world-cache.js');

/** A repository: an app root with `.starcistacks`, a jest root `be/` with a tsconfig whose alias reaches a root package, three kinds of spec. */
function repo(): { root: string; be: string; put: (file: string, text: string) => string; inputs: () => import('../src/world-cache.ts').SpecInputs } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'world-cache-'));
  const be = path.join(root, 'be');
  const put = (file: string, text: string): string => {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, text);
    return absolute;
  };
  put('.starcistacks/application-stacks.yaml', 'components: {}\n');
  put('.starcistacks/dev/infra/compose/stack.yaml', 'services: {}\n');
  put('.starcistacks/dev/runtime/env/secret.env', 'KEY=sealed\n');
  put('package-lock.json', '{}\n');
  put('be/package.json', '{}\n');
  put('be/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@modules/*': ['src/modules/*'], '@pkg/*': ['../packages/*/src'] } } }));
  put('be/src/modules/orders/orders.service.ts', "import { shared } from '@pkg/shared'\nexport const orders = shared\n");
  put('be/src/modules/billing/billing.service.ts', 'export const billing = 1\n');
  put('packages/shared/src/index.ts', 'export const shared = 1\n');
  put('be/src/tests/world/test-world.config.ts', 'export default {}\n');
  put('be/src/tests/fixtures/builders/order.builder.ts', 'export const order = {}\n');
  put('be/src/tests/integration/orders/place.integration-spec.ts', "import { orders } from '@modules/orders/orders.service'\nimport { order } from '../../fixtures/builders/order.builder'\ntest('x', () => { expect([orders, order]).toBeDefined() })\n");
  put('be/src/tests/integration/orders/cancel.integration-spec.ts', "test('y', () => {})\n");
  return { root, be, put, inputs: () => new cache.SpecInputs(be, '@starci/jest-preset@9.9.9', require('typescript')) };
}

const spec = (be: string, name: string): string => path.join(be, 'src', 'tests', 'integration', 'orders', `${name}.integration-spec.ts`);

test('the key of a spec moves with its file, its import closure (through the tsconfig aliases and a package outside the jest root), the app source, the world, the lockfile and the stack definition, and with nothing else', () => {
  const { root, be, put, inputs } = repo();
  try {
    const base = inputs().of(spec(be, 'place'), 'integration');
    assert.deepEqual(Object.keys(base.parts).sort(), ['closure', 'lock', 'spec', 'stack', 'tree', 'versions', 'world']);
    assert.equal(inputs().of(spec(be, 'place'), 'integration').key, base.key, 'the same tree gives the same key');
    assert.notEqual(inputs().of(spec(be, 'place'), 'e2e').key, base.key, 'the kind is part of the key');
    const moved = (change: () => void, part: keyof typeof base.parts): void => {
      change();
      const next = inputs().of(spec(be, 'place'), 'integration');
      assert.notEqual(next.key, base.key, `${part} changes the key`);
      assert.deepEqual((Object.keys(next.parts) as (keyof typeof base.parts)[]).filter((name) => next.parts[name] !== base.parts[name]), [part]);
      put(...(undo.get(part) ?? ['x', '']));
    };
    const undo = new Map<keyof typeof base.parts, [string, string]>([
      ['spec', ['be/src/tests/integration/orders/place.integration-spec.ts', fs.readFileSync(spec(be, 'place'), 'utf8')]],
      ['closure', ['packages/shared/src/index.ts', 'export const shared = 1\n']],
      ['tree', ['be/src/modules/billing/billing.service.ts', 'export const billing = 1\n']],
      ['world', ['be/src/tests/world/test-world.config.ts', 'export default {}\n']],
      ['lock', ['package-lock.json', '{}\n']],
      ['stack', ['.starcistacks/dev/infra/compose/stack.yaml', 'services: {}\n']],
    ]);
    moved(() => put('be/src/tests/integration/orders/place.integration-spec.ts', `${fs.readFileSync(spec(be, 'place'), 'utf8')}// edited\n`), 'spec');
    moved(() => put('packages/shared/src/index.ts', 'export const shared = 2\n'), 'closure');
    moved(() => put('be/src/modules/billing/billing.service.ts', 'export const billing = 2\n'), 'tree');
    moved(() => put('be/src/tests/world/test-world.config.ts', 'export default { workers: 2 }\n'), 'world');
    moved(() => put('package-lock.json', '{ "lockfileVersion": 3 }\n'), 'lock');
    moved(() => put('.starcistacks/dev/infra/compose/stack.yaml', 'services: { db: {} }\n'), 'stack');
    // what is not an input leaves the key alone: another spec, a unit spec, a log, a report, a dot-folder, the sealed runtime of the stack, the cache itself
    for (const [file, text] of [
      ['be/src/tests/integration/orders/cancel.integration-spec.ts', "test('y', () => { expect(1).toBe(1) })\n"],
      ['be/src/modules/orders/orders.service.spec.ts', 'test("u", () => {})\n'],
      ['be/run.log', 'noise'],
      ['be/.jest-cache/x.json', '{}'],
      ['be/coverage/lcov.info', 'x'],
      ['.starcistacks/dev/runtime/env/secret.env', 'KEY=rotated\n'],
      ['.starcistacks/cache/test/integration/orders.jsonl', '{}\n'],
    ] as const) {
      put(file, text);
      assert.equal(inputs().of(spec(be, 'place'), 'integration').key, base.key, `${file} is no input of the spec`);
    }
    // the installed test-world and the preset are part of the key
    put('be/node_modules/@starci/test-world/package.json', JSON.stringify({ version: '2.1.0' }));
    const withWorld = inputs().of(spec(be, 'place'), 'integration').key;
    assert.notEqual(withWorld, base.key, 'an installed @starci/test-world is a version part');
    put('be/node_modules/@starci/test-world/package.json', JSON.stringify({ version: '2.2.0' }));
    assert.notEqual(inputs().of(spec(be, 'place'), 'integration').key, withWorld, 'a new @starci/test-world changes the key');
    assert.notEqual(new cache.SpecInputs(be, '@starci/jest-preset@9.9.10', require('typescript')).of(spec(be, 'place'), 'integration').key, withWorld, 'a new preset changes the key');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the import closure follows static, type-only, re-export, dynamic-literal and require imports and JSON, stops at node_modules and never loops', () => {
  const { root, be, put, inputs } = repo();
  try {
    put('be/src/tests/fixtures/a.ts', "import type { T } from './b'\nexport * from './c'\nexport const load = () => import('./d')\nconst e = require('./e')\nimport data from './data.json'\nimport { z } from 'zod'\nexport const a: T = [e, data, z]\n");
    put('be/src/tests/fixtures/b.ts', "import { a } from './a'\nexport type T = typeof a\n");
    put('be/src/tests/fixtures/c.ts', 'export const c = 1\n');
    put('be/src/tests/fixtures/d.ts', 'export const d = 1\n');
    put('be/src/tests/fixtures/e.js', 'module.exports = 1\n');
    put('be/src/tests/fixtures/data.json', '{}\n');
    put('be/node_modules/zod/index.js', 'module.exports = {}\n');
    put('be/node_modules/zod/package.json', '{"name":"zod","main":"index.js"}\n');
    const entry = put('be/src/tests/integration/orders/closure.integration-spec.ts', "import { a } from '../../fixtures/a'\ntest('z', () => expect(a).toBeDefined())\n");
    const closure = inputs().closureOf(entry).map((file) => path.relative(be, file).split(path.sep).join('/'));
    assert.deepEqual(closure, ['src/tests/fixtures/a.ts', 'src/tests/fixtures/b.ts', 'src/tests/fixtures/c.ts', 'src/tests/fixtures/d.ts', 'src/tests/fixtures/data.json', 'src/tests/fixtures/e.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a spec without typescript in the app has an empty closure and the tree still keys it', () => {
  const { root, be, inputs } = repo();
  try {
    const noCompiler = new cache.SpecInputs(be, 'p', null);
    assert.deepEqual(noCompiler.closureOf(spec(be, 'place')), []);
    assert.equal(typeof noCompiler.of(spec(be, 'place'), 'integration').key, 'string');
    assert.notEqual(noCompiler.of(spec(be, 'place'), 'integration').key, inputs().of(spec(be, 'place'), 'integration').key);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the cache decides, records and forgets: new runs, unchanged is cached with its duration, changed names its parts, red removes the record', () => {
  const { root, be, put, inputs } = repo();
  try {
    const mode = { full: false, named: false, partial: false };
    const place = spec(be, 'place');
    const fresh = new cache.SpecCache(inputs(), mode);
    const first = fresh.plan(place, 'integration');
    assert.deepEqual([first.run, first.run ? first.why : ''], [true, 'new or previously red']);
    fresh.green(first, 1234.4);
    const file = path.join(root, '.starcistacks', 'cache', 'test', 'integration', 'orders.jsonl');
    const stored: { spec: string; ms: number; result: string }[] = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(stored.map(({ spec: name, ms, result }) => ({ name, ms, result })), [{ name: 'be/src/tests/integration/orders/place.integration-spec.ts', ms: 1234, result: 'passed' }]);
    const again = new cache.SpecCache(inputs(), mode).plan(place, 'integration');
    assert.equal(again.run, false);
    assert.equal(again.run ? 0 : again.record.ms, 1234);
    put('be/src/modules/orders/orders.service.ts', 'export const orders = 3\n');
    const changed = new cache.SpecCache(inputs(), mode).plan(place, 'integration');
    assert.deepEqual([changed.run, changed.run ? changed.why : ''], [true, 'changed: closure, tree']);
    const cancel = new cache.SpecCache(inputs(), mode);
    cancel.green(cancel.plan(spec(be, 'cancel'), 'integration'), 10);
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2, 'two specs of one area share a file, one line each');
    const redo = new cache.SpecCache(inputs(), { ...mode, full: true });
    redo.red(redo.plan(spec(be, 'cancel'), 'integration'));
    assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { spec: string }).spec), ['be/src/tests/integration/orders/place.integration-spec.ts']);
    const last = new cache.SpecCache(inputs(), { ...mode, full: true });
    last.red(last.plan(place, 'integration'));
    assert.equal(fs.existsSync(file), false, 'the last record of an area takes its file with it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--full and a named spec run regardless and still record; a name-filtered run records nothing; a live-provider spec is never cached; no app root means no cache', () => {
  const { root, be, put, inputs } = repo();
  try {
    const place = spec(be, 'place');
    const warm = new cache.SpecCache(inputs(), { full: false, named: false, partial: false });
    warm.green(warm.plan(place, 'integration'), 5);
    for (const [mode, why] of [[{ full: true, named: false, partial: false }, 'full run'], [{ full: false, named: true, partial: false }, 'named on the command line']] as const) {
      const plan = new cache.SpecCache(inputs(), mode).plan(place, 'integration');
      assert.deepEqual([plan.run, plan.run ? plan.why : '', plan.run ? plan.write : false], [true, why, true]);
    }
    const partial = new cache.SpecCache(inputs(), { full: false, named: true, partial: true });
    const plan = partial.plan(place, 'integration');
    assert.equal(plan.run && plan.write, false);
    const file = path.join(root, '.starcistacks', 'cache', 'test', 'integration', 'orders.jsonl');
    const before = fs.readFileSync(file, 'utf8');
    partial.green(plan, 1);
    partial.red(plan);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a partial run neither records nor forgets');
    const live = put('be/src/tests/integration/orders/live.integration-spec.ts', "const sandbox = useSandbox('stripe')\n");
    const sandboxed = new cache.SpecCache(inputs(), { full: false, named: false, partial: false }).plan(live, 'integration');
    assert.deepEqual([sandboxed.run, sandboxed.run ? sandboxed.why : ''], [true, 'live provider (useSandbox), never cached']);
    const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'world-cache-bare-'));
    try {
      fs.mkdirSync(path.join(lone, 'src'), { recursive: true });
      const bare = new cache.SpecCache(new cache.SpecInputs(lone, 'p'), { full: false, named: false, partial: false });
      assert.equal(bare.available, false);
      const bareSpec = path.join(lone, 'src', 'a.integration-spec.ts');
      fs.writeFileSync(bareSpec, '');
      const bareRun = bare.plan(bareSpec, 'integration');
      assert.equal(bareRun.run && bareRun.write, false);
    } finally {
      fs.rmSync(lone, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('records are portable and merge-safe: CRLF and LF hash alike, keys are sorted, lines are sorted by spec, torn lines are dropped', () => {
  assert.equal(cache.hashBytes(Buffer.from('a\r\nb\r\n')), cache.hashBytes(Buffer.from('a\nb\n')));
  assert.notEqual(cache.hashBytes(Buffer.from([0, 13, 10])), cache.hashBytes(Buffer.from([0, 10])), 'a binary file is hashed as it is');
  assert.equal(cache.combine({ a: '1', b: '2' }), cache.combine({ b: '2', a: '1' }));
  assert.notEqual(cache.combine({ a: '12' }), cache.combine({ a: '1', 2: '' }));
  const { root, be, inputs } = repo();
  try {
    const mode = { full: false, named: false, partial: false };
    const writer = new cache.SpecCache(inputs(), mode);
    for (const name of ['place', 'cancel']) writer.green(writer.plan(spec(be, name), 'integration'), 7);
    const file = cache.recordFile(root, 'integration', 'be/src/tests/integration/orders/place.integration-spec.ts');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as { spec: string }).spec), ['be/src/tests/integration/orders/cancel.integration-spec.ts', 'be/src/tests/integration/orders/place.integration-spec.ts']);
    for (const line of lines) assert.deepEqual(Object.keys(JSON.parse(line) as object), ['key', 'ms', 'parts', 'result', 'spec']);
    fs.appendFileSync(file, '{"torn": \n');
    assert.equal(cache.readRecords(file).length, 2);
    assert.equal(path.basename(cache.recordFile(root, 'e2e', 'be/src/tests/e2e/flow.e2e-spec.ts')), 'root.jsonl', 'a spec directly under the kind folder is in root.jsonl');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the report lines and the summary', () => {
  assert.deepEqual([850, 4200, 125_000, 59_999].map(cache.duration), ['850ms', '4.2s', '2m05s', '60.0s']);
  const lines = [
    { spec: 'be/a.e2e-spec.ts', kind: 'e2e', outcome: 'cached' as const, ms: 4200, why: '' },
    { spec: 'be/b.e2e-spec.ts', kind: 'e2e', outcome: 'ran' as const, ms: 2000, why: 'changed: spec' },
    { spec: 'be/c.e2e-spec.ts', kind: 'e2e', outcome: 'failed' as const, ms: 1000, why: 'new or previously red' },
  ];
  assert.deepEqual(lines.map(cache.reportLine), [
    '  cached  be/a.e2e-spec.ts  (green before in 4.2s)',
    '  ran     be/b.e2e-spec.ts  (2.0s, changed: spec)',
    '  FAILED  be/c.e2e-spec.ts  (1.0s, new or previously red)',
  ]);
  assert.equal(cache.summary(lines), 'starci test: 3 spec file(s), 1 ran, 1 cached, 1 failed; 3.0s spent, 4.2s saved by the cache');
});

test('the preflight answers for a whole kind before any jest process: every spec cached means nothing needs to start', () => {
  const { root, be, put } = repo();
  try {
    assert.deepEqual(cache.listSpecs(be, 'integration').map((file) => path.basename(file)), ['cancel.integration-spec.ts', 'place.integration-spec.ts']);
    assert.deepEqual(cache.listSpecs(be, 'contract'), []);
    const cold = cache.preflight(be, 'integration');
    assert.deepEqual([cold.specs, cold.cached, cold.allCached], [2, 0, false]);
    const mode = { full: false, named: false, partial: false };
    const warm = new cache.SpecCache(new cache.SpecInputs(be, cache.PRESET_ID, require('typescript')), mode);
    for (const name of ['place', 'cancel']) warm.green(warm.plan(spec(be, name), 'integration'), 40);
    // the preflight reads the typescript of the app, which the temporary repository does not have: give it the same closure by keying without one
    const withoutCompiler = new cache.SpecCache(new cache.SpecInputs(be, cache.PRESET_ID, null), mode);
    for (const name of ['place', 'cancel']) withoutCompiler.green(withoutCompiler.plan(spec(be, name), 'integration'), 40);
    const hot = cache.preflight(be, 'integration');
    assert.deepEqual([hot.specs, hot.cached, hot.allCached], [2, 2, true]);
    assert.deepEqual(hot.lines.map((line) => [line.spec, line.outcome, line.ms]), [
      ['be/src/tests/integration/orders/cancel.integration-spec.ts', 'cached', 40],
      ['be/src/tests/integration/orders/place.integration-spec.ts', 'cached', 40],
    ]);
    put('be/src/modules/billing/billing.service.ts', 'export const billing = 9\n');
    assert.deepEqual([cache.preflight(be, 'integration').cached, cache.preflight(be, 'integration').allCached], [0, false], 'a changed tree leaves nothing cached');
    assert.equal(cache.preflight(be, 'contract').allCached, false, 'a kind with no cache and a kind with no spec never skip a run');
    assert.equal(cache.preflight(be, 'e2e').allCached, false, 'no spec of the kind is not a cached run');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a spec declares itself exclusive with `exclusive: true` in its useTestWorld call, and nowhere else', () => {
  const { root, be, put } = repo();
  try {
    const of = (text: string): boolean => cache.isExclusive(put('be/src/tests/e2e/flow/x.e2e-spec.ts', text));
    assert.equal(of("const world = useTestWorld({ apps: ['api'], exclusive: true })\n"), true);
    assert.equal(of("const world = useTestWorld<Names>({\n  apps: { api: { options: (w) => ({ url: w.db.primary.url }) } },\n  testTimeoutMs: 30_000,\n  exclusive: true,\n})\n"), true);
    assert.equal(of("const world = useTestWorld({ apps: ['api'] })\n"), false);
    assert.equal(of("const world = useTestWorld({ apps: ['api'], exclusive: false })\n"), false);
    assert.equal(of("const options = { exclusive: true }\n"), false, 'a literal outside a useTestWorld call is no marker');
    assert.equal(cache.isExclusive(path.join(be, 'missing.e2e-spec.ts')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

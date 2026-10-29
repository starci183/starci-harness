import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The specs load the BUILT dist, the way jest loads the preset.
const kit: typeof import('../src/query-builder.ts') = require('../dist/query-builder.js');
const preset: typeof import('../src/index.ts') = require('../dist/index.js');

/** The slice of a typeorm builder these specs chain. */
interface Chain {
  where(text: string, params: object): Chain
  andWhere(text: string, params: object): Chain
  take(count: number): Chain
  getMany(): Promise<unknown>
  getCount(): Promise<unknown>
  execute(): Promise<unknown>
  readonly then?: unknown
}

test('the preset entry and the ./query-builder subpath export the same doubles', () => {
  assert.equal(preset.fakeQueryBuilder, kit.fakeQueryBuilder);
  assert.equal(preset.queueQueryBuilders, kit.queueQueryBuilders);
});

test('fakeQueryBuilder chains every method, records the calls and resolves the terminal answer', async () => {
  const fake = kit.fakeQueryBuilder({ getMany: [{ id: 'a' }], getCount: () => 2 });
  const chain = fake.builder as Chain;
  const rows = await chain.where('o.status = :status', { status: 'open' }).andWhere('o.ownerId = :owner', { owner: 'u1' }).take(50).getMany();
  assert.deepEqual(rows, [{ id: 'a' }]);
  assert.equal(await chain.getCount(), 2);
  assert.deepEqual(fake.calls.map((call) => call.method), ['where', 'andWhere', 'take', 'getMany', 'getCount']);
  assert.deepEqual(fake.callsOf('where'), [['o.status = :status', { status: 'open' }]]);
});

test('an unanswered terminal resolves undefined, and the builder is not a thenable', async () => {
  const fake = kit.fakeQueryBuilder();
  const chain = fake.builder as Chain;
  assert.equal(chain.then, undefined);
  assert.equal(await chain.execute(), undefined);
});

test('queueQueryBuilders hands out one fake per answer in createQueryBuilder call order', () => {
  const queued: unknown[] = [];
  const manager = { createQueryBuilder: { mockReturnValueOnce: (value: never) => { queued.push(value); return manager.createQueryBuilder; } } };
  const fakes = kit.queueQueryBuilders(manager, [{ getOne: { id: 'a' } }, { execute: { affected: 1 } }]);
  assert.equal(fakes.length, 2);
  assert.deepEqual(queued, fakes.map((fake) => fake.builder));
});

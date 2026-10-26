import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fakeInbox } = require('./inbox.cjs');
const { FakeClock } = require('./clock.cjs');
const { createEntityManagerKit } = require('./entity-manager.cjs');
const { fakeTransaction, mockEntityManager } = createEntityManagerKit((implementation) => implementation);
const request = (overrides = {}) => ({
  principalId: 'person-1', operation: 'checkout.place', idempotencyKey: 'key-1',
  request: { items: [{ productId: 'tea', quantity: 2 }], delivery: { city: 'Hue', street: 'Main' } },
  ...overrides,
});
const codeIs = (code) => (error) => error.code === code;

test('fakeTransaction exposes an active queryRunner only until its transaction settles', async () => {
  const tx = fakeTransaction(mockEntityManager());
  let committed;
  await tx.em.transaction(async (manager) => {
    committed = manager;
    assert.equal(manager.queryRunner.isTransactionActive, true);
    assert.equal(await manager.transaction(async (nested) => nested.queryRunner.isTransactionActive), true);
  });
  assert.equal(committed.queryRunner.isTransactionActive, false);
  let rolledBack;
  await assert.rejects(tx.em.transaction(async (manager) => {
    rolledBack = manager;
    assert.equal(manager.queryRunner.isTransactionActive, true);
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(rolledBack.queryRunner.isTransactionActive, false);
});

test('fakeInbox client calls replay the stored JSON outcome and record the domain transaction', async () => {
  const inbox = fakeInbox();
  const tx = fakeTransaction(mockEntityManager());
  let effects = 0;
  const first = await tx.em.transaction((manager) => inbox.runClient(request(), manager, async () => {
    effects += 1;
    return { kind: 'ok', value: { orderId: 'order-1' } };
  }));
  first.value.orderId = 'caller-mutation';
  const repeat = await tx.em.transaction((manager) => inbox.runClient(request({
    request: { delivery: { street: 'Main', city: 'Hue' }, items: [{ quantity: 2, productId: 'tea' }] },
  }), manager, async () => { throw new Error('repeat executed'); }));

  assert.deepEqual(repeat, { kind: 'ok', value: { orderId: 'order-1' } });
  assert.equal(effects, 1);
  assert.deepEqual(inbox.claimed, [{ source: 'client:person-1:checkout.place', eventId: 'key-1' }]);
  assert.equal(inbox.clientEntries.length, 2);
  assert.equal(inbox.clientEntries.every((entry) => entry.inTransaction), true);
  assert.equal(tx.commits, 2);
});

test('fakeInbox client calls retain expected refusals as outcomes', async () => {
  const inbox = fakeInbox();
  const refused = { kind: 'refused', code: 'ORDER_STOCK_LOW', params: { productId: 'tea' } };
  assert.deepEqual(await inbox.runClient(request(), {}, async () => refused), refused);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => null), refused);
  assert.equal(inbox.clientEntries[0].inTransaction, false);
});

test('fakeInbox refuses a reused client key with a different body, while principals and operations have separate namespaces', async () => {
  const inbox = fakeInbox();
  await inbox.runClient(request(), {}, async () => ({ orderId: 'first' }));
  await assert.rejects(inbox.runClient(request({ request: { items: [] } }), {}, async () => ({ orderId: 'wrong' })), codeIs('IDEMPOTENCY_KEY_REUSED'));
  assert.deepEqual(await inbox.runClient(request({ principalId: 'person-2' }), {}, async () => ({ orderId: 'other-person' })), { orderId: 'other-person' });
  assert.deepEqual(await inbox.runClient(request({ operation: 'checkout.cancel' }), {}, async () => ({ cancelled: true })), { cancelled: true });
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'wrong' })), { orderId: 'first' });
});

test('fakeInbox serializes concurrent repeats and refuses a changed body while the first effect is pending', async () => {
  const inbox = fakeInbox();
  let finish;
  let effects = 0;
  const first = inbox.runClient(request(), {}, async () => {
    effects += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  const repeat = inbox.runClient(request(), {}, async () => { effects += 1; return { orderId: 'wrong' }; });
  await assert.rejects(inbox.runClient(request({ request: { changed: true } }), {}, async () => null), codeIs('IDEMPOTENCY_KEY_REUSED'));
  finish({ orderId: 'one' });
  assert.deepEqual(await Promise.all([first, repeat]), [{ orderId: 'one' }, { orderId: 'one' }]);
  assert.equal(effects, 1);
});

test('fakeInbox failed client effects give back their claim for a retry', async () => {
  const inbox = fakeInbox();
  const failure = new Error('write failed');
  await assert.rejects(inbox.runClient(request(), {}, async () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(inbox.claimed, []);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'retry' })), { orderId: 'retry' });
});

test('fakeInbox rejects non-JSON requests and outcomes without retaining a failed claim', async () => {
  const inbox = fakeInbox();
  const cycle = {};
  cycle.self = cycle;
  for (const body of [undefined, { nested: undefined }, Infinity, 1n, () => {}, Symbol('body'), cycle]) {
    await assert.rejects(inbox.runClient(request({ request: body }), {}, async () => null), codeIs('IDEMPOTENCY_REQUEST_INVALID'));
  }
  for (const outcome of [undefined, { nested: undefined }, cycle]) {
    await assert.rejects(inbox.runClient(request(), {}, async () => outcome), codeIs('INBOX_OUTCOME_INVALID'));
    assert.deepEqual(inbox.claimed, []);
  }
  assert.deepEqual(await inbox.runClient(request(), {}, async () => null), null);
});

test('fakeInbox rejects dates, maps, sets, class instances and sparse arrays on both JSON boundaries', async () => {
  const inbox = fakeInbox();
  class RequestBody { constructor() { this.quantity = 2; } }
  const sparse = new Array(1);
  const nonJson = [new Date(0), new Map([['quantity', 2]]), new Set([2]), new RequestBody(), sparse, { toJSON() { return {}; } }];
  for (const value of nonJson) {
    await assert.rejects(inbox.runClient(request({ request: { nested: value } }), {}, async () => null), codeIs('IDEMPOTENCY_REQUEST_INVALID'));
    await assert.rejects(inbox.runClient(request(), {}, async () => ({ nested: value })), codeIs('INBOX_OUTCOME_INVALID'));
    assert.deepEqual(inbox.claimed, []);
  }
});

test('fakeInbox permits null-prototype JSON records and repeated references that are not cycles', async () => {
  const inbox = fakeInbox();
  const shared = Object.assign(Object.create(null), { quantity: 2 });
  const first = await inbox.runClient(request({ request: { first: shared, second: shared } }), {}, async () => shared);
  const repeat = await inbox.runClient(request({ request: { second: { quantity: 2 }, first: { quantity: 2 } } }), {}, async () => null);
  assert.deepEqual(first, { quantity: 2 });
  assert.deepEqual(repeat, first);
});

test('fakeInbox ignores non-enumerable toJSON methods when comparing requests and retaining outcomes', async () => {
  const inbox = fakeInbox();
  let conversions = 0;
  const line = { quantity: 2 };
  Object.defineProperty(line, 'toJSON', { value: () => { conversions += 1; return { quantity: 99 }; } });
  const items = [line];
  Object.defineProperty(items, 'toJSON', { value: () => { conversions += 1; return []; } });
  const first = await inbox.runClient(request({ request: { items } }), {}, async () => ({ items, zero: -0 }));
  const repeated = await inbox.runClient(request({ request: { items: [{ quantity: 2 }] } }), {}, async () => null);

  assert.deepEqual(first, { items: [{ quantity: 2 }], zero: 0 });
  assert.deepEqual(repeated, first);
  assert.equal(conversions, 0);
});

test('fakeInbox rejects ambiguous namespaces and invalid keys, preserving exact valid keys', async () => {
  const inbox = fakeInbox();
  for (const invalid of [
    { principalId: '' }, { principalId: '  ' }, { principalId: 'person:1' },
    { operation: '' }, { operation: '  ' }, { operation: 'checkout:place' },
    { idempotencyKey: '' }, { idempotencyKey: '  ' }, { idempotencyKey: 'k'.repeat(65) },
  ]) {
    await assert.rejects(inbox.runClient(request(invalid), {}, async () => null), codeIs('IDEMPOTENCY_REQUEST_INVALID'));
  }
  await inbox.runClient(request({ idempotencyKey: ' key-1 ' }), {}, async () => null);
  await inbox.runClient(request(), {}, async () => null);
  assert.deepEqual(inbox.claimed.map((entry) => entry.eventId), [' key-1 ', 'key-1']);
});

test('fakeInbox client claims share the delivery table and release preserves client outcomes', async () => {
  const inbox = fakeInbox();
  const source = 'client:person-1:checkout.place';
  inbox.seen(source, 'key-1');
  await assert.rejects(inbox.runClient(request(), {}, async () => null), codeIs('IDEMPOTENCY_KEY_REUSED'));
  await inbox.release(source, 'key-1');
  await inbox.runClient(request(), {}, async () => ({ orderId: 'first' }));
  assert.equal(await inbox.claim(source, 'key-1'), false);
  await inbox.release(source, 'key-1');
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'after-release' })), { orderId: 'first' });
});

test('fakeInbox sweeps only completed expired client claims in one bounded batch', async () => {
  const clock = new FakeClock('2026-01-01T00:00:00Z');
  const inbox = fakeInbox(clock);
  await inbox.claim('payments', 'delivery-1');
  await inbox.runClient(request(), {}, async () => ({ orderId: 'expired' }));
  const cutoff = clock.now();
  clock.advance(1);
  let finish;
  const pending = inbox.runClient(request({ idempotencyKey: 'pending' }), {}, () => new Promise((resolve) => { finish = resolve; }));
  await inbox.runClient(request({ idempotencyKey: 'recent' }), {}, async () => null);
  assert.equal(await inbox.sweepClients(cutoff, {}), 0, 'the retention boundary is strict');
  clock.advance(1);
  assert.equal(await inbox.sweepClients(clock.now(), {}), 2);
  assert.equal(await inbox.claim('payments', 'delivery-1'), false, 'delivery dedupe is retained');
  finish({ orderId: 'pending-complete' });
  await pending;
  assert.equal(await inbox.sweepClients(clock.now(), {}), 1);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'after-expiry' })), { orderId: 'after-expiry' });
  for (let index = 0; index < 501; index += 1) {
    await inbox.runClient(request({ idempotencyKey: `batch-${index}` }), {}, async () => null);
  }
  clock.advance(1);
  assert.equal(await inbox.sweepClients(clock.now(), {}), 500);
  assert.equal(await inbox.sweepClients(clock.now(), {}), 2);
});

test('fakeInbox records retention attempts and their transaction on success or failure', async () => {
  const inbox = fakeInbox();
  const tx = fakeTransaction(mockEntityManager());
  const cutoff = new Date('2026-02-03T04:05:06Z');
  const failure = new Error('retention failed');
  inbox.failNext('sweepClients', failure);
  let failedManager;
  await assert.rejects(tx.em.transaction(async (manager) => {
    failedManager = manager;
    await inbox.sweepClients(cutoff, manager);
  }), (error) => error === failure);
  assert.deepEqual(inbox.sweeps[0], { cutoff, tx: failedManager, inTransaction: true });

  let usedManager;
  await tx.em.transaction(async (manager) => {
    usedManager = manager;
    assert.equal(await inbox.sweepClients(cutoff, manager), 0);
  });
  const retainedInstant = new Date(cutoff);
  cutoff.setTime(0);
  assert.deepEqual(inbox.sweeps[1], { cutoff: retainedInstant, tx: usedManager, inTransaction: true });
  await inbox.sweepClients(cutoff, tx.em);
  assert.equal(inbox.sweeps[2].inTransaction, false);
  inbox.clear();
  assert.deepEqual(inbox.sweeps, []);
});

test('fakeInbox scripts client failures once and clear removes outcomes, entries and failures', async () => {
  const inbox = fakeInbox();
  const failure = new Error('database down');
  inbox.failNext('runClient', failure);
  await assert.rejects(inbox.runClient(request(), {}, async () => null), (error) => error === failure);
  await inbox.runClient(request(), {}, async () => null);
  inbox.failNext('sweepClients', failure);
  await assert.rejects(inbox.sweepClients(new Date(1), {}), (error) => error === failure);
  assert.equal(await inbox.sweepClients(new Date(1), {}), 1);
  await inbox.runClient(request(), {}, async () => ({ orderId: 'before-clear' }));
  inbox.failNext('runClient', failure);
  inbox.clear();
  assert.deepEqual([inbox.claims, inbox.claimed, inbox.clientEntries, inbox.sweeps], [[], [], [], []]);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'after-clear' })), { orderId: 'after-clear' });
});

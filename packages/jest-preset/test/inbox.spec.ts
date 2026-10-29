import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { EntityManager } from 'typeorm';
import type { InboxClientOperation } from '../src/inbox.ts';

const require = createRequire(import.meta.url);
const { fakeInbox }: typeof import('../src/inbox.ts') = require('../dist/inbox.js');
const { FakeClock }: typeof import('../src/clock.ts') = require('../dist/clock.js');
const { createEntityManagerKit }: typeof import('../src/entity-manager.ts') = require('../dist/entity-manager.js');
const { fakeTransaction, mockEntityManager } = createEntityManagerKit((implementation) => implementation);
const request = (overrides: Partial<InboxClientOperation> = {}): InboxClientOperation => ({
  principalId: 'person-1', operation: 'checkout.place', idempotencyKey: 'key-1',
  request: { items: [{ productId: 'tea', quantity: 2 }], delivery: { city: 'Hue', street: 'Main' } },
  ...overrides,
});
const codeIs = (code: string) => (error: unknown): boolean => error instanceof Error && Reflect.get(error, 'code') === code;

/** A promise settled from outside, for an effect the spec keeps pending. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const resolvers: Array<(value: T) => void> = [];
  const promise = new Promise<T>((resolve) => { resolvers.push(resolve); });
  return { promise, resolve: (value) => { for (const resolve of resolvers) resolve(value); } };
}

test('fakeTransaction exposes an active queryRunner only until its transaction settles', async () => {
  const tx = fakeTransaction(mockEntityManager());
  const committed: EntityManager[] = [];
  await tx.em.transaction(async (manager) => {
    committed.push(manager);
    assert.equal(manager.queryRunner?.isTransactionActive, true);
    assert.equal(await manager.transaction(async (nested) => nested.queryRunner?.isTransactionActive), true);
  });
  assert.equal(committed[0]?.queryRunner?.isTransactionActive, false);
  const rolledBack: EntityManager[] = [];
  await assert.rejects(tx.em.transaction(async (manager) => {
    rolledBack.push(manager);
    assert.equal(manager.queryRunner?.isTransactionActive, true);
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(rolledBack[0]?.queryRunner?.isTransactionActive, false);
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
  assert.equal(inbox.clientEntries[0]?.inTransaction, false);
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
  const gate = deferred<unknown>();
  let effects = 0;
  const first = inbox.runClient(request(), {}, async () => {
    effects += 1;
    return gate.promise;
  });
  const repeat = inbox.runClient(request(), {}, async () => { effects += 1; return { orderId: 'wrong' }; });
  await assert.rejects(inbox.runClient(request({ request: { changed: true } }), {}, async () => null), codeIs('IDEMPOTENCY_KEY_REUSED'));
  gate.resolve({ orderId: 'one' });
  assert.deepEqual(await Promise.all([first, repeat]), [{ orderId: 'one' }, { orderId: 'one' }]);
  assert.equal(effects, 1);
});

test('fakeInbox failed client effects give back their claim for a retry', async () => {
  const inbox = fakeInbox();
  const failure = new Error('write failed');
  await assert.rejects(inbox.runClient(request(), {}, async () => { throw failure; }), (error: unknown) => error === failure);
  assert.deepEqual(inbox.claimed, []);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'retry' })), { orderId: 'retry' });
});

test('fakeInbox rejects non-JSON requests and outcomes without retaining a failed claim', async () => {
  const inbox = fakeInbox();
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const bodies: unknown[] = [undefined, { nested: undefined }, Infinity, 1n, () => {}, Symbol('body'), cycle];
  for (const body of bodies) {
    await assert.rejects(inbox.runClient(request({ request: body }), {}, async () => null), codeIs('IDEMPOTENCY_REQUEST_INVALID'));
  }
  const outcomes: unknown[] = [undefined, { nested: undefined }, cycle];
  for (const outcome of outcomes) {
    await assert.rejects(inbox.runClient(request(), {}, async () => outcome), codeIs('INBOX_OUTCOME_INVALID'));
    assert.deepEqual(inbox.claimed, []);
  }
  assert.deepEqual(await inbox.runClient(request(), {}, async () => null), null);
});

test('fakeInbox rejects dates, maps, sets, class instances and sparse arrays on both JSON boundaries', async () => {
  const inbox = fakeInbox();
  class RequestBody { quantity = 2; }
  const sparse = new Array<unknown>(1);
  const nonJson: unknown[] = [new Date(0), new Map([['quantity', 2]]), new Set([2]), new RequestBody(), sparse, { toJSON() { return {}; } }];
  for (const value of nonJson) {
    await assert.rejects(inbox.runClient(request({ request: { nested: value } }), {}, async () => null), codeIs('IDEMPOTENCY_REQUEST_INVALID'));
    await assert.rejects(inbox.runClient(request(), {}, async () => ({ nested: value })), codeIs('INBOX_OUTCOME_INVALID'));
    assert.deepEqual(inbox.claimed, []);
  }
});

test('fakeInbox permits null-prototype JSON records and repeated references that are not cycles', async () => {
  const inbox = fakeInbox();
  const shared = Object.assign(Object.create(null) as object, { quantity: 2 });
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
  const invalids: Array<Partial<InboxClientOperation>> = [
    { principalId: '' }, { principalId: '  ' }, { principalId: 'person:1' },
    { operation: '' }, { operation: '  ' }, { operation: 'checkout:place' },
    { idempotencyKey: '' }, { idempotencyKey: '  ' }, { idempotencyKey: 'k'.repeat(65) },
  ];
  for (const invalid of invalids) {
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
  const gate = deferred<unknown>();
  const pending = inbox.runClient(request({ idempotencyKey: 'pending' }), {}, () => gate.promise);
  await inbox.runClient(request({ idempotencyKey: 'recent' }), {}, async () => null);
  assert.equal(await inbox.sweepClients(cutoff, {}), 0, 'the retention boundary is strict');
  clock.advance(1);
  assert.equal(await inbox.sweepClients(clock.now(), {}), 2);
  assert.equal(await inbox.claim('payments', 'delivery-1'), false, 'delivery dedupe is retained');
  gate.resolve({ orderId: 'pending-complete' });
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
  const failedManager: EntityManager[] = [];
  await assert.rejects(tx.em.transaction(async (manager) => {
    failedManager.push(manager);
    await inbox.sweepClients(cutoff, manager);
  }), (error: unknown) => error === failure);
  assert.deepEqual(inbox.sweeps[0], { cutoff, tx: failedManager[0], inTransaction: true });

  const usedManager: EntityManager[] = [];
  await tx.em.transaction(async (manager) => {
    usedManager.push(manager);
    assert.equal(await inbox.sweepClients(cutoff, manager), 0);
  });
  const retainedInstant = new Date(cutoff);
  cutoff.setTime(0);
  assert.deepEqual(inbox.sweeps[1], { cutoff: retainedInstant, tx: usedManager[0], inTransaction: true });
  await inbox.sweepClients(cutoff, tx.em);
  assert.equal(inbox.sweeps[2]?.inTransaction, false);
  inbox.clear();
  assert.deepEqual(inbox.sweeps, []);
});

test('fakeInbox scripts client failures once and clear removes outcomes, entries and failures', async () => {
  const inbox = fakeInbox();
  const failure = new Error('database down');
  inbox.failNext('runClient', failure);
  await assert.rejects(inbox.runClient(request(), {}, async () => null), (error: unknown) => error === failure);
  await inbox.runClient(request(), {}, async () => null);
  inbox.failNext('sweepClients', failure);
  await assert.rejects(inbox.sweepClients(new Date(1), {}), (error: unknown) => error === failure);
  assert.equal(await inbox.sweepClients(new Date(1), {}), 1);
  await inbox.runClient(request(), {}, async () => ({ orderId: 'before-clear' }));
  inbox.failNext('runClient', failure);
  inbox.clear();
  assert.deepEqual([inbox.claims, inbox.claimed, inbox.clientEntries, inbox.sweeps], [[], [], [], []]);
  assert.deepEqual(await inbox.runClient(request(), {}, async () => ({ orderId: 'after-clear' })), { orderId: 'after-clear' });
});

class ReceiptEntity { id = ''; deliveryId = '' }
const receipt = { entity: ReceiptEntity, row: (deliveryId: string) => ({ deliveryId }) };

test('fakeInbox claimRow inserts the receipt row only for the winning claim, in the caller transaction', async () => {
  const inbox = fakeInbox();
  const tx = fakeTransaction(mockEntityManager());
  const managers: EntityManager[] = [];
  const answers = await tx.em.transaction(async (manager) => {
    managers.push(manager);
    return [
      await inbox.claimRow('webhook.spec', '  delivery-1  ', manager, receipt),
      await inbox.claimRow('webhook.spec', 'delivery-1', manager, receipt),
    ];
  });
  assert.deepEqual(answers, ['receipt-1', undefined]);
  assert.deepEqual(inbox.claims, [{ source: 'webhook.spec', eventId: 'delivery-1' }, { source: 'webhook.spec', eventId: 'delivery-1' }]);
  assert.deepEqual(inbox.receipts, [{
    id: 'receipt-1', source: 'webhook.spec', eventId: 'delivery-1', entity: ReceiptEntity, row: { deliveryId: 'delivery-1' },
    tx: managers[0], inTransaction: true,
  }]);
  assert.equal(await inbox.claimRow('webhook.spec', 'delivery-2', tx.em, receipt), 'receipt-2');
  assert.equal(inbox.receipts[1]?.inTransaction, false);
});

test('fakeInbox claimRow answers undefined for a redelivery or an existing receipt and refuses a missing delivery id', async () => {
  const inbox = fakeInbox();
  inbox.seen('webhook.spec', 'delivery-1');
  assert.equal(await inbox.claimRow('webhook.spec', 'delivery-1', {}, receipt), undefined);
  inbox.receiptExists('webhook.spec', 'delivery-2');
  assert.equal(await inbox.claimRow('webhook.spec', 'delivery-2', {}, receipt), undefined);
  assert.deepEqual(inbox.claimed.map((entry) => entry.eventId).sort(), ['delivery-1', 'delivery-2']);
  assert.deepEqual(inbox.receipts, []);
  for (const eventId of [undefined, '   ']) {
    await assert.rejects(inbox.claimRow('webhook.spec', eventId, {}, receipt), codeIs('DATABASE_WEBHOOK_DELIVERY_ID_REQUIRED'));
  }
  assert.equal(inbox.claims.length, 2);
  const failure = new Error('database down');
  inbox.failNext('claimRow', failure);
  await assert.rejects(inbox.claimRow('webhook.spec', 'delivery-3', {}, receipt), (error: unknown) => error === failure);
  assert.equal(await inbox.claimRow('webhook.spec', 'delivery-3', {}, receipt), 'receipt-1');
  inbox.clear();
  assert.deepEqual([inbox.receipts, inbox.claims], [[], []]);
  assert.equal(await inbox.claimRow('webhook.spec', 'delivery-2', {}, receipt), 'receipt-1');
});

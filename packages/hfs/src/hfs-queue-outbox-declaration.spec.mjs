// proves: DB_CRON_OWNED@lite DB_CRON_OWNED@full
// R258: the app's own queue outbox is a declaration of hfs.json (sides.be.queueOutbox: table, enqueue, queueParameter). It is valid only on the
// be side and only beside a declared redis backing; the declaration shape refuses anything else, in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';

const OUTBOX = { table: 'public.job_outbox', enqueue: 'public.job_enqueue', queueParameter: 'p_queue' };
const declaration = (edition, be = {}, fe = {}) => ({
  hfs: 3, kind: 'app', project: 'demo', edition,
  sides: { be: { apps: [{ name: 'api', kind: 'api' }], ...be }, fe: { apps: [{ name: 'web', kind: 'next' }], ...fe } },
});
const problems = (edition, be, fe) => declarationShapeProblems(declaration(edition, be, fe), ['be', 'fe']);

for (const edition of ['lite', 'full']) {
  test(`${edition}: sides.be.queueOutbox beside a redis backing is a valid declaration`, () => {
    assert.deepEqual(problems(edition, { backing: ['redis'], queueOutbox: OUTBOX }), []);
    assert.deepEqual(problems(edition, { backing: ['redis'] }), []);
    assert.deepEqual(problems(edition, {}), []);
  });

  test(`${edition}: sides.be.queueOutbox without a redis backing is refused`, () => {
    for (const be of [{ queueOutbox: OUTBOX }, { backing: [], queueOutbox: OUTBOX }, { backing: ['qdrant'], queueOutbox: OUTBOX }]) {
      assert.ok(problems(edition, be).some((item) => item.includes('needs sides.be.backing to declare redis')), JSON.stringify(be));
    }
  });

  test(`${edition}: sides.be.queueOutbox must name a table, a function and a parameter and nothing else`, () => {
    for (const queueOutbox of [
      null, [], 'public.job_outbox', {},
      { table: 'public.job_outbox', enqueue: 'public.job_enqueue' },
      { enqueue: 'public.job_enqueue', queueParameter: 'p_queue' },
      { ...OUTBOX, table: 'job_outbox' },
      { ...OUTBOX, enqueue: 'job_enqueue' },
      { ...OUTBOX, table: 'Public.Job_Outbox' },
      { ...OUTBOX, queueParameter: 'p-queue' },
      { ...OUTBOX, queueParameter: '' },
      { ...OUTBOX, queueParameter: 7 },
      { ...OUTBOX, columns: ['queue'] },
    ]) assert.ok(problems(edition, { backing: ['redis'], queueOutbox }).some((item) => item.startsWith('sides.be.queueOutbox must be {table:')), JSON.stringify(queueOutbox));
  });

  test(`${edition}: queueOutbox belongs to the be side`, () => {
    assert.ok(problems(edition, {}, { queueOutbox: OUTBOX }).includes('queueOutbox belongs to the be side'));
  });
}

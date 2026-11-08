// The delivery id of a resumed parked job (BE-JOBS-7): `<jobKey>:r<n>`. The outbox check `job_outbox_dedupe_key_check` refuses a dedupe key
// without a `:`, so the old `<jobKey>-r<n>` dead-lettered every sweep resume; `jobKeyOf` parses the suffix back from the end, once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const TEMPLATE = path.join(import.meta.dirname, '..', 'templates', 'be', 'patterns', 'jobs', 'platform', 'jobs.contracts.ts.tpl');
const transpiled = ts.transpileModule(fs.readFileSync(TEMPLATE, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const contracts = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`) as {
  resumedDeliveryId: (jobKey: string, resumeCount: number) => string;
  jobKeyOf: (deliveryId: string) => string;
};

/** The shape the outbox check asks of a dedupe key: it holds a `:`. */
const DEDUPE_KEY = /:/u;

test('a resumed delivery id is <jobKey>:r<n> and satisfies the outbox dedupe-key check', () => {
  assert.equal(contracts.resumedDeliveryId('mail-1', 3), 'mail-1:r3');
  assert.match(contracts.resumedDeliveryId('mail-1', 1), DEDUPE_KEY);
  assert.doesNotMatch('mail-1-r1', DEDUPE_KEY, 'the old form never satisfied the constraint');
});

test('the suffix parses back to the job key, from the last :r<digits>, once', () => {
  assert.equal(contracts.jobKeyOf('mail-1:r3'), 'mail-1');
  assert.equal(contracts.jobKeyOf('mail-1'), 'mail-1', 'a first delivery is its job key');
  for (const key of ['tenant:42:send', 'a:b:c', 'x:r5:y', 'mail-1-r1']) {
    assert.equal(contracts.jobKeyOf(key), key, `${key} holds no resume suffix`);
    for (const count of [1, 12]) assert.equal(contracts.jobKeyOf(contracts.resumedDeliveryId(key, count)), key, `${key} round-trips at resume ${String(count)}`);
  }
  assert.equal(contracts.jobKeyOf('a:r5:r2'), 'a:r5', 'only the last suffix is removed');
});

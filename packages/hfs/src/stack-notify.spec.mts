// The post-deploy notification (deploy.notify): off unless declared, one generic webhook message per announced outcome, the URL from a sealed member
// and never in a line, and a failing webhook never fails the deploy.
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { notifyBody, notifyOutcome, notifyText } from '../stack/notify.mjs';
import { recordedAttempt } from '../stack/journal.mjs';
import type { AttemptSummary } from '../stack/journal.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import { recordsDouble } from './stack-records-double.mjs';

const URL_VALUE = 'https://hooks.example/services/T000/B000/secretsecret';
const summary = (outcome: AttemptSummary['outcome'], extra: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attempt: '20261031T083015Z-0a1b2c3d', kind: 'deploy', stack: 'shop', env: 'production', outcome, trigger: 'ci',
  sourceSha: 'f'.repeat(40), tag: 'v1.2.3', releaseId: '0123456789abcdef', ciUrl: 'https://github.com/o/r/actions/runs/9', errorCode: null, ...extra,
});

// The sealed member is a placeholder file: the sops double answers for it, so no ciphertext or key is involved.
const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-notify-'));
fs.writeFileSync(path.join(secretsDir, 'notify.enc.yaml'), 'placeholder: not a secret' + String.fromCharCode(10));
after(() => fs.rmSync(secretsDir, { recursive: true, force: true }));

interface Sent { url: string; init: RequestInit }
// reason: the notification reads the sops seam, fetch and the declared block; the full context and config shapes are not needed.
function world(options: { url?: unknown; answer?: number; fail?: Error; declared?: object | null } = {}) {
  const sent: Sent[] = [];
  const fetchDouble = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(url), init: init ?? {} });
    if (options.fail) throw options.fail;
    return new Response('', { status: options.answer ?? 200 });
  };
  const ctx = {
    env: {}, now: () => Date.UTC(2026, 9, 31, 8, 30, 15), sleep: async () => {}, fetch: fetchDouble,
    sops: { decrypt: () => ({ WEBHOOK_URL: options.url ?? URL_VALUE }), decryptBinary: () => '' },
  } as unknown as StackContext;
  const declared = options.declared === undefined ? { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['accepted', 'rolled-back', 'rollback-failed', 'failed'] } : options.declared;
  const config = { notify: declared, secretsDir, stack: 'shop', env: 'production' } as unknown as DeployConfig;
  return { sent, ctx, config };
}

test('nothing is sent unless the environment declares deploy.notify', async () => {
  const { sent, ctx, config } = world({ declared: null });
  assert.deepEqual(await notifyOutcome(ctx, config, summary('accepted')), []);
  assert.equal(sent.length, 0);
});

test('an announced outcome posts one JSON message of names only, to the sealed https URL', async () => {
  const { sent, ctx, config } = world();
  assert.deepEqual(await notifyOutcome(ctx, config, summary('accepted')), []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, URL_VALUE);
  assert.equal(sent[0]?.init.method, 'POST');
  const body = JSON.parse(String(sent[0]?.init.body)) as Record<string, unknown>;
  assert.equal(body.text, body.content);
  assert.equal(body.text, '[shop/production] deploy accepted of ffffffffff (v1.2.3), release 0123456789abcdef');
  assert.equal(body.outcome, 'accepted');
  assert.equal(body.releaseId, '0123456789abcdef');
  assert.doesNotMatch(JSON.stringify(body), /secretsecret|hooks\.example/u);
});

test('an outcome outside the declared list is not announced; refused only when listed', async () => {
  const { sent, ctx, config } = world();
  for (const outcome of ['pending', 'already-current', 'refused'] as const) assert.deepEqual(await notifyOutcome(ctx, config, summary(outcome)), []);
  assert.equal(sent.length, 0);
  const listed = world({ declared: { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['refused'] } });
  await notifyOutcome(listed.ctx, listed.config, summary('refused', { errorCode: 'STACK_DEPLOY_LOCKED' }));
  assert.equal(listed.sent.length, 1);
  assert.match(String(JSON.parse(String(listed.sent[0]?.init.body)).text), /STACK_DEPLOY_LOCKED/u);
});

test('a webhook that is missing, not https, down or answering an error is one line and never carries the URL', async () => {
  const cases: Parameters<typeof world>[0][] = [{ url: '' }, { url: 'http://hooks.example/x' }, { url: 7 }, { fail: new Error(`connect ${URL_VALUE}`) }, { answer: 500 }];
  for (const options of cases) {
    const { ctx, config } = world(options);
    const lines = await notifyOutcome(ctx, config, summary('failed'));
    assert.equal(lines.length, 1, JSON.stringify(Object.keys(options ?? {})));
    assert.match(lines[0] as string, /^notify: /u);
    assert.doesNotMatch(lines[0] as string, /secretsecret|hooks\.example/u);
  }
});

test('the text names the failure code and the body carries the summary fields', () => {
  assert.equal(notifyText(summary('rolled-back', { sourceSha: null, tag: null, releaseId: null, errorCode: 'STACK_X' })), '[shop/production] deploy rolled-back, STACK_X');
  assert.equal(notifyBody(summary('failed')).attempt, '20261031T083015Z-0a1b2c3d');
});

test('a recorded attempt announces its outcome after the journal closes, and a dead webhook only adds a line', async () => {
  for (const [fail, expectLine] of [[undefined, false], [new Error('down'), true]] as const) {
    const { sent, ctx, config } = world(fail ? { fail } : {});
    const records = recordsDouble();
    const store = { ...records } as unknown as Parameters<typeof recordedAttempt>[2];
    const result = await recordedAttempt(ctx, config, store, { kind: 'deploy', trigger: 'ci', sourceSha: 'a'.repeat(40) }, {}, async (rec) => {
      rec.note({ releaseId: '0123456789abcdef' });
      return { ok: true, lines: ['deployed'], data: {} };
    });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(result.lines.some((line) => line.startsWith('notify: ')), expectLine);
    assert.equal(JSON.parse(String(sent[0]?.init.body)).outcome, 'accepted');
  }
});

test('a refused attempt is announced only when listed, and the refusal still propagates', async () => {
  const { sent, ctx, config } = world({ declared: { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['refused'] } });
  const store = { ...recordsDouble() } as unknown as Parameters<typeof recordedAttempt>[2];
  await assert.rejects(recordedAttempt(ctx, config, store, { kind: 'deploy', trigger: 'ci' }, {}, async () => { throw new Error('nope'); }), /nope/u);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(String(sent[0]?.init.body)).outcome, 'refused');
});

// ---- the declaration ---------------------------------------------------------------------------------------------------------------------

const normalize = (notify: unknown, members: string[] = ['notify']) => normalizeDeploy({ notify }, { project: 'shop', probe: { exists: () => true, services: new Set(), members: new Set(members) } });

test('deploy.notify is off by default and declared as a sealed webhook with an optional outcome list', () => {
  assert.equal(normalize(undefined).config?.notify, null);
  const declared = normalize({ webhook: { member: 'notify', key: 'WEBHOOK_URL' } }).config?.notify;
  assert.deepEqual(declared, { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['accepted', 'rolled-back', 'rollback-failed', 'failed'] });
  assert.deepEqual(normalize({ webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['failed', 'refused'] }).config?.notify?.on, ['failed', 'refused']);
});

test('deploy.notify refuses a URL written in the declaration, an unknown member, a bad key and an unknown outcome', () => {
  const cases: unknown[] = [
    { webhook: 'https://hooks.example/x' }, { webhook: { member: 'notify', key: 'WEBHOOK_URL', url: 'https://x' } }, { webhook: { member: 'other', key: 'WEBHOOK_URL' } },
    { webhook: { member: 'notify', key: 'webhook_url' } }, { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: ['pending'] }, { webhook: { member: 'notify', key: 'WEBHOOK_URL' }, on: [] }, {},
  ];
  for (const bad of cases) {
    const result = normalize(bad);
    assert.equal(result.config, null, JSON.stringify(bad));
    assert.ok(result.problems.every((problem) => problem.at.startsWith('deploy.notify')), JSON.stringify(result.problems));
  }
});

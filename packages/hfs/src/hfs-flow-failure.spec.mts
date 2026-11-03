import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BE_FLOW_FAILURE_SWALLOWED, flowFailureFindings } from '../runtime/scripts/hfs/rules/flow-failure.mjs';
import { ALL_CHECK_CODES } from '../runtime/scripts/hfs/check.mjs';

// proves: BE_FLOW_FAILURE_SWALLOWED@lite BE_FLOW_FAILURE_SWALLOWED@full

type FlowInput = Parameters<typeof flowFailureFindings>[0];

const TEMPLATE_RUNNER = path.join(import.meta.dirname, '..', 'templates', 'be', 'patterns', 'jobs', 'platform', 'job-runner.service.ts.tpl');

// A step that logged and returned: the job completed, nothing retried, nothing parked, nobody alerted.
const SWALLOWING_STEP = `export class SendStep implements JobStep {
    async run(job: ClaimedJob): Promise<void> {
        try {
            await this.mailer.send(job.payload)
        } catch (cause) {
            this.logger.error("send failed", cause)
        }
    }
}
`;

const HANDING_ON_CONSUMER = `export class OrderPlacedConsumer {
    async handle(event: OrderPlaced): Promise<void> {
        try {
            await this.orders.record(event)
        } catch (cause) {
            if (isDuplicate(cause)) { return void this.metrics.count() }
            throw cause
        }
    }
}
`;

function fixture(t: TestContext, entries: Record<string, string>, edition: string, extra: Partial<FlowInput> = {}): FlowInput & { files: string[] } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-flow-failure-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content);
  }
  return { repoRoot, files: Object.keys(entries), repo: { kind: 'app', profile: 'app', edition }, isRoot: true, ...extra };
}

const codesOf = (input: FlowInput) => flowFailureFindings(input).map((finding) => `${finding.code} ${finding.path}`);

for (const edition of ['lite', 'full']) {
  test(`${BE_FLOW_FAILURE_SWALLOWED}: ${edition} refuses a flow file that swallows a failure and a source that deletes failed jobs`, (t) => {
    const context = fixture(t, {
      'be/src/features/jobs/digest/steps/send.step.ts': SWALLOWING_STEP,
      'be/src/features/saga/order/compensations/reserve.compensation.ts': 'try { await undo() } catch { return }\n',
      'be/src/modules/platform/queue/bullmq-queue-transport.client.ts': 'await queue.add(name, data, { jobId, removeOnFail: true })\n',
    }, edition);
    assert.deepEqual(codesOf(context).sort(), [
      `${BE_FLOW_FAILURE_SWALLOWED} be/src/features/jobs/digest/steps/send.step.ts`,
      `${BE_FLOW_FAILURE_SWALLOWED} be/src/features/saga/order/compensations/reserve.compensation.ts`,
      `${BE_FLOW_FAILURE_SWALLOWED} be/src/modules/platform/queue/bullmq-queue-transport.client.ts`,
    ]);
    assert.match(flowFailureFindings(context)[0]?.message ?? '', /\(R377, BE-RESILIENCE-2\)$/u);
  });

  test(`${BE_FLOW_FAILURE_SWALLOWED}: ${edition} accepts the runner, a catch that rethrows or parks, comments, specs and other files`, (t) => {
    const context = fixture(t, {
      'be/src/modules/platform/jobs/job-runner.service.ts': fs.readFileSync(TEMPLATE_RUNNER, 'utf8'),
      'be/src/features/events/orders/transport/message/order-placed.consumer.ts': HANDING_ON_CONSUMER,
      'be/src/features/jobs/digest/transport/queue/digest.processor.ts': 'try { await run() } catch (cause) { await this.claims.park(write(cause)) }\n// catch { } removeOnFail\n',
      'be/src/features/jobs/digest/steps/send.step.spec.ts': SWALLOWING_STEP,
      'be/src/modules/domain/mail/mail.service.ts': SWALLOWING_STEP,
      'be/src/features/jobs/digest/steps/open.step.ts': 'try { await open() } catch (cause) { if (cause) {\n',
    }, edition);
    assert.deepEqual(codesOf(context), [`${BE_FLOW_FAILURE_SWALLOWED} be/src/features/jobs/digest/steps/open.step.ts`]);
  });
}

test(`${BE_FLOW_FAILURE_SWALLOWED}: only an app's root scope is judged, within scope, and an unreadable file is skipped`, (t) => {
  const entries = { 'be/src/features/jobs/digest/steps/send.step.ts': SWALLOWING_STEP };
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { isRoot: false })), []);
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { repo: { kind: 'runtime', profile: 'app', edition: 'lite' } })), []);
  assert.deepEqual(codesOf(fixture(t, entries, 'lite', { inScope: () => false })), []);
  assert.deepEqual(codesOf(fixture(t, {}, 'lite', { files: ['be/src/features/jobs/gone/steps/x.step.ts'] })), []);
  const defaulted = fixture(t, entries, 'lite');
  assert.deepEqual(flowFailureFindings({ repoRoot: defaulted.repoRoot, repo: defaulted.repo, isRoot: true, all: defaulted.files }).map((finding) => finding.code), [BE_FLOW_FAILURE_SWALLOWED]);
  assert.deepEqual(flowFailureFindings({ repoRoot: defaulted.repoRoot, repo: defaulted.repo, isRoot: true }), []);
});

test(`${BE_FLOW_FAILURE_SWALLOWED} is one of the codes the app check reports`, () => {
  assert.ok(ALL_CHECK_CODES.includes(BE_FLOW_FAILURE_SWALLOWED));
});

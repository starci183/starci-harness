// proves: BE_LOGGER_REQUIRED
/** R40, its tree half: an environment that pushes its back end's logs to Loki (`monitoring.logPush`) has a `platform/logging` that imports winston-loki. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logPushFindings } from '../runtime/scripts/hfs/rules/log-push.mjs';

const STACKS = '.starcistacks/application-stacks.yaml';
const TRANSPORT = 'be/src/modules/platform/logging/loki.transport.ts';
const ADAPTER = 'be/src/modules/platform/logging/json-logger.service.ts';
const PUSHING = 'environments:\n  production:\n    runtime: docker-swarm\n    monitoring:\n      logPush: [api]\n';
const COLLECTED = 'environments:\n  production:\n    runtime: docker-swarm\n    monitoring:\n      logs: true\n';

function tree(t: TestContext, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-r40-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { repoRoot: root, all: Object.keys(files) };
}

test('a pushing environment with the Loki transport in platform/logging passes', (t) => {
  assert.deepEqual(logPushFindings(tree(t, { [STACKS]: PUSHING, [TRANSPORT]: 'import LokiTransport from "winston-loki"\nexport { LokiTransport }\n', [ADAPTER]: 'export {}\n' })), []);
});

test('an app whose environments only collect stdout needs no transport', (t) => {
  assert.deepEqual(logPushFindings(tree(t, { [STACKS]: COLLECTED, [ADAPTER]: 'export {}\n' })), []);
  assert.deepEqual(logPushFindings(tree(t, { [STACKS]: 'environments:\n  production:\n    monitoring:\n      logPush: []\n', [ADAPTER]: 'export {}\n' })), []);
  assert.deepEqual(logPushFindings(tree(t, { [ADAPTER]: 'export {}\n' })), []);
});

test('a pushing environment without the transport is refused, and a spec that names the package does not stand in for it', (t) => {
  const findings = logPushFindings(tree(t, { [STACKS]: PUSHING, [ADAPTER]: 'import winston from "winston"\nexport { winston }\n', 'be/src/modules/platform/logging/loki.transport.spec.ts': 'import LokiTransport from "winston-loki"\nexport { LokiTransport }\n' }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, 'BE_LOGGER_REQUIRED');
  assert.equal(findings[0]?.path, 'be/src/modules/platform/logging/');
  assert.match(findings[0]?.message ?? '', /logPush of production/u);
});

test('the transport imported outside platform/logging does not count', (t) => {
  const findings = logPushFindings(tree(t, { [STACKS]: PUSHING, 'be/src/modules/domain/order/order.service.ts': 'import LokiTransport from "winston-loki"\nexport { LokiTransport }\n' }));
  assert.deepEqual(findings.map((finding) => finding.code), ['BE_LOGGER_REQUIRED']);
});

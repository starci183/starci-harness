// PROJECT-MONITORING-2 (stack/monitoring.mts): a service named in `monitoring.logPush` pushes its own lines to the shared Loki (the Winston
// adapter of platform/logging, BE-LOGGING-1). It gets LOKI_URL and its labels, joins the monitoring network, and the collector no longer keeps
// its stdout, so each line reaches Loki once; every other service keeps the collector label while `logs` is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectsLogs, LOKI_ENDPOINT, monitoringOf, telemetryEnvironment, telemetryServices } from '../stack/monitoring.mjs';

const context = { services: new Set(['api', 'web', 'db']), members: new Set<string>(), backing: {}, env: 'production' };

test('a logPush service gets the Loki URL and labels, joins the network and leaves the collector; the others stay collected', () => {
  const monitoring = monitoringOf({ monitoring: { probes: false, logPush: ['api'] } }, context);
  assert.ok(monitoring);
  assert.deepEqual(monitoring.logPush, ['api']);
  assert.deepEqual(telemetryEnvironment(monitoring, 'api', 'shop', 'production'), { LOKI_URL: LOKI_ENDPOINT, LOKI_APP: 'shop', LOKI_ENV: 'production', LOKI_SERVICE: 'shop_api' });
  assert.deepEqual(telemetryEnvironment(monitoring, 'web', 'shop', 'production'), {});
  assert.deepEqual(telemetryServices(monitoring), ['api']);
  assert.equal(collectsLogs(monitoring, 'api'), false);
  assert.equal(collectsLogs(monitoring, 'web'), true);
});

test('without logPush every service is collected while logs is on, and none when logs is off', () => {
  const on = monitoringOf({ monitoring: { probes: false } }, context);
  const off = monitoringOf({ monitoring: { probes: false, logs: false } }, context);
  assert.ok(on && off);
  assert.deepEqual(on.logPush, []);
  assert.equal(collectsLogs(on, 'api'), true);
  assert.equal(collectsLogs(off, 'api'), false);
});

test('a logPush that is no list, or names a service the stack does not hold, is refused', () => {
  assert.throws(() => monitoringOf({ monitoring: { probes: false, logPush: true } }, context), /logPush is a list/u);
  assert.throws(() => monitoringOf({ monitoring: { probes: false, logPush: ['worker'] } }, context), /logPush names the service worker/u);
});

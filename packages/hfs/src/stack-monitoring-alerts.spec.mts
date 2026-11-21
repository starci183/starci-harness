// PROJECT-MONITORING-5 (stack/monitoring.mts): an environment names its own alert bot with `monitoring.alerts.telegram.member`, a sealed member
// of that environment; the server's Alertmanager reads it, never the harness bot. Absent, its alerts are held. A member that is not sealed, or
// no member name, is refused with the other monitoring problems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_BOT_KEYS, monitoringOf } from '../stack/monitoring.mjs';

const context = (members: string[]) => ({ services: new Set(['api', 'db']), members: new Set(members), backing: {}, env: 'production' });

test('an environment without monitoring.alerts holds its alerts; one with a sealed member names it', () => {
  assert.equal(monitoringOf({ monitoring: { probes: false } }, context([]))?.alertsMember, null);
  assert.equal(monitoringOf({ monitoring: { probes: false, alerts: { telegram: { member: 'alerts' } } } }, context(['alerts']))?.alertsMember, 'alerts');
  assert.deepEqual(ALERT_BOT_KEYS, { token: 'ALERTS_TELEGRAM_BOT_TOKEN', chat: 'ALERTS_TELEGRAM_CHAT_ID' });
});

test('an alert member that is not sealed, or no member name, is refused naming the member file', () => {
  assert.throws(() => monitoringOf({ monitoring: { probes: false, alerts: { telegram: { member: 'alerts' } } } }, context([])), /alerts\.telegram\.member names alerts, which is not sealed for production.*secrets\/alerts\.enc\.yaml/u);
  assert.throws(() => monitoringOf({ monitoring: { probes: false, alerts: { telegram: {} } } }, context(['alerts'])), /alerts\.telegram\.member is no member name/u);
});

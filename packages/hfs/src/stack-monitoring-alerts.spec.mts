// PROJECT-MONITORING-5 (stack/monitoring.mts): an environment names its own alert bot with `monitoring.alerts.telegram.member`, a sealed member
// of that environment, and its owner with `telegram.owner`, a plain Telegram username; the server's Alertmanager reads them, never the harness
// bot. Absent, its alerts are held. A member that is not sealed, no member name, or an owner that is no username is refused with the other problems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_BOT_KEYS, monitoringOf, TELEGRAM_USERNAME } from '../stack/monitoring.mjs';

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

test('the owner is a Telegram username, normalised to lower case without its @; anything else is refused', () => {
  const owner = (value: unknown) => monitoringOf({ monitoring: { probes: false, alerts: { telegram: { member: 'alerts', owner: value } } } }, context(['alerts']))?.alertsOwner;
  assert.equal(owner('@StarCi183'), 'starci183');
  assert.equal(owner('starci183'), 'starci183');
  assert.equal(monitoringOf({ monitoring: { probes: false, alerts: { telegram: { member: 'alerts' } } } }, context(['alerts']))?.alertsOwner, null, 'no owner: a legacy member names its chat');
  for (const bad of ['@ab', '@1abcde', '@has space', 42, '@'.concat('a'.repeat(40))]) assert.throws(() => owner(bad), /alerts\.telegram\.owner .* is no Telegram username/u);
  assert.ok(TELEGRAM_USERNAME.test('@starci183'));
});

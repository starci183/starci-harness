// The deploy block of application-stacks.schema.yaml accepts what the deploy config parser and the secret verbs write:
// `deploy.remote.serverRecipient` (recorded by `app secret server-key --execute`) and `deploy.secrets.settings` as one
// `{ member, keys }` or a list of them (stack-deploy-config.mjs secretSettings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validateAgainstSchema } from '../runtime/scripts/lib/json-schema.mjs';

const schema = parseYaml(fs.readFileSync(new URL('../runtime/modules/schemas/application-stacks.schema.yaml', import.meta.url), 'utf8'));
const judge = (def, value) => validateAgainstSchema(value, { $ref: `#/$defs/${def}`, $defs: schema.$defs });
const RECIPIENT = `age1${'q'.repeat(58)}`;

test('deploy.remote accepts the recorded server recipient and refuses a non-age value', () => {
  assert.deepEqual(judge('deployRemote', { host: 'vps', serverRecipient: RECIPIENT }), []);
  assert.notDeepEqual(judge('deployRemote', { serverRecipient: 'AGE-SECRET-KEY-1X' }), []);
  assert.notDeepEqual(judge('deployRemote', { serverKey: RECIPIENT }), [], 'an unknown field stays refused');
});

test('deploy.secrets.settings accepts one member entry or a list of them', () => {
  const entry = { member: 'ai', keys: ['AI_BASE_URL'] };
  assert.deepEqual(judge('deploySecrets', { settings: entry }), []);
  assert.deepEqual(judge('deploySecrets', { settings: [entry, { member: 'mail', keys: ['MAIL_FROM'] }] }), []);
  assert.notDeepEqual(judge('deploySecrets', { settings: [] }), [], 'an empty list names no setting');
  assert.notDeepEqual(judge('deploySecrets', { settings: [{ member: 'ai' }] }), [], 'an entry without keys is refused');
});

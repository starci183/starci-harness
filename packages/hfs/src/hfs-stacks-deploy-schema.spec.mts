// The deploy block of application-stacks.schema.yaml accepts what the deploy config parser and the secret verbs write:
// `deploy.remote.serverRecipient` (recorded by `app secret server-key --execute`) and `deploy.secrets.settings` as one
// `{ member, keys }` or a list of them (stack-deploy-config.mjs secretSettings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validateAgainstSchema } from '../runtime/scripts/lib/json-schema.mjs';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';

const schema = parseYaml(fs.readFileSync(new URL('../runtime/modules/schemas/application-stacks.schema.yaml', import.meta.url), 'utf8'));
const judge = (def: string, value: unknown) => validateAgainstSchema(value, { $ref: `#/$defs/${def}`, $defs: schema.$defs });
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

test('deploy.remote.sealed is one member name, nothing else', () => {
  assert.deepEqual(judge('deployRemote', { sealed: 'vps' }), []);
  assert.notDeepEqual(judge('deployRemote', { sealed: { ops: 'vps', sshKey: 'vps', knownHosts: 'vps' } }), [], 'the three-role object is gone');
  assert.notDeepEqual(judge('deployRemote', { sealed: 'VPS' }), [], 'a member name is lower-case');
});

test('the deploy config reads one sealed member as the member of all three SSH roles', () => {
  const read = (sealed: unknown) => normalizeDeploy({ remote: { sealed } }, { project: 'shop', probe: { exists: () => false, services: new Set(), members: new Set(['vps']) } });
  const one = read('vps');
  assert.deepEqual(one.problems ?? [], []);
  assert.deepEqual(one.config?.remote.sealed, { ops: 'vps', sshKey: 'vps', knownHosts: 'vps' });
  assert.ok(read({ ops: 'vps', sshKey: 'vps', knownHosts: 'vps' }).problems.some((problem) => /secret migrate/.test(problem.message ?? problem)), 'the three-role object is refused, pointing to the fold');
  assert.ok(read('Not A Name').problems.some((problem) => /deploy\.remote\.sealed/.test(problem.at ?? problem)));
});

// `environments.<env>.hostServices` of application-stacks.schema.yaml: the host services an environment needs, judged by the starci CLI against
// the owner host's own config.yaml (contexts/harness/host.md "What an app needs"). The schema takes the shape the CLI reads (cli/src/harness/host-needs.ts):
// an optional landing machine and each need with the machines that may serve it, in order; a machine is a name, never an address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validateAgainstSchema } from '../runtime/scripts/lib/json-schema.mjs';

const schema = parseYaml(fs.readFileSync(new URL('../runtime/modules/schemas/application-stacks.schema.yaml', import.meta.url), 'utf8'));
const hostServices = schema.$defs.environment.properties.hostServices;
const judge = (value: unknown) => validateAgainstSchema(value, hostServices);

test('hostServices takes needs with an ordered machine list, the local PC first and the VPS as fallback, and an optional landing machine', () => {
  assert.deepEqual(judge({ needs: { 'starci.embed': ['local', 'sv-hk-1'] } }), []);
  assert.deepEqual(judge({ machine: 'sv-hk-1', needs: { embed: [] } }), [], '[] is the landing machine alone; a bare name is the catalog one');
});

test('hostServices refuses an empty or unknown shape and an address in place of a machine name', () => {
  assert.notDeepEqual(judge({}), [], 'needs is required');
  assert.notDeepEqual(judge({ needs: {} }), [], 'a need names at least one service');
  assert.notDeepEqual(judge({ needs: { embed: ['203.0.113.7'] } }), [], 'a machine is a config.yaml name, never an address');
  assert.notDeepEqual(judge({ needs: { embed: 'local' } }), [], 'the machines are a list');
  assert.notDeepEqual(judge({ needs: { embed: [] }, host: 'x' }), [], 'an unknown field stays refused');
});

test('the environment declares hostServices beside its shared-service opt-in', () => {
  assert.ok(schema.$defs.environment.properties.services, 'the swarm shared-service opt-in stays');
  assert.equal(schema.$defs.environment.additionalProperties, false);
});

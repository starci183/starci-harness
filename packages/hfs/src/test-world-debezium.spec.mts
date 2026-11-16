// proves: BE_TEST_TOPOLOGY@lite BE_TEST_TOPOLOGY@full
// R47 test-world-files, change data capture: a world that declares `stacks.debezium` needs `stacks.postgresql.logicalReplication: true`,
// `stacks.redis` and the `debezium` service in the stack definition; the service is a stateful kind (`cdc`) no fake can stand for.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appDeclaration, archFixture, findings, runArch } from './helpers/hfs-arch-fixture.mjs';
import type { FileMap } from './helpers/hfs-arch-fixture.mjs';
import { STATEFUL_KINDS } from '../runtime/scripts/lib/stack-services.mjs';

const STACKS = [
  'environments:',
  '  dev:',
  '    composeFiles: [compose.yaml]',
  '',
].join('\n');

const DEBEZIUM_IMAGE = 'quay.io/debezium/server:3.0.8.Final@sha256:b898e370b898e370b898e370b898e370b898e370b898e370b898e370b898e37';

const compose = (withDebezium: boolean) => [
  'services:',
  '  postgresql:',
  '    image: postgres:16',
  '  redis:',
  '    image: redis:7',
  ...(withDebezium ? ['  debezium:', `    image: ${DEBEZIUM_IMAGE}`] : []),
  '',
].join('\n');

const world = (stacks: string) => [
  "import { defineTestWorld } from '@starci/test-world';",
  'export const { useTestWorld, useSandbox } = defineTestWorld({',
  `  stacks: { ${stacks} },`,
  '});',
  '',
].join('\n');

const POSTGRES_LOGICAL = 'postgresql: { connections: [{ name: "primary" }], logicalReplication: true }';
const POSTGRES_PLAIN = 'postgresql: { connections: [{ name: "primary" }] }';

function topology(t: TestContext, edition: string, stacks: string, { debezium = true }: { debezium?: boolean } = {}) {
  const files: FileMap = {
    '../.starcistacks/application-stacks.yaml': STACKS,
    '../.starcistacks/dev/compose.yaml': compose(debezium),
    'src/tests/world/test-world.config.ts': world(stacks),
    '../hfs.json': JSON.stringify({ ...appDeclaration('be', { apps: [{ name: 'core', kind: 'api' }] }), edition }),
  };
  const root = archFixture(t, { files, declaration: {} });
  return findings(runArch(root), 'BE_TEST_TOPOLOGY').filter(hit => hit.message.includes('stacks.debezium'));
}

for (const edition of ['lite', 'full']) {
  test(`${edition} world declaring debezium with logical replication and redis passes`, t => {
    assert.deepEqual(topology(t, edition, `${POSTGRES_LOGICAL}, redis: {}, debezium: { connections: ["primary"] }`), []);
  });

  test(`${edition} world declaring debezium on a Postgres without logical replication is refused`, t => {
    const hits = topology(t, edition, `${POSTGRES_PLAIN}, redis: {}, debezium: {}`);
    assert.equal(hits.length, 1);
    assert.match(hits[0]?.message ?? '', /logicalReplication must be true/u);
  });

  test(`${edition} world declaring debezium without redis is refused`, t => {
    const hits = topology(t, edition, `${POSTGRES_LOGICAL}, debezium: {}`);
    assert.equal(hits.length, 1);
    assert.match(hits[0]?.message ?? '', /stacks\.redis must be declared/u);
  });

  test(`${edition} world declaring debezium with no debezium service in the stack is refused`, t => {
    const hits = topology(t, edition, `${POSTGRES_LOGICAL}, redis: {}, debezium: {}`, { debezium: false });
    assert.equal(hits.length, 1);
    assert.match(hits[0]?.message ?? '', /declares no `debezium` service/u);
  });

  test(`${edition} world without debezium is not asked for logical replication`, t => {
    assert.deepEqual(topology(t, edition, `${POSTGRES_PLAIN}, redis: {}`), []);
  });
}

test('a fakes entry standing for the debezium service is refused as a fake of a stateful service', t => {
  const full = `${POSTGRES_LOGICAL}, redis: {}, debezium: {}`;
  const source = world(full).replace('  stacks:', '  fakes: { debezium: {} }, stacks:');
  const root = archFixture(t, { files: {
    '../.starcistacks/application-stacks.yaml': STACKS,
    '../.starcistacks/dev/compose.yaml': compose(true),
    'src/tests/world/test-world.config.ts': source,
  } });
  const hits = findings(runArch(root), 'BE_TEST_TOPOLOGY').filter(hit => hit.message.includes('fakes debezium'));
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.message ?? '', /cdc holds data the app reads back/u);
});

test('the cdc kind is stateful, so a debezium service can never be faked', () => {
  assert.equal(STATEFUL_KINDS.has('cdc'), true);
});

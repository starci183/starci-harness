// proves: HFS_EDITION_FORBIDDEN_PRESENT@lite HFS_EDITION_FORBIDDEN_PRESENT@full
// The realtime pattern serves the same three doors in both editions (ruling:R212/case-7): the GraphQL subscription door and its dto are
// legal in lite as in full, the edition checker accepts them with a graphql-ws dependency, and graphql-ws and graphql-subscriptions stay owned by platform/realtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { loadSlotManifest, resolveRepoDeclaration, createSlotResolver } from '../runtime/scripts/hfs/slots.mjs';
import { effectiveSlot } from '../runtime/scripts/hfs/edition-slots.mjs';

const manifest = loadSlotManifest();
const DOOR_SLOTS = ['be.feature.realtime.sse', 'be.feature.realtime.websocket', 'be.feature.realtime.graphql', 'be.feature.realtime.dto'];
const declaration = (edition: string) => ({
  hfs: 3, kind: 'app', project: 'doors', edition,
  sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
});

for (const edition of ['lite', 'full']) {
  test(`realtime doors (${edition}): sse, websocket, graphql and the graphql dto are all opt-in, none is forbidden`, () => {
    for (const id of DOOR_SLOTS) {
      const slot = manifest.slots.find((candidate) => candidate.id === id);
      assert.ok(slot, `${id} is a slot of the manifest`);
      assert.equal(effectiveSlot(slot, 'be', edition).presence, 'opt-in', `${id} is opt-in in ${edition}`);
    }
  });

  test(`realtime doors (${edition}): a graphql subscription door file belongs to its slot`, () => {
    const repo = resolveRepoDeclaration(manifest, declaration(edition), { side: 'be' });
    const resolver = createSlotResolver(manifest, repo);
    const door = 'src/features/realtime/order-status/transport/graphql/order-status.subscription.ts';
    const dto = 'src/features/realtime/order-status/transport/graphql/dto/order-status-changed.type.ts';
    assert.equal(resolver.classifyPath(door).slot, 'be.feature.realtime.graphql');
    assert.equal(resolver.classifyPath(dto).slot, 'be.feature.realtime.dto');
  });

  test(`realtime doors (${edition}): the engine libraries of the graphql door are owned by platform/realtime`, () => {
    const params = manifest.ruleParams.be;
    const owners = edition === 'lite' ? { ...params.infraOwners, ...params.lite.infraOwners } : params.infraOwners;
    assert.deepEqual(owners['graphql-ws'], ['platform/realtime']);
    assert.deepEqual(owners['graphql-subscriptions'], ['platform/realtime']);
    assert.deepEqual(owners['socket.io'], ['platform/realtime']);
  });

  test(`realtime hub (${edition}): the shared-hub clients (pg LISTEN, both socket.io adapters, ioredis) are owned by platform/realtime`, () => {
    const params = manifest.ruleParams.be;
    const owners = edition === 'lite' ? { ...params.infraOwners, ...params.lite.infraOwners } : params.infraOwners;
    assert.deepEqual(owners['pg'], ['platform/realtime']);
    assert.deepEqual(owners['@socket.io/postgres-adapter'], ['platform/realtime']);
    assert.deepEqual(owners['@socket.io/redis-adapter'], ['platform/realtime']);
    assert.ok(owners['ioredis']?.includes('platform/realtime'), 'ioredis reaches platform/realtime');
    assert.ok(
      manifest.ruleParams.be.backing.redis.clients.includes('@socket.io/redis-adapter'),
      'the sharded adapter is a Redis backing client, so lite needs the declared redis for the Redis hub',
    );
  });
}

for (const edition of ['lite', 'full']) {
  test(`realtime doors (${edition}): the edition checker accepts a GraphQL subscription door, its dto and a graphql-ws dependency`, (t) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-realtime-doors-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    const door = 'be/src/features/realtime/order-status/transport/graphql';
    const files = ['package.json', `${door}/order-status.subscription.ts`, `${door}/order-status-graphql.module.ts`, `${door}/dto/order-status-changed.type.ts`];
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ scripts: { test: 'jest --selectProjects unit' }, dependencies: { 'graphql-ws': '6.2.1' } }));
    const findings = () => checkRepo({ repoRoot, declaration: declaration(edition), files, tree: false }).findings;
    const editionFindings = findings().filter((finding) => finding.code.startsWith('HFS_EDITION'));
    assert.deepEqual(editionFindings.map(({ code, path: file }) => ({ code, file })), [], `no edition finding for the door in ${edition}`);
    assert.deepEqual(findings().filter((finding) => finding.path?.includes('/transport/graphql/') && /forbidden/i.test(finding.code)), [], 'the door files are not forbidden slots');
    // the control: the same checker still refuses what the edition forbids
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ scripts: { test: 'jest --selectProjects unit', 'test:e2e': 'jest --selectProjects e2e' }, dependencies: { 'graphql-ws': '6.2.1' } }));
    const forbidden = findings().filter((finding) => finding.code === 'HFS_EDITION_FORBIDDEN_PRESENT').map((finding) => finding.name);
    assert.deepEqual(forbidden, edition === 'lite' ? ['test:e2e'] : [], `the e2e script is judged by the edition (${edition})`);
  });
}

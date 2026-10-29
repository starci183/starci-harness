import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addKind } from '../scaffold/add.mjs';
import { skeletonOf, starterDeclaration } from '../scaffold/app.mjs';
import { refuseFullAdapterInLite, LiteAdapterRefusal } from '../scaffold/edition-gate.mjs';
import { derivePatternFileSlots } from '../scaffold/pattern-file-slots.mjs';
import { openHfs } from '../runtime/scripts/hfs/slots.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const fixture = (t, edition) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-queue-edition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({
    kind: 'app', hfs: 3, edition,
    sides: { be: { apps: [{ name: 'api', kind: 'api' }], patterns: [], connections: [], kinds: [] }, fe: { apps: [{ name: 'web', kind: 'next' }], reads: ['be/contracts/'] } },
  }));
  return root;
};

test('derived pattern slots retain app-root lite migrations and the default back-end root', (t) => {
  const root = fixture(t, 'lite');
  const source = `files:
# Comments do not end a YAML file tree.
  - path: src/modules/platform/queue/queue.service.ts
    slot: stale-be-slot
liteFiles:
# The explicit root belongs to this entry, irrespective of field order.
  - path: db/migrations/20261024000000_queue.sql
    root: 'app'
    slot: stale-app-slot
  - path: src/modules/platform/queue/queue.policy.ts
    slot: stale-lite-slot
guidance:
  - path: an-unrelated-prose-path
`;
  const resolver = openHfs({ repoRoot: root });
  const classify = file => resolver.classifyPath(file).slot ?? null;
  const result = derivePatternFileSlots(source, classify);
  assert.deepEqual(result.problems, []);
  const derived = parseYaml(result.text);
  assert.equal(derived.files[0].slot, 'be.platform.queue');
  assert.deepEqual(derived.liteFiles.map(entry => entry.slot), ['app.db.migrations', 'be.platform.queue']);
  assert.deepEqual(derivePatternFileSlots(result.text, classify), result);
});

test('the lite starter carries the record guard and leaves the sequential primitive to the queue generator that consumes it', () => {
  const files = skeletonOf('be', starterDeclaration('demo', undefined, 'lite'), {});
  assert.ok(!files.some(file => file.path === 'be/src/modules/platform/primitives/sequence.policy.ts'));
  assert.ok(!files.some(file => file.path === 'be/src/modules/platform/primitives/sequence.policy.spec.ts'));
  assert.ok(files.some(file => file.path === 'be/src/modules/platform/primitives/record.policy.ts'));
  const entry = files.find(file => file.path === 'be/src/modules/platform/primitives/index.ts');
  assert.doesNotMatch(entry.content, /eachInOrder/);
  assert.match(entry.content, /export \{ isRecord \} from "\.\/record.policy"/);
});

test('a lite adapter refuses generation until its topic supplies an edition tree or the package carries its lite templates', () => {
  for (const liteFiles of [undefined, [], 'not a tree']) {
    assert.throws(() => refuseFullAdapterInLite({
      edition: 'lite', command: 'add queue', topics: [{ id: 'queues', doc: { liteAdapter: {}, liteFiles } }],
    }), LiteAdapterRefusal);
  }
  assert.doesNotThrow(() => refuseFullAdapterInLite({
    edition: 'lite', command: 'add queue', topics: [{ id: 'queues', doc: { liteAdapter: {}, liteFiles: [{ path: 'src/queue.ts' }] } }],
  }));
  assert.doesNotThrow(() => refuseFullAdapterInLite({
    edition: 'lite', command: 'add queue', topics: [{ id: 'queues', doc: { liteAdapter: {} } }], liteTemplated: ['queues'],
  }));
});

test('add queue in full retains the BullMQ adapter and TypeORM schema', (t) => {
  const root = fixture(t, 'full');
  const result = addKind({ repoRoot: root, noun: 'queue', name: 'send-receipt', now: () => Date.UTC(2026, 9, 24) });
  assert.ok(result.created.includes('be/src/modules/platform/queue/bullmq-queue-transport.client.ts'));
  assert.ok(result.created.includes('be/src/modules/platform/queue/errors/queue.error.ts'));
  assert.ok(result.created.includes('be/src/modules/platform/queue/messages/queue.messages.ts'));
  assert.ok(result.created.includes('be/src/modules/platform/queue/persistence/entities/queue-outbox.entity.ts'));
  assert.equal(result.created.some(file => file.startsWith('supabase/') || /pgmq/.test(file)), false);
});

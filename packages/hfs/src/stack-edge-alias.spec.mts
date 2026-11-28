// Spec: the edge-alias reconcile after a stack deploy (stack/edge-alias.mts). Each `docker service update` replaces the service's UpdateStatus, so the
// reconcile must never change a service while its own rollout is open, and never change one Swarm rolled back: the fresh `completed` state of the edge
// update would hide the rollback and the deploy would converge on the previous spec. The docker of these specs is a recording double over one service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import { reconcileEdgeAliases } from '../stack/edge-alias.mjs';

// reason: the reconcile reads the three seams spawn, now and sleep; the rest of StackContext is not used
const contextOf = (seams: object): Pick<StackContext, 'spawn' | 'now' | 'sleep'> => seams as unknown as Pick<StackContext, 'spawn' | 'now' | 'sleep'>;
// reason: the reconcile reads the stack name only
const configOf = (stack: string): Pick<DeployConfig, 'stack'> => ({ stack }) as unknown as Pick<DeployConfig, 'stack'>;

const STACK = `services:
  api:
    image: registry.example/shop-api@sha256:${'e'.repeat(64)}
    networks:
      default: {}
      edge: { aliases: [shop-api] }
networks:
  edge: { external: true, name: edge }
`;

const SINCE = '2026-11-28T07:54:00.000Z';
const AFTER = '2026-11-28T07:54:44.000Z';
const BEFORE = '2026-11-20T00:00:00.000Z';

interface Status { State: string; StartedAt: string }

/** A docker double over one service `shop_api`: the update states it reports in turn, its edge aliases, and every update it was sent. */
function dockerDouble(statuses: Status[], aliases: string[] = ['shop-api', 'api']) {
  const updates: string[][] = [];
  let edge = aliases;
  let polls = 0;
  const spawn = (_command: string, args: readonly string[]) => {
    const out = (stdout: string) => ({ status: 0, stdout, stderr: '' });
    if (args[0] === 'network' && args[1] === 'inspect') return out('edge-id\n');
    if (args[0] === 'service' && args[1] === 'inspect' && args[4] === '{{json .UpdateStatus}}') {
      const status = statuses[Math.min(polls, statuses.length - 1)];
      polls += 1;
      return out(`${JSON.stringify(status ?? null)}\n`);
    }
    if (args[0] === 'service' && args[1] === 'inspect') return out(JSON.stringify({ Spec: { TaskTemplate: { Networks: [{ Target: 'edge-id', Aliases: edge }] } } }));
    if (args[0] === 'service' && args[1] === 'update') {
      updates.push([...args]);
      const add = args.indexOf('--network-add');
      if (add >= 0) edge = String(args[add + 1]).split(',').filter((part) => part.startsWith('alias=')).map((part) => part.slice('alias='.length));
      return out('');
    }
    return { status: 1, stdout: '', stderr: `unexpected docker ${args.join(' ')}` };
  };
  return { spawn, updates, polls: () => polls };
}

function stackFile(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-alias-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'stack.yaml');
  fs.writeFileSync(file, STACK);
  return file;
}

const clock = () => {
  let now = Date.parse(AFTER);
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
};

test('a settled service gets its declared aliases: network-rm then network-add, no wait', async (t) => {
  const docker = dockerDouble([{ State: 'completed', StartedAt: AFTER }]);
  const result = await reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE });
  assert.equal(result.ok, true);
  assert.deepEqual(docker.updates.map((args) => args[3]), ['--network-rm', '--network-add']);
  assert.match(result.lines.join('\n'), /aliases \[shop-api, api\] -> \[shop-api\]/u);
});

test('an open rollout is waited for: no update is sent until the service reports completed', async (t) => {
  const docker = dockerDouble([{ State: 'updating', StartedAt: AFTER }, { State: 'updating', StartedAt: AFTER }, { State: 'completed', StartedAt: AFTER }]);
  const seen: number[] = [];
  const time = clock();
  const ctx = contextOf({ spawn: (command: string, args: readonly string[]) => { if (args[1] === 'update') seen.push(docker.polls()); return docker.spawn(command, args); }, ...time });
  await reconcileEdgeAliases(ctx, configOf('shop'), stackFile(t), { since: SINCE });
  assert.deepEqual(seen, [3, 3], 'both updates come after the third look, the one that read completed');
});

test('a service Swarm rolled back is refused untouched, so its rollback stays visible', async (t) => {
  const docker = dockerDouble([{ State: 'rollback_started', StartedAt: AFTER }]);
  await assert.rejects(reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE }), (error: { code?: string }) => error.code === 'STACK_DEPLOY_EDGE_ROLLED_BACK');
  assert.deepEqual(docker.updates, [], 'no service update was sent');
});

test('a paused update is refused untouched too', async (t) => {
  const docker = dockerDouble([{ State: 'paused', StartedAt: AFTER }]);
  await assert.rejects(reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE }), (error: { code?: string }) => error.code === 'STACK_DEPLOY_EDGE_ROLLED_BACK');
  assert.deepEqual(docker.updates, []);
});

test('a rollback older than the deploy is history: it never blocks the reconcile', async (t) => {
  const docker = dockerDouble([{ State: 'rollback_completed', StartedAt: BEFORE }]);
  const result = await reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE });
  assert.equal(result.ok, true);
  assert.equal(docker.updates.length, 2);
});

test('a rollout still open at the deadline is refused untouched', async (t) => {
  const docker = dockerDouble([{ State: 'updating', StartedAt: AFTER }]);
  await assert.rejects(reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE, settleSeconds: 20 }), (error: { code?: string }) => error.code === 'STACK_DEPLOY_EDGE_UNSETTLED');
  assert.deepEqual(docker.updates, []);
});

test('an exact attachment is left alone after the service settled', async (t) => {
  const docker = dockerDouble([{ State: 'completed', StartedAt: AFTER }], ['shop-api']);
  const result = await reconcileEdgeAliases(contextOf({ spawn: docker.spawn, ...clock() }), configOf('shop'), stackFile(t), { since: SINCE });
  assert.deepEqual(docker.updates, []);
  assert.match(result.lines.join('\n'), /already exact/u);
});

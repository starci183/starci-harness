// One copy of each dev process: a recorded process that still runs its command with its port silent is the environment's own tree (stopped
// before a fresh start), a live pid running another command is a reused id (left alone), and the on-demand processes (the gallery, a landing)
// are left out of `up` unless named in `--with`, their readiness rows with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withOnDemand } from '../stack/local-up.mjs';
import { ownedProcess } from '../stack/local-run.mjs';
import type { StackContext } from '../stack/context.mjs';
import type { LocalConfig } from '../stack/local-config.mjs';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const ctx = { now: () => NOW } as unknown as StackContext;
const entry = { pid: 42, startedAt: '2026-11-23T08:00:00Z', port: 3501, command: 'node node_modules/ts-node-dev/lib/bin.js apps/api/src/main.ts' };

test('a recorded watcher whose port went silent is the environment\'s own: silent, stopped before a fresh start', async () => {
  const silent = await ownedProcess(ctx, entry, { alive: () => true, commandLine: () => 'node.exe node_modules/ts-node-dev/lib/bin.js apps/api/src/main.ts', tcpOpen: () => Promise.resolve(false) });
  assert.equal(silent.ours, false);
  assert.equal(silent.silent, true);
  const reused = await ownedProcess(ctx, entry, { alive: () => true, commandLine: () => 'chrome.exe --type=renderer', tcpOpen: () => Promise.resolve(false) });
  assert.equal(reused.silent, undefined, 'a pid that runs another command is a reused id, never stopped');
  const ours = await ownedProcess(ctx, entry, { alive: () => true, commandLine: () => 'node.exe node_modules/ts-node-dev/lib/bin.js apps/api/src/main.ts', tcpOpen: () => Promise.resolve(true) });
  assert.equal(ours.ours, true);
});

test('the on-demand processes start only when named, and a left-out gallery takes its readiness row with it', () => {
  const run = (name: string, onDemand?: boolean) => ({ name, argv: [], cwd: '.', env: {}, files: [], heavy: 'none', skipIfExists: null, after: 'migrate', port: name, health: null, serve: null, ...(onDemand === undefined ? {} : { onDemand }) });
  const local = {
    processes: [run('api'), run('web'), run('gallery', true), run('landing', true)],
    ready: [{ name: 'api-live', url: 'u', method: 'GET', status: 200, contains: null }, { name: 'gallery-live', url: 'g', method: 'GET', status: 200, contains: null }],
  } as unknown as LocalConfig;
  const plain = withOnDemand(local, []);
  assert.deepEqual(plain.processes.map((one) => one.name), ['api', 'web']);
  assert.deepEqual(plain.ready.map((row) => row.name), ['api-live']);
  const asked = withOnDemand(local, ['gallery']);
  assert.deepEqual(asked.processes.map((one) => one.name), ['api', 'web', 'gallery']);
  assert.deepEqual(asked.ready.map((row) => row.name), ['api-live', 'gallery-live']);
});

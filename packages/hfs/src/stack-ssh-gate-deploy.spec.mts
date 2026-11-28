// A whole CI run behind the forced-command gate of the CI key (stack/ssh-gate.mts), simulated end to end: two deploys of an app with a `stack`
// database (the first start, then a release with expand and contract migrations, so the manager backup and its test decrypt run), a rollback, the
// verify, the seed step, and the jobs and task verbs, all with STARCI_SSH_GATE=1. Every command the verbs send over ssh is recorded and handed to
// the generated gate exactly as sshd hands it (SSH_ORIGINAL_COMMAND, under sh, with doubles for the host's docker, age, id and sudo and a scratch
// releases and backup folder), and the run asserts the gate admitted every one; every docker command (inspect, ps, exec, service, stack) went to
// the docker CLI of the run (ctx.spawn, DOCKER_HOST=ssh://<alias>, whose dial-stdio the gate admits), never over ssh.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPath, withPath } from '../runtime/scripts/lib/env.mjs';
import { deployRelease, rollbackRelease } from '../stack/deploy.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';
import { createReleaseStore } from '../stack/release-store.mjs';
import { verifyStack } from '../stack/verify.mjs';
import { seedDeployed } from '../stack/seeds.mjs';
import { runJobs } from '../stack/jobs.mjs';
import { runTask } from '../stack/task.mjs';
import { gateScript } from '../stack/ssh-gate.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { RunResult, StackContext } from '../stack/context.mjs';
import type { RemoteResult, Runner } from '../stack/remote.mjs';
import type { DbTarget as PostgresTarget } from '../db/postgres.mjs';

const posix = (file: string) => (process.platform === 'win32' ? file.replace(/^([A-Za-z]):/u, (_all, drive: string) => `/${drive.toLowerCase()}`) : file).split(path.sep).join('/');
const hasSh = spawnSync('sh', ['-c', 'true']).status === 0;
const RECIPIENT = `age1${'q'.repeat(58)}`;
const CONTAINER = 'abcdef012345';
const NETWORK_ID = 'n'.repeat(25);
const EXPAND = ['20261102000000_orders-total.sql'];
const CONTRACT = ['20261103000000_orders_contract_drop-legacy.sql'];

/** The rendered stack of one release: an api on the shared edge network with its one declared alias, and the database. */
const stackOf = (tag: string): string => [
  'services:', '  db:', `    image: registry.example/db:${tag}`, '  api:', `    image: registry.example/api:${tag}`, '    networks:', '      edge:', '        aliases: [shop-api]',
  'networks:', '  edge:', '    external: true', '    name: edge', '',
].join('\n');

/** The host's tools as doubles: docker answers the dump's tools, the image inspect and the decrypt run; the login is not root and has no sudo. */
const HOST_TOOLS: Record<string, string> = {
  docker: [
    '#!/bin/sh', 'if [ "$1" = inspect ]; then echo sha256:feed; exit 0; fi',
    'if [ "$1" = run ]; then cat >/dev/null; printf "./roles.sql\\n./schema.sql\\n./data.sql\\n./rowcounts.json\\n"; exit 0; fi',
    'tool="$7"; shift 7', 'case "$tool" in', `  psql) echo '[{"schema":"public","table":"t","count":"3"}]' ;;`, '  pg_dumpall|pg_dump) echo "-- dump by $tool" ;;', 'esac',
  ].join('\n'),
  age: ['#!/bin/sh', 'out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; last="$1"; shift; done', `printf 'age-encryption.org/v1\\n' > "$out"; cat "$last" >> "$out"`].join('\n'),
  id: '#!/bin/sh\necho 1000',
  sudo: '#!/bin/sh\nexit 1',
};

/** One ssh command the verbs sent, and what the gate answered. */
interface Sent { command: string; status: number }

function scene(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gate-deploy-'));
  t.after(() => {
    const releases = path.join(dir, 'base', 'releases');
    for (const release of fs.existsSync(releases) ? fs.readdirSync(releases) : []) fs.chmodSync(path.join(releases, release), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const folder of ['bin', 'base', 'app/.starcistacks', 'out']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  for (const [name, body] of Object.entries(HOST_TOOLS)) fs.writeFileSync(path.join(dir, 'bin', name), `${body}\n`, { mode: 0o755 });
  const gate = path.join(dir, 'starci-ssh-gate');
  fs.writeFileSync(gate, gateScript(), { mode: 0o755 });
  const root = path.join(dir, 'app');
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'database:\n  target: stack\n  service: db\n');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ project: 'shop', db: { appRole: 'app_be' } }));
  fs.writeFileSync(path.join(root, '.sops.yaml'), `creation_rules:\n  - age: ${RECIPIENT}\n`);
  fs.writeFileSync(path.join(root, 'identity.txt'), 'stand-in identity\n');

  // The CI key's ssh: every command goes to the gate as sshd runs a forced command.
  const sent: Sent[] = [];
  const viaGate = ((command: string, options?: { input?: string | undefined }): RemoteResult => {
    const env = { ...withPath(process.env, `${path.join(dir, 'bin')}${path.delimiter}${readPath()}`), SSH_ORIGINAL_COMMAND: command };
    const result = spawnSync('sh', [posix(gate)], { env, input: options?.input, encoding: 'utf8', windowsHide: true });
    sent.push({ command, status: result.status ?? 1 });
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }) as Runner;
  Object.assign(viaGate, { cleanup: () => {}, notes: [], argv: () => { throw new Error('no verb streams a remote command in this run'); } });

  // The docker CLI of the run (DOCKER_HOST=ssh://<alias>): recorded, answered as a manager with one running task per service would answer.
  const docker: string[][] = [];
  const spawn = (command: string, args: readonly string[]): RunResult => {
    if (command !== 'docker') return { status: 127, stdout: '', stderr: `${command} is not a tool of this run` };
    docker.push([...args]);
    const answer = (stdout: string): RunResult => ({ status: 0, stdout, stderr: '' });
    if (args[0] === 'network' && args.includes('--verbose')) return answer('{"Containers":{},"Services":{}}');
    if (args[0] === 'network' && args[1] === 'inspect') return answer(`${NETWORK_ID}\n`);
    if (args[0] === 'service' && args[1] === 'inspect') return answer(JSON.stringify({ Spec: { TaskTemplate: { Networks: [{ Target: NETWORK_ID, Aliases: ['shop-api'] }] } } }));
    if (args[0] === 'ps') return answer(`${CONTAINER}\n`);
    if (args[0] === 'exec') return answer('done\n');
    return answer('');
  };
  // reason: the verbs read spawn, env, now, sleep, cwd and the output sinks of the context
  const ctx = { spawn, env: { STARCI_SSH_GATE: '1', SOPS_AGE_KEY_FILE: path.join(root, 'identity.txt') }, now: () => Date.now(), sleep: async () => {}, cwd: root, stdout: () => {}, stderr: () => {} } as unknown as StackContext;
  // reason: the verbs read these fields of the configuration; the rest of a loaded configuration is unused here
  const config = {
    stack: 'shop', env: 'production', project: 'shop', repoRoot: root, stackFile: null, services: new Set(['db', 'api']),
    remote: { host: 'vps', releasesBase: posix(path.join(dir, 'base')), serverRecipient: null },
    backup: { image: 'alpine', keepDays: 7, dir: posix(path.join(dir, 'backups')), volumes: [] }, ingress: null,
    tasks: { sync: { service: 'api', command: ['node', 'sync.js'], timeoutSeconds: 30 } }, postDeploy: ['sync'],
    jobs: { service: 'api', command: ['node', 'jobs.js'] }, verify: { http: [], exec: [{ service: 'api', name: 'health', command: ['node', 'health.js'] }] },
  } as unknown as DeployConfig;
  return { dir, root, ctx, config, viaGate, sent, docker };
}

test('a deploy with migrations, a rollback, verify, seed, jobs and task send over ssh only what the gate admits', { skip: !hasSh }, async (t) => {
  const { dir, ctx, config, viaGate, sent, docker } = scene(t);
  const state = { expand: [] as string[], contract: [] as string[], accepted: [] as string[] };
  // Git for Windows' `ln -s` copies, so a pointer reads as absent there; the accepted releases are then answered from what the store accepted
  // (every operation still runs through the gate). The Linux CI reads the real pointers.
  const symlinks = process.platform !== 'win32';
  const releaseStore: DeployDeps['releaseStore'] = (storeConfig, ssh, options) => {
    const store = createReleaseStore(storeConfig, ssh, options);
    if (symlinks) return store;
    return { ...store, current: async () => state.accepted.at(-1) ?? '', previous: async () => state.accepted.at(-2) ?? '',
      // the copied `current` is a folder that `mv -T` cannot replace the way it replaces a link: removed first, as replacing a link would
      accept: async (id: string) => { fs.rmSync(path.join(dir, 'base', 'current'), { recursive: true, force: true }); await store.accept(id); state.accepted.push(id); } };
  };
  const ok = async () => ({ ok: true, lines: [] });
  let renders = 0;
  const floor = {
    dbContainer: async () => CONTAINER,
    // reason: the phases read only url, container and own of the target
    containerTarget: () => ({ url: 'postgresql://app@127.0.0.1:5432/app', container: CONTAINER, own: true, env: {}, secrets: [], how: 'double' }) as unknown as PostgresTarget,
    emptiness: async () => (sent.some((entry) => entry.command.startsWith('starci-op accept ')) ? { empty: false, history: true, publicTables: 2 } : { empty: true, history: false, publicTables: 0 }),
    migrate: async (_ctx: unknown, { execute, phase }: { execute: boolean; phase?: string | undefined }) => {
      const files = phase === 'contract' ? state.contract : phase === 'expand' ? state.expand : [...state.expand, ...state.contract];
      if (!execute) return { ok: true, lines: [], data: { done: files.length === 0, pushFiles: [...files] } };
      const applied = files.splice(0);
      return { ok: true, lines: [], data: { done: true, pushed: applied.map((file) => file.slice(0, 14)) } };
    },
  };
  const deps: Partial<DeployDeps> = {
    renderRelease: async (_ctx, _config, options) => {
      renders += 1;
      const tag = renders === 1 ? 'one' : 'two';
      const out = String(options.out);
      fs.writeFileSync(path.join(out, 'stack.yaml'), stackOf(tag));
      fs.writeFileSync(path.join(out, 'release.json'), `${JSON.stringify({ sourceSha: tag.repeat(10) })}\n`);
      return { ok: true, lines: [] };
    },
    provisionRelease: ok, convergeStack: ok, pruneStack: ok, observedServices: () => [], ssh: async () => viaGate, releaseStore,
    floor,
  };
  const deployOnce = async (sha: string) => {
    const out = fs.mkdtempSync(path.join(dir, 'out', 'deploy-'));
    return { out, result: await deployRelease(ctx, config, { sourceSha: sha, execute: true, out, lockWaitSeconds: 0 }, deps) };
  };

  const { result: first, out: firstOut } = await deployOnce('1'.repeat(40));
  assert.equal(first.ok, true, first.lines.join('\n'));
  const firstRelease = String(first.data!.releaseId);
  state.expand.push(...EXPAND);
  state.contract.push(...CONTRACT);
  const { result: second } = await deployOnce('2'.repeat(40));
  assert.equal(second.ok, true, second.lines.join('\n'));
  const record = second.data!.migrations as { backup: { where: string; file: string } | null; applied: string[]; contractApplied: string[] };
  assert.equal(record.backup?.where, 'manager', 'the backup and its test decrypt ran on the manager, through the gate');
  assert.deepEqual([record.applied, record.contractApplied], [['20261102000000'], ['20261103000000']]);
  assert.ok(fs.existsSync(path.join(dir, 'backups', 'db', record.backup!.file)), 'the archive is in the backup folder');

  const back = await rollbackRelease(ctx, config, { release: firstRelease, execute: true, dataAcknowledged: true, lockWaitSeconds: 0 }, deps);
  assert.equal(back.ok, true, back.lines.join('\n'));
  const verified = await verifyStack(ctx, config, { stackFile: path.join(firstOut, 'stack.yaml') });
  assert.equal(verified.ok, true, verified.lines.join('\n'));
  const seeded = await seedDeployed(ctx, config, { service: 'db' }, floor);
  assert.equal(seeded.ok, true, seeded.lines.join('\n'));
  assert.equal((await runJobs(ctx, config, { action: 'stats' })).ok, true);
  assert.equal((await runTask(ctx, config, { name: 'sync', execute: true })).ok, true);

  // What went over ssh: named operations only, each admitted (a refusal is exit 126) and each succeeded.
  const refused = sent.filter((entry) => entry.status === 126);
  assert.deepEqual(refused, [], 'the gate refused a command the run sent');
  assert.deepEqual(sent.filter((entry) => entry.status !== 0), [], 'a named operation failed');
  assert.ok(sent.every((entry) => entry.command.startsWith('starci-op ')), sent.map((entry) => entry.command).join('\n'));
  const used = new Set(sent.map((entry) => entry.command.split(' ')[1]));
  const expected = ['lock-acquire', 'lock-release', 'journal-write', 'journal-index', 'journal-read', 'store', 'read', 'accept', 'db-dump', 'db-receipt', 'db-measure', 'db-decrypt'];
  for (const name of [...expected, ...(symlinks ? ['pointer'] : [])]) assert.ok(used.has(name), `the run used ${name}`);

  // What went to the docker CLI (dial-stdio): the edge preflight and reconcile, the stack deploys, the tasks' ps and exec.
  const verbs = new Set(docker.map((args) => args.slice(0, 2).join(' ')));
  for (const verb of ['network inspect', 'service inspect', 'stack deploy', 'ps -q', `exec ${CONTAINER}`]) assert.ok(verbs.has(verb), `docker ${verb} ran on the runner`);
  assert.ok(!sent.some((entry) => /\bdocker\b/u.test(entry.command.split(' ').slice(0, 2).join(' '))), 'no docker command went over ssh');
});

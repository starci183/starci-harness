// The stack and release surface: `--sha` names the commit of `stack render|deploy` and `release gate`, the dry run of `stack prepare` is the
// read-only check of the manager (`--execute` is the effect), every stack effect names its environment with `--env`, and the release gate adds
// the Sonar step by itself when the app declares services.sonar.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACTIONS, FLAGS, READ_ONLY, stackMain } from '../stack/cli.mjs';
import { RELEASE_FLAGS, releaseMain } from '../release/index.mjs';
import { doctorHost, prepareHost } from '../stack/prepare.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';

function app(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-canonical-stack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name: string, value: string) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  write('hfs.json', JSON.stringify({ kind: 'app', project: 'fixture', edition: 'lite' }));
  write('.starcistacks/staging/stack.yml', 'services: {}\n');
  write('.starcistacks/application-stacks.yaml', JSON.stringify({ environments: { staging: { runtime: 'docker-swarm', composeFiles: ['stack.yml'], deploy: { stack: 'fixture' } } } }));
  return root;
}

/** Runs one stack action with the action modules faked; `seen` collects the options each action module receives. */
async function stack(t: TestContext, argv: string[]) {
  let err = '';
  const seen: { action: string; options: Record<string, unknown> }[] = [];
  const importer = async () => ({
    renderRelease: async (_ctx: unknown, _config: unknown, options: Record<string, unknown>) => { seen.push({ action: 'render', options }); return { ok: true, lines: [], data: {} }; },
    prepareHost: async (_ctx: unknown, _config: unknown, options: Record<string, unknown>) => { seen.push({ action: 'prepare', options }); return { ok: true, lines: [], data: {} }; },
  });
  const code = await stackMain(argv, { cwd: app(t), env: {}, stdout: () => {}, stderr: (text) => { err += text; }, importer });
  return { code, err, seen };
}

test('--sha is the commit flag of stack render and deploy', async (t) => {
  assert.deepEqual(ACTIONS.filter((action) => FLAGS[action].includes('--sha')), ['render', 'deploy']);
  const answer = await stack(t, ['render', '--env', 'staging', '--sha', 'abcdef1']);
  assert.equal(answer.code, 0, answer.err);
  assert.equal(answer.seen[0]!.options.sourceSha, 'abcdef1');
});

test('--source-sha is an unknown flag, and --reason/--remote still refuse beside --sha', async (t) => {
  for (const action of ACTIONS) assert.ok(!FLAGS[action].includes('--source-sha'), action);
  const old = await stack(t, ['render', '--env', 'staging', '--source-sha', 'abcdef1']);
  assert.equal(old.code, 2);
  assert.match(old.err, /STACK_USAGE: unknown flag --source-sha/);
  const beside = await stack(t, ['deploy', '--env', 'staging', '--urgent', '--reason', 'hotfix', '--sha', 'abcdef1']);
  assert.equal(beside.code, 2);
  assert.match(beside.err, /STACK_USAGE: --reason and --remote belong to the one-command urgent deploy without --image and --sha/);
});

test('every stack effect names its environment; prepare is one, doctor is not an action', async (t) => {
  assert.ok(!READ_ONLY.includes('prepare'));
  const bare = await stack(t, ['prepare']);
  assert.equal(bare.code, 2);
  assert.match(bare.err, /STACK_USAGE: stack prepare has an effect: name its environment with --env <env>/);
  assert.ok(!(ACTIONS as readonly string[]).includes('doctor')); // widened: 'doctor' is deliberately not an Action
  const gone = await stack(t, ['doctor', '--env', 'staging']);
  assert.equal(gone.code, 2);
  assert.match(gone.err, /STACK_USAGE: starci app stack takes /);
  assert.deepEqual(gone.seen, []);
});

test('prepare without --execute reaches the action as a dry run', async (t) => {
  const dry = await stack(t, ['prepare', '--env', 'staging']);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.seen[0]!.options.execute, false);
  const real = await stack(t, ['prepare', '--env', 'staging', '--execute']);
  assert.equal(real.seen[0]!.options.execute, true);
});

/** A manager that answers like a healthy single-node swarm with one volume missing, recording every command it is asked to run. */
function manager() {
  const commands: string[] = [];
  const run = (command: string) => {
    commands.push(command);
    if (command.includes('Swarm.LocalNodeState')) return { status: 0, stdout: 'active true\n', stderr: '' };
    if (command.includes('OSType')) return { status: 0, stdout: 'linux/x86_64\n', stderr: '' };
    if (command.includes('Server.Version')) return { status: 0, stdout: '27.0.0\n', stderr: '' };
    if (command.includes('df -Pk')) return { status: 0, stdout: '/var/lib/docker\nFilesystem 1K-blocks Used Available Use% Mounted\n/dev/x 100 1 99999999 1% /\n', stderr: '' };
    if (command.includes('volume') && command.includes('inspect')) return { status: 1, stdout: '', stderr: 'no such volume' };
    if (command.includes('-w ')) return { status: 0, stdout: 'writable\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  run.cleanup = () => {};
  run.notes = [] as string[];
  run.argv = (command: string) => ({ command: 'ssh', args: [command], env: {} });
  return { run, commands };
}

// reason: the host checks read only stack, volumes, remote and backup of the deploy config.
const CONFIG = { stack: 'fixture', volumes: ['fixture_data'], remote: {}, backup: undefined } as unknown as DeployConfig;
// reason: the host checks read only env, cwd and the writers of the stack context.
const CTX = { env: {}, cwd: os.tmpdir(), stdout: () => {}, stderr: () => {} } as unknown as StackContext;

test('the dry run of prepare is the read-only check of the manager: same lines, data, verdict and commands, and it changes nothing', async () => {
  const dry = manager();
  const check = manager();
  const prepared = await prepareHost(CTX, CONFIG, {}, { ssh: dry.run });
  const checked = await doctorHost(CTX, CONFIG, {}, { ssh: check.run });
  assert.deepEqual(prepared, checked);
  assert.deepEqual(dry.commands, check.commands);
  assert.equal(prepared.ok, false);
  assert.ok(prepared.lines.some((line) => /^FAIL {2}volume fixture_data missing/.test(line)));
  assert.ok('services' in prepared.data! && 'releases' in prepared.data!);
  assert.ok(!dry.commands.some((command) => /'volume' 'create'|'swarm' 'init'|mkdir|install -d/.test(command)));
});

test('prepare --execute creates the missing volume', async () => {
  const real = manager();
  const result = await prepareHost(CTX, CONFIG, { execute: true }, { ssh: real.run });
  assert.ok(real.commands.some((command) => /'volume' 'create' 'fixture_data'/.test(command)));
  assert.ok(result.lines.includes('created volume fixture_data'));
  assert.ok(!('services' in result.data!));
});

test('release gate takes --sha; --source and --sonar are unknown flags', async (t) => {
  const gate = RELEASE_FLAGS.gate!;
  assert.ok(gate.value.includes('--sha'));
  assert.ok(!gate.value.includes('--source'));
  assert.ok(!gate.boolean.includes('--sonar'));
  for (const [flag, value] of [['--sha', 'HEAD'], ['--source', 'HEAD'], ['--sonar', undefined]] as [string, string | undefined][]) {
    let err = '';
    const code = await releaseMain(['gate', flag, ...(value ? [value] : [])], { cwd: app(t), stdout: () => {}, stderr: (text) => { err += text; } });
    assert.equal(code, 2, flag);
    if (flag === '--sha') assert.doesNotMatch(err, /unknown flag/);
    else assert.match(err, new RegExp(`unknown flag ${flag}`));
  }
});

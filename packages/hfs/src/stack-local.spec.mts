// The dev verbs of `starci app stack` (PROJECT-STACKS-6) against a fake docker, fake probes and a sealed-looking custody:
// the manifest block is judged, the doctor's prerequisite table names the owner step per OS, `up` runs its steps in order and is idempotent,
// `down` never removes a volume, and a machine without the identity or the values is refused without minting anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { stackMain } from '../stack/cli.mjs';
import type { RunResult, Sops, Spawn } from '../stack/context.mjs';
import type { LocalDeps } from '../stack/local-run.mjs';
import { redact } from '../stack/local-run.mjs';
import { seedDevCustody } from '../runtime/scripts/hfs/secret-dev-init.mjs';

const BLOCK = `
      ports: {db: 54322, api: 3001}
      services: [{name: db, wait: healthy}]
      database:
        service: db
        port: db
        urlEnv: PRIMARY_DB_URL
        appRole: app_be
        password: {member: db, key: OWNER_PASSWORD}
        adminPassword: {member: db, key: ADMIN_PASSWORD}
        appPassword: {member: db, key: APP_PASSWORD}
      composeEnv: [{name: POSTGRES_PASSWORD, member: db, key: ADMIN_PASSWORD}]
      custody:
        - {member: db, key: ADMIN_PASSWORD, kind: password}
        - {member: db, key: OWNER_PASSWORD, kind: password}
        - {member: db, key: APP_PASSWORD, kind: password}
        - {member: auth, key: JWT_KEY, kind: ec-pem, publicKey: JWT_PUBLIC}
      setup: [{name: install, argv: [npm, ci], heavy: install, skipIfExists: node_modules}]
      seed: [{name: owner, argv: [node, seed.mjs], files: [JWT_KEY]}]
      processes:
        - {name: api, argv: [node, api.mjs], port: api, files: [JWT_KEY], env: {PORT: "\${port.api}"}}
      ready: [{name: api-live, url: "http://localhost:\${port.api}/health/live"}]
      verify: [{name: api-live, url: "http://localhost:\${port.api}/health/live"}]
      origins: [{name: api, url: "http://localhost:\${port.api}"}]`;

const MEMBER = (keys: string[]): string => `${keys.map((key) => `${key}: ENC[AES256_GCM,data:eA==,iv:aXY=,tag:dGc=,type:str]`).join('\n')}\nsops:\n  mac: ENC[AES256_GCM,data:eA==,iv:aXY=,tag:dGc=,type:str]\n  age:\n    - recipient: age1fake\n`;

/** An app with a dev environment; `sealed` members exist unless the case wants a bare folder. */
function app(t: { after: (fn: () => void) => void }, { sealed = true, runtime = 'docker-compose', block = BLOCK, extraKeys = [] }: { sealed?: boolean; runtime?: string; block?: string; extraKeys?: string[] } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-local-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ project: 'demo' }));
  fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose'), { recursive: true });
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev', 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose', 'compose.yaml'), 'services:\n  db:\n    image: postgres\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n  dev:\n    status: supported\n    runtime: ${runtime}\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n    local:${block}\n`);
  if (sealed) {
    fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'secrets', 'db.enc.yaml'), MEMBER(['ADMIN_PASSWORD', 'OWNER_PASSWORD', 'APP_PASSWORD', ...extraKeys]));
    fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'secrets', 'auth.enc.yaml'), MEMBER(['JWT_KEY', 'JWT_PUBLIC']));
  }
  return root;
}

interface Call { command: string; args: readonly string[]; input?: unknown; env?: NodeJS.ProcessEnv | undefined; background?: boolean }

/** A host with every tool; `missing` names commands that are not installed, `held` ports someone else listens on. */
/** When the fake stack's volume was created; a test moves it to stand for a wiped stack with new volumes. */
const volumeCreatedAt = { at: '2026-01-01 00:00:00 +0000 UTC' };

function host(root: string, { platform = 'linux', missing = [], decrypt }: { platform?: NodeJS.Platform; missing?: string[]; decrypt?: Sops['decrypt'] } = {}) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const answer = (command: string, args: readonly string[]): RunResult => {
    const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
    if (missing.includes(command)) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('not found'), { code: 'ENOENT' }) };
    if (command === 'node') return ok('v22.15.0\n');
    if (command === 'cmd.exe' || command === 'npm') return ok('11.0.0\n');
    if (command === 'git') return ok('git version 2.50.0\n');
    if (command === 'wsl.exe') return ok();
    if (command === 'docker' && args[0] === '--version') return ok('Docker version 29.0.0\n');
    if (command === 'docker' && args[0] === 'info') return ok('29.0.0 linux\n');
    if (command === 'docker' && args[0] === 'compose' && args[1] === 'version') return ok('2.30.0\n');
    if (command === 'docker' && args[0] === 'compose' && args.includes('ps')) return ok('cid1\n');
    if (command === 'docker' && args[0] === 'inspect') return ok('running healthy\n');
    if (command === 'docker' && args[0] === 'ps') return ok('');
    if (command === 'docker' && args[0] === 'volume' && args[1] === 'ls') return ok('stack_db\n');
    if (command === 'docker' && args[0] === 'volume' && args[1] === 'inspect') return ok(`stack_db ${volumeCreatedAt.at}\n`);
    return ok();
  };
  const spawn = ((command: string, args: readonly string[], options: { input?: unknown; env?: NodeJS.ProcessEnv; background?: boolean } = {}) => {
    calls.push({ command, args, input: options.input, env: options.env, background: options.background === true });
    if (options.background) return { pid: 4242, unref() {} };
    return answer(command, args);
  }) as unknown as Spawn;
  const sops: Sops = { decrypt: decrypt ?? ((file: string) => Object.fromEntries([...fs.readFileSync(file, 'utf8').matchAll(/^([A-Z_]+): ENC/gmu)].map((match) => [match[1] as string, `value-of-${match[1]}-0123456789`])) ), decryptBinary: () => '', updateKeys: () => {} };
  let clock = 0;
  const io = {
    cwd: root, platform, spawn, sops,
    env: { LOCALAPPDATA: path.join(root, '..', `${path.basename(root)}-local`), XDG_DATA_HOME: path.join(root, '..', `${path.basename(root)}-local`), HOME: root, USERPROFILE: root, STARCI_LOCAL_ROOT: path.join(root, '..', `${path.basename(root)}-state`) } as NodeJS.ProcessEnv,
    stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); },
    sleep: async () => { clock += 1000; }, now: () => clock,
    fetch: (async () => ({ status: 200, text: async () => 'ok' })) as unknown as typeof fetch,
  };
  return { io, calls, out, err };
}

const deps = (extra: LocalDeps = {}): LocalDeps => ({ portFree: async () => true, diskFreeGb: () => 100, memoryMb: () => ({ free: 8000, total: 16000 }), alive: () => false, tcpOpen: async () => true, migrate: async () => 0, ...extra });
const run = (_root: string, argv: string[], h: ReturnType<typeof host>, extra: LocalDeps = {}): Promise<number> => stackMain(argv, { ...h.io, localDeps: deps(extra) });

test('the local block is judged: closed fields, one port each, an own role, the app role with its password', () => {
  const good = normalizeLocal({ ports: { db: 54322 }, services: [{ name: 'db', wait: 'healthy' }] }, { project: 'demo', env: 'dev' });
  assert.equal(good.problems.length, 0);
  assert.equal(good.config?.project, 'demo-dev');
  const bad = normalizeLocal({
    ports: { db: 54322, api: 54322 }, services: [{ name: 'db', wait: 'tcp' }], extra: 1,
    database: { service: 'db', port: 'db', urlEnv: 'URL', role: 'postgres', appRole: 'app_be', password: { member: 'db', key: 'A' }, adminPassword: { member: 'db', key: 'B' } },
    ready: [{ name: 'x', url: 'https://example.com/' }],
  }, { project: 'demo', env: 'dev' });
  const text = bad.problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  assert.match(text, /extra: is not a field/u);
  assert.match(text, /ports\.api: is the port of db too/u);
  assert.match(text, /services\[0\]\.port: must name a declared port when wait is tcp/u);
  assert.match(text, /database\.role: must be a role of this environment alone/u);
  assert.match(text, /database\.appPassword: is declared with appRole/u);
  assert.match(text, /ready\[0\]\.url: must be an http URL on the loopback/u);
});

test('doctor prints the owner-run install step per OS for each missing prerequisite and changes nothing', async (t) => {
  const root = app(t);
  for (const [platform, step] of [['win32', 'winget install Docker.DockerDesktop'], ['darwin', 'brew install --cask docker'], ['linux', 'sudo apt install docker.io']] as const) {
    const h = host(root, { platform, missing: ['docker', 'sops', 'age'] });
    assert.equal(await run(root, ['doctor', '--env', 'dev'], h), 1, platform);
    const text = h.out.join('');
    assert.match(text, /FAIL {2}docker: docker not found on PATH/u);
    assert.ok(text.includes(`owner step: ${step}`), `${platform}: ${text}`);
    assert.match(text, /FAIL {2}sops: sops not found on PATH/u, 'sealed members make sops and age prerequisites');
    assert.equal(platform === 'win32', /wsl: WSL2 is installed/u.test(text));
    assert.ok(h.calls.every((call) => !(call.command === 'docker' && ['up', 'down', 'build', 'pull'].includes(String(call.args[3])))), 'read-only');
    assert.doesNotMatch(text, /value-of-/u);
  }
});

test('doctor refuses an old Node, a held port (naming the holder), low disk and memory', async (t) => {
  const root = app(t);
  fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
  const h = host(root);
  const code = await run(root, ['doctor', '--env', 'dev'], h, { portFree: async (port) => port !== 3001, diskFreeGb: () => 2, memoryMb: () => ({ free: 100, total: 1000 }) });
  assert.equal(code, 1);
  const text = h.out.join('');
  assert.match(text, /FAIL {2}node: node 22\.15\.0 found, 24 or newer wanted/u);
  assert.match(text, /FAIL {2}port api: 3001 is held by an unknown process/u);
  assert.match(text, /FAIL {2}disk: 2 GB free, 10 GB wanted/u);
  assert.match(text, /FAIL {2}memory: 1000 MB RAM, 4096 MB wanted/u);
});

test('doctor reports the base port: the role table of the native ports and an overlapping range of another app on the machine (R389)', async (t) => {
  const root = app(t);
  const manifest = path.join(root, '.starcistacks', 'application-stacks.yaml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('    local:\n', '    local:\n      basePort: 3000\n').replace('db: 54322', 'db: 3090'));
  const clear = host(root);
  assert.equal(await run(root, ['doctor', '--env', 'dev'], clear, { peers: () => [{ project: 'neighbour', repoRoot: 'D:/apps/neighbour', basePort: 3100 }] }), 0);
  assert.match(clear.out.join(''), /ok {4}base port: 3000 \(3000\.\.3099\)/u);
  assert.match(clear.out.join(''), /ok {4}port range: 3000\.\.3099 overlaps no other project; compared neighbour 3100\.\.3199 \(D:\/apps\/neighbour\)/u);
  const clash = host(root);
  assert.equal(await run(root, ['doctor', '--env', 'dev'], clash, { peers: () => [{ project: 'neighbour', repoRoot: 'D:/apps/neighbour', basePort: 3050 }] }), 1);
  assert.match(clash.out.join(''), /FAIL {2}port range: 3000\.\.3099 overlaps neighbour 3050\.\.3149 \(D:\/apps\/neighbour\)/u);
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('basePort: 3000', 'basePort: 3010'));
  const off = host(root);
  assert.equal(await run(root, ['doctor', '--env', 'dev'], off, { peers: () => [] }), 1);
  assert.match(off.out.join(''), /FAIL {2}base port: processes\.api is the api: basePort \+ 1 = 3011, not 3001/u);
});

test('up is a dry run without --execute and refuses a machine that fails the table before any effect', async (t) => {
  const root = app(t);
  const dry = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev'], dry), 0);
  assert.match(dry.out.join(''), /dry run: nothing was started/u);
  assert.equal(dry.calls.filter((call) => call.command === 'docker' && call.args.includes('up')).length, 0);
  const bare = host(root, { missing: ['docker'] });
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], bare), 2);
  assert.match(bare.err.join(''), /STACK_LOCAL_HOST/u);
  assert.equal(bare.calls.filter((call) => call.args.includes('up') || call.args.includes('ci')).length, 0);
});

test('up --execute runs the steps in order, hands custody over as files, and a second run starts nothing twice', async (t) => {
  const root = app(t);
  const h = host(root);
  const record: string[] = [];
  const first = await run(root, ['up', '--env', 'dev', '--execute'], h, { migrate: async (name, env) => { record.push(`migrate ${name} ${String(env.DATABASE_URL).startsWith('postgresql://demo_dev:')}`); return 0; } });
  assert.equal(first, 0, h.err.join(''));
  const steps = h.calls.map((call) => `${call.command} ${call.args.filter((arg) => !arg.includes(path.sep)).join(' ')}`);
  const index = (needle: string): number => steps.findIndex((step) => step.includes(needle));
  assert.ok(index('npm') >= 0 && index('npm') < index('up -d --build db'), 'setup before the services');
  assert.ok(steps.some((step) => /compose.* up -d --build db$/u.test(step) || step.includes('up -d --build db')), 'a changed build input rebuilds: compose up carries --build');
  assert.ok(index('up -d --build db') > 0 && index('exec -T db') > index('up -d --build db'), 'the database role is provisioned after the service is up');
  assert.deepEqual(record, ['migrate DATABASE_URL true']);
  const sql = h.calls.filter((call) => call.args.includes('exec')).map((call) => String(call.input));
  assert.match(sql[0] as string, /CREATE ROLE "demo_dev" LOGIN SUPERUSER PASSWORD/u);
  assert.match(sql[1] as string, /ALTER ROLE "app_be" LOGIN PASSWORD/u);
  assert.ok(h.calls.every((call) => !call.args.some((arg) => arg.includes('value-of-'))), 'no value is ever an argument');
  const started = h.calls.find((call) => call.background);
  assert.ok(started && /_FILE$/mu.test(Object.keys(started.env ?? {}).filter((key) => key.endsWith('_FILE')).join('\n')), 'the process reads custody through <KEY>_FILE');
  assert.equal((started?.env as NodeJS.ProcessEnv).PORT, '3001');
  assert.match(h.out.join(''), /origin api: http:\/\/localhost:3001/u);
  assert.match(h.out.join(''), /seed owner: done/u);
  const again = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], again, { alive: () => true }), 0, again.err.join(''));
  assert.equal(again.calls.filter((call) => call.background).length, 0, 'a running process is kept');
  assert.match(again.out.join(''), /seed owner: already done/u);
  volumeCreatedAt.at = '2026-02-02 00:00:00 +0000 UTC';
  const wiped = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], wiped, { alive: () => true }), 0, wiped.err.join(''));
  assert.match(wiped.out.join(''), /seed owner: done/u, 'new volumes run the seed commands again: a state file that outlived the data is no receipt');
  volumeCreatedAt.at = '2026-01-01 00:00:00 +0000 UTC';
});

test('a recorded pid that another process now holds is discarded, not trusted: up starts fresh, down never kills it', async (t) => {
  const root = app(t);
  const first = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], first), 0, first.err.join(''));
  const started = first.calls.find((call) => call.background);
  assert.ok(started);
  const recordedCommand = [started.command, ...started.args].join(' ');
  // the pid is alive again after a reboot, but it is another program
  const reused = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], reused, { alive: () => true, commandLine: () => 'C:/Windows/System32/svchost.exe -k netsvcs' }), 0, reused.err.join(''));
  assert.match(reused.out.join(''), /process api: discarded a stale record: pid [0-9]+ is alive but runs another command/u);
  assert.equal(reused.calls.filter((call) => call.background).length, 1, 'the api is started fresh');
  // the pid alive with the recorded command line is ours and kept
  const ours = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], ours, { alive: () => true, commandLine: () => recordedCommand }), 0, ours.err.join(''));
  assert.equal(ours.calls.filter((call) => call.background).length, 0, 'the same command on a listening port is kept');
  // the right command but nothing listening long after it started: the id was reused by a lookalike
  const quiet = host(root);
  quiet.io.now = () => 3_600_000;
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], quiet, { alive: () => true, commandLine: () => recordedCommand, tcpOpen: async () => false }), 0, quiet.err.join(''));
  assert.match(quiet.out.join(''), /discarded a stale record: pid [0-9]+ is alive but nothing listens on its port/u);
  // down leaves a stranger alone
  const killed: number[] = [];
  const down = host(root);
  assert.equal(await run(root, ['down', '--env', 'dev', '--execute'], down, { alive: () => true, commandLine: () => 'notepad.exe', kill: (pid) => killed.push(pid) }), 0, down.err.join(''));
  assert.deepEqual(killed, [], 'a process that is not ours is never ended');
  assert.match(down.out.join(''), /left running: pid [0-9]+ is alive but runs another command/u);
});

test('up applies the seed levels after the migrations, in the database container under the owner role, with the receipts table', async (t) => {
  const root = app(t);
  for (const [file, text] of [
    ['.starcistacks/seeds/seeds.yaml', 'schema: starci/seeds@1\nentries:\n  - {id: plans, kind: sql, path: sql/010-plans.sql, target: primary, mode: upsert}\n  - {id: modules, kind: data, path: data/modules.json, target: [node, cli.js, modules, seed], schema: module.schema.json, mode: upsert}\n'],
    ['.starcistacks/seeds/sql/010-plans.sql', "insert into plans values ('free') on conflict do nothing;\n"],
    ['.starcistacks/seeds/data/modules.json', '{"id": "sales"}\n'],
    ['module.schema.json', '{"type": "object", "required": ["id"]}\n'],
  ] as const) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const h = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], h), 0, h.err.join(''));
  assert.match(h.out.join(''), /seed shared\/plans: applied \(sql, upsert, 1 file\)/u);
  const steps = h.calls.map((call) => call.args.join(' '));
  const copied = steps.findIndex((step) => step.startsWith('cp ') && step.includes('010-plans.sql cid1:'));
  assert.ok(copied > 0 && steps.slice(0, copied).some((step) => step.includes('create table if not exists public.starci_seed_receipts')), 'the receipts table first, then the seed file in the database container');
  assert.ok(steps.some((step) => step.includes('postgresql://demo_dev')), 'the owner role of the environment');
  const loaded = h.calls.find((call) => call.command === 'node' && call.args.includes('modules'));
  assert.deepEqual(JSON.parse(String(loaded?.input)).documents, [{ path: 'data/modules.json', document: { id: 'sales' } }]);
  assert.equal(loaded?.env?.PORT, '3001', 'the app command gets the api process environment, its ports expanded');
  assert.ok(loaded?.env?.JWT_KEY_FILE, 'and its custody files as *_FILE pointers');
  assert.ok(Object.keys(loaded?.env ?? {}).some((key) => key.startsWith('PRIMARY_DB_URL')), 'and the database URL the api reads');
  assert.equal(JSON.stringify(h.out).includes('value-of-JWT_KEY'), false, 'no opened value reaches the output');
  const dry = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev'], dry), 0);
  assert.match(dry.out.join(''), /plan seed levels: \.starcistacks\/seeds, then \.starcistacks\/dev\/seeds/u);
});

test('a missing value is refused with the owner step, and a machine without the identity with the way to obtain it, never a replacement', async (t) => {
  const bare = app(t, { sealed: false });
  const a = host(bare);
  assert.equal(await run(bare, ['up', '--env', 'dev', '--execute'], a), 2);
  assert.match(a.err.join(''), /STACK_LOCAL_CUSTODY_MISSING: .*starci app secret init --env dev --execute/u);
  const sealed = app(t);
  const b = host(sealed, { decrypt: () => { throw new Error('no identity: this machine holds none of age1fake'); } });
  assert.equal(await run(sealed, ['up', '--env', 'dev', '--execute'], b), 2);
  assert.match(b.err.join(''), /STACK_LOCAL_IDENTITY_MISSING: .*obtained from the owner.*a replacement is never generated/u);
  assert.equal(b.calls.filter((call) => call.args.includes('up')).length, 0);
});

test('down ends the processes and stops the project but never removes a volume', async (t) => {
  const root = app(t);
  const h = host(root);
  await run(root, ['up', '--env', 'dev', '--execute'], h);
  const killed: number[] = [];
  const stop = host(root);
  assert.equal(await run(root, ['down', '--env', 'dev', '--execute'], stop, { alive: () => true, kill: (pid) => killed.push(pid) }), 0, stop.err.join(''));
  assert.deepEqual(killed, [4242]);
  const down = stop.calls.find((call) => call.args.includes('down'));
  assert.ok(down);
  assert.ok(!down.args.includes('-v') && !down.args.includes('--volumes') && !down.args.includes('--rmi'));
  assert.ok(down.args.includes('demo-dev'), 'only its own compose project');
});

test('status and verify read desired against running, logs are bounded and redacted', async (t) => {
  const root = app(t);
  const h = host(root);
  await run(root, ['up', '--env', 'dev', '--execute'], h);
  const up = host(root);
  assert.equal(await run(root, ['status', '--env', 'dev'], up, { alive: () => true }), 0, up.out.join(''));
  assert.match(up.out.join(''), /migrations: receipt \w+ is (current|stale)/u);
  const gone = host(root);
  assert.equal(await run(root, ['verify', '--env', 'dev'], gone, { alive: () => false }), 1);
  assert.match(gone.out.join(''), /api not running/u);
  const verified = host(root);
  assert.equal(await run(root, ['verify', '--env', 'dev'], verified, { alive: () => true }), 0);
  const noService = host(root);
  assert.equal(await run(root, ['logs', '--env', 'dev'], noService), 2);
  assert.match(noService.err.join(''), /STACK_LOCAL_LOGS_SERVICE/u);
  assert.equal(redact('DB_PASSWORD=hunter2 token: abc Authorization: Bearer xyz ok=1'), 'DB_PASSWORD=[redacted] token: [redacted] Authorization: Bearer [redacted] ok=1');
});

test('a swarm environment keeps the swarm verbs and refuses the dev-only ones', async (t) => {
  const root = app(t, { runtime: 'docker-swarm' });
  const h = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], h), 2);
  assert.match(h.err.join(''), /STACK_LOCAL_NOT_DEV/u);
});

test('secret init --env creates dev values once, never for a swarm environment, never over a sealed value', (t) => {
  const root = app(t, { sealed: false });
  const sealedWrites: Array<{ file: string; keys: string[] }> = [];
  const sops = { seal: ({ plaintext, filenameOverride }: { plaintext: string; filenameOverride: string }) => { sealedWrites.push({ file: path.basename(filenameOverride), keys: [...plaintext.matchAll(/^([A-Z_]+):/gmu)].map((m) => m[1] as string) }); return MEMBER([...plaintext.matchAll(/^([A-Z_]+):/gmu)].map((m) => m[1] as string)); }, decrypt: () => ({}) } as never;
  const out: string[] = [];
  assert.equal(seedDevCustody(root, 'dev', { execute: false, sops: () => sops, stdout: (text) => out.push(text) }), 0);
  assert.equal(sealedWrites.length, 0, 'a dry run writes nothing');
  assert.equal(seedDevCustody(root, 'dev', { execute: true, sops: () => sops, stdout: (text) => out.push(text) }), 0);
  assert.deepEqual(sealedWrites.map((item) => item.file).sort(), ['auth.enc.yaml', 'db.enc.yaml']);
  assert.deepEqual(sealedWrites.find((item) => item.file === 'auth.enc.yaml')?.keys, ['JWT_KEY', 'JWT_PUBLIC']);
  const second: string[] = [];
  const before = sealedWrites.length;
  seedDevCustody(root, 'dev', { execute: true, sops: () => sops, stdout: (text) => second.push(text) });
  assert.equal(sealedWrites.length, before, 'a sealed value is kept');
  assert.match(second.join(''), /kept dev\/db ADMIN_PASSWORD \(already sealed, never replaced\)/u);
  const swarm = app(t, { runtime: 'docker-swarm' });
  assert.throws(() => seedDevCustody(swarm, 'dev', { execute: true, sops: () => sops, stdout: () => {} }), /only a docker-compose dev environment gets generated values/u);
});

const WITH_CONNECTION = `${BLOCK.replace('port: api, files: [JWT_KEY]', 'port: api, files: [JWT_KEY, LEDGER_DB_URL]')}
      databases:
        - {connection: ledger, urlEnv: LEDGER_DB_URL, password: {member: db, key: LEDGER_PASSWORD}}`;

test('the databases list is judged: it needs the database block, own role and URL key, and defaults the role to the environment role and the connection', () => {
  const ports = { db: 54322 };
  const services = [{ name: 'db', wait: 'healthy' }];
  const base = { service: 'db', port: 'db', urlEnv: 'URL', password: { member: 'db', key: 'A' }, adminPassword: { member: 'db', key: 'B' } };
  const good = normalizeLocal({ ports, services, database: base, databases: [{ connection: 'ledger-books', urlEnv: 'LEDGER_URL', password: { member: 'db', key: 'C' } }] }, { project: 'demo', env: 'dev' });
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.config?.databases.map((database) => [database.connection, database.role, database.name, database.service, database.adminPassword.key]), [['ledger-books', 'demo_dev_ledger_books', 'demo_dev_ledger_books', 'db', 'B']]);
  const alone = normalizeLocal({ ports, services, databases: [{ connection: 'ledger', urlEnv: 'LEDGER_URL', password: { member: 'db', key: 'C' } }] }, { project: 'demo', env: 'dev' });
  assert.match(alone.problems.map((item) => `${item.at}: ${item.message}`).join('\n'), /databases: needs the `database` block/u);
  const bad = normalizeLocal({
    ports, services, database: base,
    databases: [
      { connection: 'ledger', urlEnv: 'URL', password: { member: 'db', key: 'C' } },
      { connection: 'ledger', urlEnv: 'LEDGER_URL', role: 'postgres', password: { member: 'db', key: 'C' } },
      { connection: 'audit', urlEnv: 'AUDIT_URL', password: { member: 'db', key: 'C' }, extra: 1 },
    ],
  }, { project: 'demo', env: 'dev' });
  const text = bad.problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  assert.match(text, /databases\[0\]\.urlEnv: must differ from the URL key of the `database` block/u);
  assert.match(text, /databases\[1\]\.role: must be a role of this connection alone/u);
  assert.match(text, /databases\[1\]: repeats a connection, role, database or URL key/u);
  assert.match(text, /extra: is not a field/u);
});

test('up provisions the role and database of each further connection and hands only its owner process the URL file', async (t) => {
  const root = app(t, { block: WITH_CONNECTION, extraKeys: ['LEDGER_PASSWORD'] });
  const h = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], h), 0, h.err.join(''));
  const sql = h.calls.filter((call) => call.args.includes('exec')).map((call) => String(call.input));
  assert.match(sql[0] as string, /CREATE ROLE "demo_dev" LOGIN SUPERUSER PASSWORD/u);
  assert.match(sql[1] as string, /CREATE ROLE "demo_dev_ledger" LOGIN SUPERUSER PASSWORD/u);
  assert.match(sql[1] as string, /CREATE DATABASE "demo_dev_ledger" OWNER "demo_dev_ledger"/u);
  assert.match(h.out.join(''), /database: role demo_dev and database demo_dev ready.*; database: role demo_dev_ledger and database demo_dev_ledger ready.*\(connection ledger\)/u);
  const api = h.calls.find((call) => call.background);
  const file = (api?.env as NodeJS.ProcessEnv).LEDGER_DB_URL_FILE;
  assert.ok(file, 'the owner process reads the connection URL through <KEY>_FILE');
  assert.match(fs.readFileSync(file as string, 'utf8'), /^postgresql:\/\/demo_dev_ledger:[^@]+@127\.0\.0\.1:54322\/demo_dev_ledger$/u);
  const seed = h.calls.find((call) => !call.background && call.env && 'JWT_KEY_FILE' in call.env);
  assert.equal(seed?.env && 'LEDGER_DB_URL_FILE' in seed.env, false, 'a run that does not list the key never gets the connection URL');
});

test('a process that lists DATABASE_OWNER_URL in files gets the owner connection as a file, and no other run does', async (t) => {
  const root = app(t, { block: BLOCK.replace('port: api, files: [JWT_KEY]', 'port: api, files: [JWT_KEY, DATABASE_OWNER_URL]') });
  const h = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], h), 0, h.err.join(''));
  const api = h.calls.find((call) => call.background);
  const file = (api?.env as NodeJS.ProcessEnv).DATABASE_OWNER_URL_FILE;
  assert.ok(file, 'the listing process reads the owner connection through DATABASE_OWNER_URL_FILE');
  assert.match(fs.readFileSync(file as string, 'utf8'), /^postgresql:\/\/demo_dev:[^@]+@127\.0\.0\.1:\d+\/demo_dev$/u);
  const seed = h.calls.find((call) => !call.background && call.env && 'JWT_KEY_FILE' in call.env);
  assert.equal(seed?.env && 'DATABASE_OWNER_URL_FILE' in seed.env, false, 'a run that does not list the key never gets the owner connection');
});

test('an always seed command runs on every up (a TypeORM migration runner); a once command keeps its volume receipt', async (t) => {
  const root = app(t, { block: BLOCK.replace('seed: [{name: owner, argv: [node, seed.mjs], files: [JWT_KEY]}]', 'seed: [{name: owner, argv: [node, seed.mjs], files: [JWT_KEY]}, {name: migrate-typeorm, argv: [node, typeorm.mjs], mode: always}]') });
  const first = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], first), 0, first.err.join(''));
  assert.match(first.out.join(''), /seed migrate-typeorm: done \(always\)/u);
  const again = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], again, { alive: () => true }), 0, again.err.join(''));
  assert.match(again.out.join(''), /seed owner: already done/u);
  assert.match(again.out.join(''), /seed migrate-typeorm: done \(always\)/u, 'a new migration reaches an existing stack');
  assert.ok(again.calls.some((call) => call.args.includes('typeorm.mjs')), 'the runner ran again');
});

test('the seed mode is judged: once or always', () => {
  const bad = normalizeLocal({ ports: { db: 54322 }, services: [{ name: 'db', wait: 'healthy' }], seed: [{ name: 'x', argv: ['node', 'x.mjs'], mode: 'sometimes' }] }, { project: 'demo', env: 'dev' });
  assert.ok(bad.problems.some((problem) => JSON.stringify(problem).includes('must be once or always')), JSON.stringify(bad.problems));
  const good = normalizeLocal({ ports: { db: 54322 }, services: [{ name: 'db', wait: 'healthy' }], seed: [{ name: 'x', argv: ['node', 'x.mjs'], mode: 'always' }] }, { project: 'demo', env: 'dev' });
  assert.equal(good.config?.seed[0]?.mode, 'always', JSON.stringify(good.problems));
});

test('a failed db migrate names its coded refusal instead of a bare exit', async (t) => {
  const root = app(t);
  const h = host(root);
  const code = await run(root, ['up', '--env', 'dev', '--execute'], h, { migrate: async () => 2 });
  assert.notEqual(code, 0);
  assert.match(h.err.join('') + h.out.join(''), /STACK_LOCAL_MIGRATE/u);
});

test('the always seed commands run right after db migrate, before the seed levels (and the loader of the pinned standards), the once commands after them', async (t) => {
  const root = app(t, { block: BLOCK.replace('seed: [{name: owner, argv: [node, seed.mjs], files: [JWT_KEY]}]', 'seed: [{name: owner, argv: [node, seed.mjs], files: [JWT_KEY]}, {name: migrate-typeorm, argv: [node, typeorm.mjs], mode: always}]') });
  fs.mkdirSync(path.join(root, '.starcistacks', 'seeds', 'sql'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks/seeds/seeds.yaml'), 'schema: starci/seeds@1\nentries:\n  - {id: plans, kind: sql, path: sql/010-plans.sql, target: primary, mode: upsert}\n');
  fs.writeFileSync(path.join(root, '.starcistacks/seeds/sql/010-plans.sql'), "insert into plans values ('free') on conflict do nothing;\n");
  const h = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], h), 0, h.err.join(''));
  const steps = h.calls.map((call) => call.args.join(' '));
  const runner = steps.findIndex((step) => step.includes('typeorm.mjs'));
  const level = steps.findIndex((step) => step.includes('create table if not exists public.starci_seed_receipts'));
  const once = steps.findIndex((step) => step.includes('seed.mjs'));
  assert.ok(runner >= 0 && level > runner && once > level, `runner ${String(runner)} < seed levels ${String(level)} < once ${String(once)}`);
});

test('up with a declared baseline starts the database service alone, adopts it, then starts the rest and migrates; a refused adopt stops before migrate; --only starts one service', async (t) => {
  const withBaseline = (): string => {
    const root = app(t);
    const file = path.join(root, '.starcistacks', 'application-stacks.yaml');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8').replace(/\s*$/u, '\n')}database:\n  baseline: baseline\n`);
    return root;
  };
  const root = withBaseline();
  const h = host(root);
  const record: string[] = [];
  const code = await run(root, ['up', '--env', 'dev', '--execute'], h, {
    adopt: async (name, env, _cwd, report) => { record.push(`adopt ${name} ${String(env.DATABASE_URL).startsWith('postgresql://demo_dev:')}`); report.push('adopted: the history holds 20260101000000.'); return 0; },
    migrate: async () => { record.push('migrate'); return 0; },
  });
  assert.equal(code, 0, h.err.join(''));
  assert.deepEqual(record, ['adopt DATABASE_URL true', 'migrate'], 'adopt runs before migrate');
  const steps = h.calls.map((call) => call.args.join(' '));
  assert.ok(steps.findIndex((step) => step.includes('up -d --build db')) < steps.findIndex((step) => step.includes('exec -T db')), 'the database service is up before it is provisioned');
  assert.match(h.out.join(''), /adopt: adopted: the history holds/u);
  const refused = host(root);
  const migrated: string[] = [];
  const stopped = await run(root, ['up', '--env', 'dev', '--execute'], refused, {
    adopt: async (_name, _env, _cwd, report) => { report.push('starci app db adopt: DB_ADOPT_SCHEMA_DIFFERS: the database schema is not the baseline', '  + TABLE public users: in the baseline, not in the database'); return 2; },
    migrate: async () => { migrated.push('migrate'); return 0; },
  });
  assert.notEqual(stopped, 0);
  assert.match(refused.err.join('') + refused.out.join(''), /STACK_LOCAL_ADOPT[\s\S]*DB_ADOPT_SCHEMA_DIFFERS[\s\S]*TABLE public users/u, 'the refusal carries the diff');
  assert.deepEqual(migrated, [], 'migrate did not run');
  const only = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute', '--only', 'db'], only, { migrate: async () => { throw new Error('no migrate under --only'); }, adopt: async () => { throw new Error('no adopt under --only'); } }), 0, only.err.join(''));
  assert.match(only.out.join(''), /only db: started; nothing else ran/u);
  assert.equal(only.calls.filter((call) => call.background).length, 0, 'no process starts under --only');
});

const SERVED = BLOCK.replace(
  '        - {name: api, argv: [node, api.mjs], port: api, files: [JWT_KEY], env: {PORT: "${port.api}"}}',
  '        - {name: api, argv: [node, --watch, api.mjs], port: api, files: [JWT_KEY], env: {PORT: "${port.api}"}, health: {url: "http://localhost:${port.api}/health/live"}, serve: {build: {argv: [npm, run, build:be], cwd: .}, argv: [node, dist/api.js], cwd: be}}',
);

test('the built mode of a process is judged: serve needs its argv, its build an argv, every path inside the app', () => {
  const judged = (serve: unknown) => normalizeLocal({ ports: { api: 3001, db: 54322 }, services: [{ name: 'db', wait: 'healthy' }], processes: [{ name: 'api', argv: ['node', 'api.mjs'], port: 'api', serve }] }, { project: 'demo', env: 'dev' });
  const good = judged({ build: { argv: ['npm', 'run', 'build'] }, argv: ['node', 'dist/main.js'], cwd: 'be' });
  assert.equal(good.problems.length, 0, JSON.stringify(good.problems));
  assert.deepEqual(good.config?.processes[0]?.serve, { argv: ['node', 'dist/main.js'], cwd: 'be', build: { argv: ['npm', 'run', 'build'], cwd: null } });
  assert.equal(normalizeLocal({ ports: { api: 3001, db: 54322 }, services: [{ name: 'db', wait: 'healthy' }], processes: [{ name: 'api', argv: ['node', 'api.mjs'] }] }, { project: 'demo', env: 'dev' }).config?.processes[0]?.serve, null, 'no serve block: the process runs its own argv');
  const text = (problems: Array<{ at: string; message: string }>): string => problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  assert.match(text(judged({ argv: ['node', 'x.js'], watch: true }).problems), /processes\[0\]\.serve\.watch/u);
  assert.match(text(judged({ argv: [] }).problems), /processes\[0\]\.serve\.argv: must hold the command that serves the built artifact/u);
  assert.match(text(judged({ argv: ['node', 'x.js'], build: { argv: [] } }).problems), /processes\[0\]\.serve\.build\.argv: must hold the build command/u);
  assert.match(text(judged({ argv: ['node', 'x.js'], cwd: '../x' }).problems), /processes\[0\]\.serve\.cwd: must be a relative path inside the app root/u);
  assert.match(text(judged({ argv: ['node', '${port.nope}'] }).problems), /serve of api: names the undeclared port nope/u);
});

test('up builds and serves the built artifact by default; the watcher runs only with --watch', async (t) => {
  const root = app(t, { block: SERVED });
  const served = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev'], served), 0, served.err.join(''));
  assert.match(served.out.join(''), /plan build api: npm run build:be/u);
  assert.match(served.out.join(''), /plan process api \(serve\): node dist\/api\.js/u);
  const up = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], up), 0, up.err.join(''));
  const build = up.calls.findIndex((call) => call.args.includes('build:be'));
  const start = up.calls.findIndex((call) => call.background);
  assert.ok(build >= 0 && build < start, 'the build runs before the built api starts');
  assert.deepEqual(up.calls[start]?.args.slice(-1), ['dist/api.js']);
  assert.equal(up.calls[build]?.env?.JWT_KEY_FILE, undefined, 'the build gets no custody file');
  assert.match(up.out.join(''), /process api: built, started \(pid 4242, built artifact\)/u);
  const watchRoot = app(t, { block: SERVED });
  const watched = host(watchRoot);
  assert.equal(await run(watchRoot, ['up', '--env', 'dev', '--execute', '--watch'], watched), 0, watched.err.join(''));
  assert.equal(watched.calls.some((call) => call.args.includes('build:be')), false, '--watch builds nothing');
  assert.ok(watched.calls.find((call) => call.background)?.args.includes('--watch'));
});

test('restart rebuilds and restarts only the named processes, waits for their health, and leaves compose, volumes and the tunnel alone', async (t) => {
  const root = app(t, { block: SERVED });
  const first = host(root);
  assert.equal(await run(root, ['restart', '--env', 'dev', '--process', 'api', '--execute'], first), 2, 'a stack that is not up is refused');
  assert.match(first.err.join(''), /STACK_LOCAL_NOT_UP/u);
  const up = host(root);
  assert.equal(await run(root, ['up', '--env', 'dev', '--execute'], up), 0, up.err.join(''));
  const started = up.calls.find((call) => call.background);
  const recorded = started ? [started.command, ...started.args].join(' ') : '';
  const dry = host(root);
  assert.equal(await run(root, ['restart', '--env', 'dev', '--process', 'api'], dry), 0, dry.err.join(''));
  assert.match(dry.out.join(''), /plan stop api \(pid 4242\)[\s\S]*plan build api[\s\S]*plan wait api: http:\/\/localhost:\$\{port\.api\}\/health\/live[\s\S]*dry run/u);
  assert.equal(dry.calls.some((call) => call.background), false);
  const unknown = host(root);
  assert.equal(await run(root, ['restart', '--env', 'dev', '--process', 'worker', '--execute'], unknown), 2);
  assert.match(unknown.err.join(''), /--process names no process of dev: worker \(declared: api\)/u);
  const killed: number[] = [];
  const again = host(root);
  assert.equal(await run(root, ['restart', '--env', 'dev', '--process', 'api', '--execute'], again, { alive: () => true, commandLine: () => recorded, kill: (pid) => killed.push(pid) }), 0, again.err.join(''));
  assert.deepEqual(killed, [4242], 'the running api is ended');
  assert.ok(again.calls.some((call) => call.args.includes('build:be')), 'the api is rebuilt');
  assert.equal(again.calls.filter((call) => call.background).length, 1, 'and started once');
  assert.equal(again.calls.some((call) => call.command === 'docker' && call.args.includes('compose') && (call.args.includes('up') || call.args.includes('down') || call.args.includes('restart'))), false, 'no compose service is touched');
  assert.match(again.out.join(''), /ok {4}ready api: http:\/\/localhost:3001\/health\/live answered 200/u);
  assert.match(again.out.join(''), /kept up: the compose services, their volumes, the custody files and the dev tunnel/u);
  const sick = host(root);
  sick.io.fetch = (async () => ({ status: 503, text: async () => '' })) as unknown as typeof fetch;
  assert.equal(await run(root, ['restart', '--env', 'dev', '--process', 'api', '--execute', '--timeout', '2'], sick, { alive: () => false }), 1);
  assert.match(sick.out.join(''), /FAIL {2}ready api[\s\S]*api is not healthy; read its log with: starci app stack logs --env dev --service api/u);
});

test('a restarted process is waited for over each tunnel hostname that routes its port, on its health path', async () => {
  const { restartProbes } = await import('../stack/local-restart.mjs');
  const health = { name: 'api', url: 'http://localhost:${port.api}/health/live', method: 'GET', status: 200, contains: null };
  const process = { name: 'api', argv: ['node'], cwd: 'be', heavy: 'none' as const, skipIfExists: null, env: {}, files: [], after: 'migrate' as const, port: 'api', health, serve: null };
  const local = { tunnel: { name: 't', routes: [{ name: 'api', host: 'api.dev.example.com', port: 'api' }, { name: 'web', host: 'dev.example.com', port: 'web' }] } } as unknown as Parameters<typeof restartProbes>[0];
  assert.deepEqual(restartProbes(local, process).map((row) => row.url), ['http://localhost:${port.api}/health/live', 'https://api.dev.example.com/health/live']);
  assert.deepEqual(restartProbes(local, { ...process, health: null }), []);
});

// The canonical surface of the secret, ci and db verbs (owner ruling cli-canonical-2026-10-30), through `main`: the environment as
// --env on every secret action, --db-url-env, --execute on db baseline and restamp, the dry default of `secret recipients`,
// `ci secret set`, `ci var set` and `ci local`, and the dry run of `db migrate` that carries the plan (exit 0 agree, 1 drift, 2
// refused). An old spelling is an unknown flag or operand and fails with exit 2. Every value here is a fake.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { SpawnSyncOptions } from 'node:child_process';
import { main } from './main.mjs';
import { app } from './helpers/hfs-secret-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { sha256 } from '../runtime/engine/digest.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const OWNER = `age1${'q'.repeat(58)}`;
const SERVER = `age1${'s'.repeat(58)}`;
const ENC = 'ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]';
const APP_WIDE = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;
const SECRET_VALUE = 'fake-secret-value-not-to-print';

/** Runs main and collects both streams. */
type MainOptions = NonNullable<Parameters<typeof main>[1]>;

async function run(argv: string[], options: MainOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { stdout: (text) => out.push(text), stderr: (text) => err.push(text), ...options });
  return { code, out: out.join(''), err: err.join('') };
}

// ---- secret

const MEMBER = `K1: ${ENC}\nK2: ${ENC}\nsops:\n  age:\n    - recipient: ${OWNER}\n      enc: |\n        -----BEGIN AGE ENCRYPTED FILE-----\n        YWdl\n        -----END AGE ENCRYPTED FILE-----\n  mac: ${ENC}\n  version: 3.13.2\n`;

test('every secret action but init names its environment with --env; a positional environment fails as an operand error, never as the slug', async (t) => {
  const { root, env } = app(t, { 'sepay.enc.yaml': MEMBER });
  const unset = await run(['secret', 'unset', '--env', 'dev', 'sepay', 'K1'], { cwd: root, env });
  assert.equal(unset.code, 0, unset.err);
  assert.equal(unset.out, 'dry run: would unset K1 from dev/sepay (1 key remain); add --execute\n');
  const listed = await run(['secret', 'list', '--env', 'dev'], { cwd: root, env });
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /K1/u);
  const audit = await run(['secret', 'audit', '--env', 'dev'], { cwd: root, env });
  assert.notEqual(audit.code, 2, audit.err);
  assert.equal((await run(['secret', 'audit'], { cwd: root, env })).code, audit.code, 'audit takes --env optionally');
  for (const action of ['set', 'get', 'unset', 'rename', 'remove', 'materialize', 'list', 'verify', 'recipients', 'migrate', 'split', 'server-key']) {
    const bare = await run(['secret', action], { cwd: root, env });
    assert.equal(bare.code, 2, action);
    assert.match(bare.err, new RegExp(`usage: starci app secret ${action} --env <env>`, 'u'), action);
  }
  for (const argv of [['secret', 'set', 'dev', 'sepay', 'K1'], ['secret', 'list', 'dev'], ['secret', 'unset', 'dev', 'sepay', 'K1'], ['secret', 'recipients', 'dev'], ['secret', 'audit', 'dev']]) {
    const old = await run(argv, { cwd: root, env });
    assert.equal(old.code, 2, argv.join(' '));
    assert.match(old.err, /usage: starci app secret/u, argv.join(' '));
  }
  const init = await run(['secret', 'init', '--env', 'dev'], { cwd: root, env });
  assert.equal(init.code, 2);
  assert.match(init.err, /--env is not valid for init/u);
});

test('secret recipients --add/--remove are dry until --execute: the dry run says what .sops.yaml would become and writes nothing', async (t) => {
  const { root, env } = app(t);
  const file = path.join(root, '.sops.yaml');
  fs.writeFileSync(file, `creation_rules:\n  - path_regex: '${APP_WIDE}'\n    age: ${OWNER}\n`);
  const before = fs.readFileSync(file, 'utf8');
  const dry = await run(['secret', 'recipients', '--env', 'production', '--add', SERVER], { cwd: root, env });
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out, `dry run: would set the production recipients of .sops.yaml to ${OWNER}, ${SERVER} (now ${OWNER}); add --execute\n`);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the dry run leaves .sops.yaml byte for byte');
  const dryRemove = await run(['secret', 'recipients', '--env', 'production', '--add', SERVER, '--remove', OWNER], { cwd: root, env });
  assert.equal(dryRemove.code, 0, dryRemove.err);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const refused = await run(['secret', 'recipients', '--env', 'production', '--remove', 'age1xxx'], { cwd: root, env });
  assert.equal(refused.code, 2, 'a refusal stays a refusal in the dry run');
  assert.equal((await run(['secret', 'recipients', '--env', 'production'], { cwd: root, env })).out, `production: ${OWNER}\n`);
  const executed = await run(['secret', 'recipients', '--env', 'production', '--add', SERVER, '--execute'], { cwd: root, env });
  assert.equal(executed.code, 0, executed.err);
  assert.equal(parseYaml(fs.readFileSync(file, 'utf8')).creation_rules[0].age, `${OWNER},${SERVER}`);
  assert.equal((await run(['secret', 'recipients', '--env', 'production', '--execute'], { cwd: root, env })).code, 2, '--execute alone has nothing to execute');
});

// ---- ci

const CI_DECLARATION = `ci:
  secrets:
    - name: DEPLOY_TOKEN
      scope: environment
      environment: production
  vars:
    - name: PUBLIC_HOST
      scope: repository
      value: https://example.invalid
    - name: VPS_USER
      scope: environment
      environment: production
      ownerValue: true
`;

function ciApp(t: TestContext) {
  const root = mkdtemp(t, 'hfs-canonical-ci-');
  fs.mkdirSync(path.join(root, '.starcistacks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), CI_DECLARATION);
  const calls: { command: string; args: string[]; input: unknown }[] = [];
  const spawn = (command: string, args: string[], options: SpawnSyncOptions) => {
    calls.push({ command, args: [...args], input: options?.input });
    return { status: 0, stdout: '', stderr: '' };
  };
  return { root, calls, tools: { spawn } };
}

test('ci secret set is dry until --execute: it names what it would set, reads no value, reaches no GitHub and never prints one', async (t) => {
  const { root, calls, tools } = ciApp(t);
  let reads = 0;
  const stdin = () => { reads += 1; return `${SECRET_VALUE}\n`; };
  const argv = ['ci', 'secret', 'set', 'DEPLOY_TOKEN', '--env', 'production', '--repo', 'example/app'];
  const dry = await run(argv, { cwd: root, tools, stdin, env: {} });
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out, 'dry run: would set secret DEPLOY_TOKEN (environment:production) from the value on stdin; add --execute\n');
  assert.equal(reads, 0);
  assert.deepEqual(calls, []);
  const refused = await run(['ci', 'secret', 'set', 'UNDECLARED', '--env', 'production'], { cwd: root, tools, stdin, env: {} });
  assert.equal(refused.code, 2, 'the dry run still judges the declaration');
  assert.match(refused.err, /^CI_NAME_UNDECLARED/u);
  const executed = await run([...argv, '--execute'], { cwd: root, tools, stdin, env: {} });
  assert.equal(executed.code, 0, executed.err);
  assert.equal(executed.out, 'set secret DEPLOY_TOKEN (environment:production)\n');
  assert.deepEqual(calls, [{ command: 'gh', args: ['secret', 'set', 'DEPLOY_TOKEN', '--env', 'production', '--repo', 'example/app'], input: SECRET_VALUE }]);
  for (const text of [dry.out, dry.err, executed.out, executed.err]) assert.ok(!text.includes(SECRET_VALUE));
});

test('ci var set is dry until --execute: public and owner-supplied variables are named, judged and left unwritten', async (t) => {
  const { root, calls, tools } = ciApp(t);
  let reads = 0;
  const stdin = () => { reads += 1; return `${SECRET_VALUE}\n`; };
  const dryPublic = await run(['ci', 'var', 'set', 'PUBLIC_HOST', '--repo', 'example/app'], { cwd: root, tools, stdin, env: {} });
  assert.equal(dryPublic.code, 0, dryPublic.err);
  assert.equal(dryPublic.out, 'dry run: would set variable PUBLIC_HOST (repository); add --execute\n');
  const dryOwner = await run(['ci', 'var', 'set', 'VPS_USER', '--env', 'production', '--repo', 'example/app'], { cwd: root, tools, stdin, env: {} });
  assert.equal(dryOwner.code, 0, dryOwner.err);
  assert.equal(dryOwner.out, 'dry run: would set variable VPS_USER (environment:production) from the value on stdin; add --execute\n');
  const drift = await run(['ci', 'var', 'set', 'PUBLIC_HOST', '--value', 'https://other.invalid'], { cwd: root, tools, stdin, env: {} });
  assert.equal(drift.code, 2, 'a value that differs from the manifest is refused in the dry run too');
  assert.match(drift.err, /^CI_VAR_DRIFT/u);
  const argvOwner = await run(['ci', 'var', 'set', 'VPS_USER', '--env', 'production', '--value', 'x'], { cwd: root, tools, stdin, env: {} });
  assert.equal(argvOwner.code, 2);
  assert.match(argvOwner.err, /^CI_VALUE_ARGV/u);
  assert.equal(reads, 0);
  assert.deepEqual(calls, [] as typeof calls);
  assert.equal((await run(['ci', 'var', 'set', 'PUBLIC_HOST', '--repo', 'example/app', '--execute'], { cwd: root, tools, stdin, env: {} })).code, 0);
  assert.equal((await run(['ci', 'var', 'set', 'VPS_USER', '--env', 'production', '--repo', 'example/app', '--execute'], { cwd: root, tools, stdin, env: {} })).code, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    ['variable', 'set', 'PUBLIC_HOST', '--body', 'https://example.invalid', '--repo', 'example/app'],
    ['variable', 'set', 'VPS_USER', '--body', SECRET_VALUE, '--env', 'production', '--repo', 'example/app'],
  ]);
  assert.equal(reads, 1);
});

test('ci local is dry by default (the plan, nothing run) and --execute runs it; --dry-run is an unknown argument', async (t) => {
  const root = mkdtemp(t, 'hfs-canonical-local-');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\njobs:\n  fast:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n');
  const logs = path.join(root, 'logs');
  const dry = await run(['ci', 'local'], { cwd: root });
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out, 'fast\n  skip actions/checkout - a GitHub action\n');
  const dryJson = await run(['ci', 'local', '--json', '--logs', logs], { cwd: root });
  assert.equal(dryJson.code, 0, dryJson.err);
  assert.deepEqual(JSON.parse(dryJson.out).map((instance: { label: string }) => instance.label), ['fast']);
  assert.equal(fs.existsSync(logs), false, 'the dry run creates no log directory');
  const old = await run(['ci', 'local', '--dry-run'], { cwd: root });
  assert.equal(old.code, 2);
  assert.match(old.err, /unknown argument --dry-run/u);
  const executed = await run(['ci', 'local', '--execute', '--logs', logs], { cwd: root });
  assert.equal(executed.code, 0, executed.err);
  assert.match(executed.out, /1 job instance\(s\)/u);
  assert.match(executed.out, /all 1 green/u);
  assert.equal(fs.existsSync(path.join(logs, 'fast.log')), true);
});

// ---- db

const DATABASE_URL = 'postgres://app@127.0.0.1:5432/app';
const FIRST = '20260101000000';
const SECOND = '20260102000000';
const TICK = { name: 'events-tick', schedule: '* * * * *', command: 'select 1' };

function dbApp(t: TestContext, { second = `select cron.schedule('${TICK.name}', '${TICK.schedule}', '${TICK.command}');\nselect pgmq.create('events');\n` }: { second?: string } = {}) {
  const root = mkdtemp(t, 'hfs-canonical-db-');
  fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'db', 'migrations', `${FIRST}_init.sql`), 'create table widgets (id int);\n');
  fs.writeFileSync(path.join(root, 'db', 'migrations', `${SECOND}_jobs.sql`), second);
  return root;
}

/** A psql double over a small database: the history, the cron jobs and the queues it holds; a `-1` transaction that marks a version applied records it. */
function psqlDouble({ history, cron = [], queues = [] }: { history: string[]; cron?: object[]; queues?: object[] }) {
  const calls: { command: string; args: string[] }[] = [];
  const state = { history: [...history], cron, queues };
  const spawn = (command: string, args: string[]) => {
    calls.push({ command, args: [...args] });
    const sql = args.at(-1) as string;
    const answer = (rows: unknown) => ({ status: 0, stdout: JSON.stringify(rows), stderr: '' });
    if (args.includes('-1')) {
      for (const argument of args) for (const match of argument.matchAll(/insert into supabase_migrations\.schema_migrations \(version, name\) values \('(\d{14})'/gu)) state.history.push(match[1] as string);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (sql.includes('as present')) return answer([{ present: true }]);
    if (sql.includes('as migrations,')) return answer([{ migrations: true, cron: true, queues: true }]);
    if (sql.includes('from supabase_migrations.schema_migrations')) return answer(state.history.map((version) => ({ version })));
    if (sql.includes('from cron.job')) return answer(state.cron);
    if (sql.includes('from pgmq.meta')) return answer(state.queues);
    return { status: 1, stdout: '', stderr: 'unexpected query' };
  };
  return { spawn, calls, state };
}

const agreeing = () => psqlDouble({
  history: [FIRST, SECOND],
  cron: [{ name: TICK.name, schedule: TICK.schedule, commandHash: sha256(TICK.command), active: true }],
  queues: [{ name: 'events' }],
});

const migrate = (root: string, argv: string[], double: ReturnType<typeof psqlDouble>, extra: MainOptions = {}) => run(['db', ...argv], { cwd: root, env: { ...process.env, DATABASE_URL, SOURCE_URL: DATABASE_URL }, stackIo: { spawn: double.spawn }, ...extra });

test('db migrate without --execute prints the plan and exits 0 when the repository and the database agree', async (t) => {
  const root = dbApp(t);
  const double = agreeing();
  const result = await migrate(root, ['migrate'], double);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Nothing to do\./u);
  assert.match(result.out, /^read-only database plan: repo and database agree$/mu);
  assert.match(result.out, /^migrations: repo 2, remote 2, missing 0, unexpected 0, changed 0$/mu);
  assert.match(result.out, /^cron: repo 1, remote 1, missing 0, unexpected 0, changed 0$/mu);
  assert.match(result.out, /^queues: repo 1, remote 1, missing 0, unexpected 0, changed 0$/mu);
  assert.ok(double.calls.every((call) => call.args.includes('-c') && !call.args.includes('-1')), 'read-only: no transaction');
  const json = await migrate(root, ['migrate', '--json'], agreeing());
  assert.equal(json.code, 0, json.err);
  const payload = JSON.parse(json.out);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.drift, false);
  assert.equal(payload.done, true);
  assert.deepEqual(payload.cron, { expected: 1, remote: 1, missing: 0, unexpected: 0, changed: 0 });
  const named = await run(['db', 'migrate', '--db-url-env', 'SOURCE_URL'], { cwd: root, env: { SOURCE_URL: DATABASE_URL }, stackIo: { spawn: agreeing().spawn } });
  assert.equal(named.code, 0, named.err);
});

test('db migrate without --execute exits 1 on drift: a migration still to apply, a changed cron job, a missing or extra queue', async (t) => {
  const root = dbApp(t);
  const pending = psqlDouble({ history: [FIRST], cron: [], queues: [] });
  const behind = await migrate(root, ['migrate'], pending);
  assert.equal(behind.code, 1, behind.err);
  assert.match(behind.out, /^forward +1 migration\(s\): 20260102000000_jobs\.sql$/mu);
  assert.match(behind.out, /^read-only database plan: drift detected$/mu);
  assert.match(behind.out, /^cron: repo 1, remote 0, missing 1, unexpected 0, changed 0$/mu);
  assert.ok(!pending.calls.some((call) => call.args.includes('-1')), 'a dry run applies nothing');
  const changed = psqlDouble({ history: [FIRST, SECOND], cron: [{ name: TICK.name, schedule: '*/5 * * * *', commandHash: sha256(TICK.command), active: true }], queues: [{ name: 'events' }] });
  const cron = await migrate(root, ['migrate'], changed);
  assert.equal(cron.code, 1, cron.err);
  assert.match(cron.out, /^cron: repo 1, remote 1, missing 0, unexpected 0, changed 1$/mu);
  const extra = psqlDouble({ history: [FIRST, SECOND], cron: agreeing().state.cron, queues: [{ name: 'events' }, { name: 'stray' }] });
  const queues = await migrate(root, ['migrate'], extra);
  assert.equal(queues.code, 1, queues.err);
  assert.match(queues.out, /^queues: repo 1, remote 2, missing 0, unexpected 1, changed 0$/mu);
  const json = await migrate(root, ['migrate', '--json'], psqlDouble({ history: [FIRST], cron: [], queues: [] }));
  assert.equal(json.code, 1);
  assert.equal(JSON.parse(json.out).drift, true);
});

test('db migrate without --execute exits 2 when the migrations or the inventory cannot be read', async (t) => {
  const dynamic = dbApp(t, { second: "do $$ begin execute 'select 1'; end $$;\n" });
  const refused = await migrate(dynamic, ['migrate'], agreeing());
  assert.equal(refused.code, 2);
  assert.match(refused.err, /dynamic migration blocks cannot prove database inventory/u);
  const root = dbApp(t);
  const base = agreeing();
  const broken = (command: string, args: string[]) => ((args.at(-1) as string).includes('from cron.job') ? { status: 0, stdout: 'not json', stderr: '' } : base.spawn(command, args));
  const bad = await run(['db', 'migrate'], { cwd: root, env: { ...process.env, DATABASE_URL }, stackIo: { spawn: broken } });
  assert.equal(bad.code, 2);
  const noUrl = await run(['db', 'migrate'], { cwd: root, env: { PATH: process.env.PATH }, stackIo: { spawn: agreeing().spawn } });
  assert.equal(noUrl.code, 2);
  assert.match(noUrl.err, /DATABASE_URL is not set/u);
});

test('db migrate --execute applies without the inventory; db plan and --url-env are unknown', async (t) => {
  const root = dbApp(t);
  const double = psqlDouble({ history: [FIRST], cron: [], queues: [] });
  const applied = await migrate(root, ['migrate', '--execute'], double);
  assert.equal(applied.code, 0, applied.err);
  assert.match(applied.out, /applied: 1 forward migration\(s\)/u);
  assert.ok(!applied.out.includes('read-only database plan'));
  assert.ok(!double.calls.some((call) => String(call.args.at(-1)).includes('cron.job')), 'the inventory is a dry-run read only');
  const plan = await migrate(root, ['plan'], agreeing());
  assert.equal(plan.code, 2);
  assert.match(plan.err, /starci app db takes new, baseline, restamp, migrate/u);
  const old = await migrate(root, ['migrate', '--url-env', 'SOURCE_URL'], agreeing());
  assert.equal(old.code, 2);
  assert.match(old.err, /unknown flag --url-env/u);
});

test('db baseline and db restamp take --execute and --db-url-env; --apply and --url-env are unknown options', async (t) => {
  const root = dbApp(t);
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ kind: 'app', edition: 'lite' }));
  for (const verb of ['baseline', 'restamp']) {
    const canonical = await run(['db', verb, '--db-url-env', 'lower_case', '--execute'], { cwd: root });
    assert.notEqual(canonical.code, 0);
    assert.ok(!canonical.err.includes('unknown or duplicate database option'), `${verb}: ${canonical.err}`);
    for (const flag of [['--apply'], ['--url-env', 'SOURCE_URL']]) {
      const old = await run(['db', verb, ...flag], { cwd: root });
      assert.equal(old.code, 2, `${verb} ${flag.join(' ')}`);
      assert.match(old.err, /unknown or duplicate database option/u, `${verb} ${flag.join(' ')}`);
    }
  }
});

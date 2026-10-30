// An in-container target (db/postgres.mjs inContainer, the first start of stack deploy --urgent): the client tool runs through docker exec in
// the database's own container against 127.0.0.1, each -f file is copied in first, and the password travels on stdin, never in argv or env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OWN_PASSWORD_SHELL, dbTarget, inContainer, ownContainerTarget, psqlTransaction, queryRows } from '../db/postgres.mjs';
import { stackContext } from '../stack/context.mjs';
import type { Spawn, SpawnOptions } from '../stack/context.mjs';

const URL = 'postgresql://supabase_admin:s3cret@nivo-postgres:5432/postgres';
const CONTAINER = 'abcdef0123456789';

interface Call { command: string; args: readonly string[]; options: SpawnOptions }

function recorder(answers: { stdout?: string } = {}) {
  const calls: Call[] = [];
  const spawn = ((command: string, args: readonly string[], options: SpawnOptions = {}) => {
    calls.push({ command, args, options });
    if (args[0] === 'exec' && args.includes('psql')) return { status: 0, stdout: answers.stdout ?? '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  }) as Spawn;
  return { calls, ctx: stackContext({ cwd: '.', env: { DATABASE_URL: URL }, spawn }) };
}

test('an in-container psql copies its -f files in, execs through docker and sends the password on stdin only', () => {
  const { calls, ctx } = recorder();
  const target = inContainer(dbTarget(ctx, 'DATABASE_URL'), CONTAINER);
  assert.ok(target.url.startsWith('postgresql://supabase_admin@127.0.0.1:5432/'));
  psqlTransaction(ctx, target, [{ file: 'db/bootstrap.sql' }, { sql: 'select 1' }]);
  assert.deepEqual(calls.map((call) => call.command), ['docker', 'docker', 'docker']);
  assert.deepEqual(calls[0]!.args, ['exec', CONTAINER, 'mkdir', '-p', '/tmp/starci-db']);
  assert.equal(calls[1]!.args[0], 'cp');
  assert.match(calls[1]!.args[2]!, /^abcdef0123456789:\/tmp\/starci-db\/\d+-bootstrap\.sql$/u);
  const exec = calls[2]!;
  assert.deepEqual(exec.args.slice(0, 6), ['exec', '-i', CONTAINER, 'sh', '-c', 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec "$@"']);
  assert.ok(exec.args.includes(calls[1]!.args[2]!.split(':')[1]!), 'psql reads the copied file');
  assert.equal(exec.options.input, 's3cret\n');
  for (const call of calls) {
    assert.ok(!call.args.join(' ').includes('s3cret'), 'the password is never in argv');
    assert.equal(call.options.env, undefined, 'docker keeps the transport environment (no env override)');
  }
});

test('an in-container query reads its rows from the exec output', () => {
  const { ctx } = recorder({ stdout: '[{"history":false,"public_tables":0}]\n' });
  const rows = queryRows(ctx, inContainer(dbTarget(ctx, 'DATABASE_URL'), CONTAINER), 'select 1');
  assert.deepEqual(rows, [{ history: false, public_tables: 0 }]);
});

// An own-credentials target (ownContainerTarget, the automatic deploy): the role and database are read from the container, the password is read
// INSIDE it from its POSTGRES_PASSWORD_FILE, and no value of this machine reaches the exec: no DATABASE_URL, no stdin password, no environment.
test('an own-credentials target holds no URL and no password on this machine', () => {
  const calls: Call[] = [];
  const spawn = ((command: string, args: readonly string[], options: SpawnOptions = {}) => {
    calls.push({ command, args, options });
    if (args.includes('printf') || String(args[4]).startsWith('printf')) return { status: 0, stdout: 'appowner\nappdb\n', stderr: '' };
    return { status: 0, stdout: '[{"n":1}]\n', stderr: '' };
  }) as Spawn;
  const ctx = stackContext({ cwd: '.', env: {}, spawn });
  const target = ownContainerTarget(ctx, CONTAINER);
  assert.equal(target.url, 'postgresql://appowner@127.0.0.1:5432/appdb');
  assert.deepEqual(target.env, {});
  assert.deepEqual(target.secrets, []);
  assert.equal(target.own, true);
  const rows = queryRows(ctx, target, 'select 1 as n');
  assert.deepEqual(rows, [{ n: 1 }]);
  const exec = calls.at(-1)!;
  assert.deepEqual(exec.args.slice(0, 5), ['exec', CONTAINER, 'sh', '-c', OWN_PASSWORD_SHELL]);
  assert.equal(exec.options.input, undefined, 'nothing is sent on stdin: the container reads its own secret file');
  assert.match(OWN_PASSWORD_SHELL, /POSTGRES_PASSWORD_FILE/u);
  assert.ok(calls.every((call) => call.options.env === undefined && call.options.input === undefined));
});

test('a container that answers something that is not a plain role and database name is refused', () => {
  const spawn = (() => ({ status: 0, stdout: 'bad;role\ndb\n', stderr: '' })) as unknown as Spawn;
  assert.throws(() => ownContainerTarget(stackContext({ cwd: '.', env: {}, spawn }), CONTAINER), /not a plain identifier/u);
});

// `starci app db baseline --squash` end to end. A source database (a scratch postgres:17-alpine container) carries a lite app's bootstrap and
// active chain: an extension to drop (hstore, in its own schema) with two functions reaching it, a kept extension (pg_trgm), an app role
// with a role-level search_path, schema grants on the bootstrap's extensions schema, in-schema and database-wide default privileges, and
// reference rows in two tables tied by a foreign key. The source publishes its port on 127.0.0.1 only, as the app's dev database does, so
// the verb must find a route to a loopback source on Docker Desktop and on a Linux engine alike. The verb must preview without writing,
// then write a baseline, a bootstrap section and a seed that replay green on a fresh database: grants present, seed rows present (twice
// applied), the dropped extension absent.
// A kept function calling an excluded one is refused with both names. Without a Docker daemon the verb refuses (exit 2) and so does the spec.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbBaselineMain } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import { BOOTSTRAP_SQUASH_BEGIN, BOOTSTRAP_SQUASH_END } from '../runtime/scripts/hfs/rules/database-constants.mjs';
import { baselineMarkers } from '../runtime/scripts/hfs/rules/database-baseline.mjs';
import { DEFAULT_DROPPED_EXTENSIONS, queueDropped } from '../runtime/scripts/hfs/db-squash.mjs';
import type { RenderedTarget } from '../sync/index.mjs';

const IMAGE = 'postgres:17-alpine';
const DOCKER = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const BOOTSTRAP = fs.readFileSync(new URL('../templates/app/db-bootstrap/db/bootstrap.sql', import.meta.url), 'utf8');
const STAMP = '20260101000000';
const NEXT = '20260201000000';
const MIGRATION = `db/migrations/${STAMP}_init.sql`;
const CHAIN = `create schema hstore_ext;
create extension hstore with schema hstore_ext;
create extension if not exists pg_trgm with schema extensions;
do $r$ begin if not exists (select 1 from pg_roles where rolname = 'app_be') then create role app_be login noinherit; end if; end $r$;
alter role app_be set search_path = public, extensions;
grant usage on schema extensions to app_be;
create schema be_access;
grant usage on schema be_access, public to app_be;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public grant select on tables to app_be;
create table public.plans (key text primary key, price numeric not null, meta jsonb);
create table public.plan_tiers (id bigint generated always as identity primary key, plan_key text not null references public.plans (key), tier int not null, unique (plan_key, tier));
create table public.notes (id serial primary key, body text);
create table be_access.audit (id bigint primary key, note text);
grant select, insert on public.plans to app_be;
grant select on be_access.audit to app_be;
create function public.kv_get(h hstore_ext.hstore, k text) returns text language sql as $$ select hstore_ext.fetchval(h, k) $$;
create function public.uses_queue() returns int language plpgsql as $$ begin perform hstore_ext.akeys(''::hstore_ext.hstore); return 1; end $$;
create function public.plain_add(a int, b int) returns int language sql as $$ select a + b $$;
grant execute on function public.plain_add(int, int) to app_be;
create view public.plan_names as select key from public.plans;
insert into public.plans values ('pro', 10, '{"a": 1}'), ('start', 0, null), ('o''k', 1.5, '[1, 2]');
insert into public.plan_tiers (plan_key, tier) values ('pro', 1), ('pro', 2), ('start', 1);
insert into public.notes (body) values ('not seeded');
create publication app_empty;
`;
const WRAPPER = 'create function public.wrapper() returns int language plpgsql as $$ begin return public.uses_queue(); end $$;\n';
const HISTORY = `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values ('${STAMP}', 'init');
`;

const docker = (args: string[], input?: string | undefined) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 1 << 28 });
const psql = (container: string, database: string, sql: string) => {
  const result = docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At', '-f', '-'], sql);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

function app(t: TestContext, chain: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-squash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ 'hfs.json': JSON.stringify({ kind: 'app', edition: 'lite' }), 'db/bootstrap.sql': BOOTSTRAP, [MIGRATION]: chain })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** The committed history the baseline's archive rules read: the one active migration, as committed. */
const committed = (chain: string) => (args: string[]) => {
  if (args[0] === 'merge-base') return { ok: true, stdout: 'base' };
  if (args[0] === 'ls-tree') return { ok: true, stdout: `${MIGRATION}\0` };
  return args[1] === `base:./${MIGRATION}` ? { ok: true, stdout: chain } : { ok: false, stdout: '' };
};

function squash(root: string, chain: string, port: string | number, database: string, extra: string[] = []) {
  let stdout = '';
  let stderr = '';
  const env = { ...process.env, SOURCE_DB_URL: `postgres://postgres:source@127.0.0.1:${port}/${database}` };
  const argv = ['--squash', '--db-url-env', 'SOURCE_DB_URL', '--stamp', NEXT, '--drop-extension', 'hstore', '--seed-tables', 'plan_tiers,plans', '--image', IMAGE, ...extra];
  const code = dbBaselineMain(argv, { cwd: root, env, git: committed(chain), stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

/** A source container: `source` holds the chain, `refusing` the chain plus a kept function calling an excluded one, `unrecorded` no history. */
function sourceContainer(t: TestContext) {
  const name = `starci-squash-spec-${randomBytes(4).toString('hex')}`;
  const started = docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=source', '-p', '127.0.0.1::5432', IMAGE]);
  assert.equal(started.status, 0, started.stderr);
  t.after(() => docker(['rm', '-f', name]));
  for (let tries = 0; docker(['exec', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-Atc', 'select 1']).status !== 0; tries += 1) {
    assert.ok(tries < 240, 'the source container did not start');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  psql(name, 'postgres', 'create database source; create database refusing; create database unrecorded;');
  psql(name, 'unrecorded', `${BOOTSTRAP}
${CHAIN}`);
  psql(name, 'source', `${BOOTSTRAP}\n${CHAIN}\n${HISTORY}`);
  psql(name, 'refusing', `${BOOTSTRAP}\n${CHAIN}${WRAPPER}\n${HISTORY}`);
  const port = /:(\d+)\s*$/.exec(docker(['port', name, '5432/tcp']).stdout.split('\n')[0]!)![1]!;
  return { name, port };
}

test('--squash without --db-url-env, and squash flags without --squash, are refused before any database is touched', (t) => {
  const root = app(t, CHAIN);
  let stderr = '';
  assert.equal(dbBaselineMain(['--squash'], { cwd: root, stderr: (text) => { stderr += text; } }), 2);
  assert.match(stderr, /pass --db-url-env NAME/);
  stderr = '';
  assert.equal(dbBaselineMain(['--seed-tables', 'plans'], { cwd: root, stderr: (text) => { stderr += text; } }), 2);
  assert.match(stderr, /belong to --squash/);
});

test('pgmq stays by default, and --drop-pgmq-queue matches names and * patterns only (no match drops nothing)', () => {
  assert.deepEqual(DEFAULT_DROPPED_EXTENSIONS, ['pg_net', 'pg_cron']);
  assert.equal(queueDropped('job_email', ['job_*']), true);
  assert.equal(queueDropped('events', ['job_*', 'mail']), false);
  assert.equal(queueDropped('mail', ['job_*', 'mail']), true);
  assert.equal(queueDropped('a.b', ['a*b']), true);
  assert.equal(queueDropped('anything', []), false);
});

test('squash previews, proves, writes four outputs that replay green, and refuses a kept caller of an excluded function', { timeout: 600_000 }, (t) => {
  if (!DOCKER) {
    const root = app(t, CHAIN);
    const run = squash(root, CHAIN, 1, 'source');
    assert.equal(run.code, 2);
    assert.match(run.stderr, /needs Docker/);
    return;
  }
  const source = sourceContainer(t);
  const root = app(t, CHAIN);

  const preview = squash(root, CHAIN, source.port, 'source');
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /^preview squash baseline db\/migrations\/20260201000000_baseline\.sql; archive 1 migrations/m);
  assert.match(preview.stdout, /^excluded public\.kv_get\(h hstore_ext\.hstore, k text\) \(reaches hstore_ext\)$/m);
  assert.match(preview.stdout, /^excluded public\.uses_queue\(\) \(reaches hstore_ext\)$/m);
  assert.match(preview.stdout, /^excluded publication app_empty \(publishes no table\)$/m);
  assert.match(preview.stdout, /^seed public\.plans: 3 row\(s\)$/m);
  assert.match(preview.stdout, /^seed public\.plan_tiers: 3 row\(s\)$/m);
  assert.match(preview.stdout, /^proof: bootstrap \+ baseline \+ seed \(twice\) replayed on postgres:17-alpine/m);
  assert.equal(fs.existsSync(path.join(root, 'db/seed.sql')), false);
  assert.equal(fs.readFileSync(path.join(root, 'db/bootstrap.sql'), 'utf8'), BOOTSTRAP);

  const applied = squash(root, CHAIN, source.port, 'source', ['--execute']);
  assert.equal(applied.code, 0, applied.stderr);
  const baseline = fs.readFileSync(path.join(root, `db/migrations/${NEXT}_baseline.sql`), 'utf8');
  const bootstrap = fs.readFileSync(path.join(root, 'db/bootstrap.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(root, 'db/seed.sql'), 'utf8');
  assert.deepEqual(baselineMarkers(baseline), [STAMP]);
  assert.ok(fs.existsSync(path.join(root, `db/migrations/archive/${STAMP}_init.sql`)));
  assert.equal(fs.existsSync(path.join(root, MIGRATION)), false);
  assert.match(baseline, /CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;/);
  assert.doesNotMatch(baseline.split('\n').filter((line) => !line.startsWith('--')).join('\n'), /hstore|kv_get|uses_queue/);
  assert.match(baseline, /GRANT SELECT,INSERT ON TABLE public\.plans TO app_be;/);
  assert.ok(bootstrap.startsWith(BOOTSTRAP));
  const section = bootstrap.slice(BOOTSTRAP.length);
  assert.ok(section.startsWith(BOOTSTRAP_SQUASH_BEGIN) && section.trimEnd().endsWith(BOOTSTRAP_SQUASH_END));
  assert.match(section, /create role "app_be"/);
  assert.match(section, /alter role "app_be" with login noinherit/);
  assert.match(section, /alter role "app_be" set search_path = public, extensions;/);
  assert.match(section, /GRANT USAGE ON SCHEMA extensions TO app_be;/);
  assert.match(section, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON FUNCTIONS FROM PUBLIC;/);
  assert.ok(seed.indexOf('"public"."plans"') < seed.indexOf('"public"."plan_tiers"'), 'a referenced table is seeded first');
  assert.match(seed, /overriding system value/);
  assert.match(seed, /on conflict do nothing;/);
  assert.doesNotMatch(seed, /not seeded/);

  // An independent replay of the written files on a fresh database of the same server.
  psql(source.name, 'postgres', 'create database replay;');
  for (const text of [bootstrap, baseline, seed, seed]) psql(source.name, 'replay', text);
  assert.equal(psql(source.name, 'replay', "select has_table_privilege('app_be', 'public.plans', 'INSERT'), has_schema_privilege('app_be', 'extensions', 'USAGE'), has_function_privilege('app_be', 'public.plain_add(int,int)', 'EXECUTE');"), 't|t|t');
  assert.equal(psql(source.name, 'replay', "select array_to_string(rolconfig, ';') from pg_roles where rolname = 'app_be';"), 'search_path=public, extensions');
  assert.equal(psql(source.name, 'replay', 'select (select count(*) from public.plans), (select count(*) from public.plan_tiers), (select count(*) from public.notes);'), '3|3|0');
  assert.equal(psql(source.name, 'replay', "select count(*) from pg_extension where extname = 'hstore';"), '0');
  assert.equal(psql(source.name, 'replay', "select count(*) from pg_namespace where nspname = 'hstore_ext';"), '0');
  assert.equal(psql(source.name, 'replay', "insert into public.plan_tiers (plan_key, tier) values ('o''k', 9) returning id;"), '4');

  const refusingChain = `${CHAIN}${WRAPPER}`;
  const refused = squash(app(t, refusingChain), refusingChain, source.port, 'refusing');
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /FUNCTION public\.wrapper\(\) references the excluded public\.uses_queue\(\)/);

  const unrecorded = squash(app(t, CHAIN), CHAIN, source.port, 'unrecorded');
  assert.equal(unrecorded.code, 2);
  assert.match(unrecorded.stderr, /the source records no migration history/);

  // A loopback source no route reaches is refused with each route's psql failure, its password withheld.
  const unreachable = squash(app(t, CHAIN), CHAIN, 1, 'source');
  assert.equal(unreachable.code, 2);
  assert.match(unreachable.stderr, /no container of postgres:17-alpine reaches the database SOURCE_DB_URL names:\n {2}psql against .+ failed: .+\n {2}psql against .+ failed: /);
  assert.doesNotMatch(unreachable.stderr, /postgres:source@/);
});

test('sync judges db/bootstrap.sql except the squash section, keeps that section on write, and flags a hand edit outside it', async (t) => {
  const { checkTargets, hashOf, writtenContent } = await import('../sync/index.mjs');
  const root = app(t, CHAIN);
  // reason: the sync checks read path, mode, content and hash of a target; the render scope is not needed for this section judgement.
  const target = { path: 'db/bootstrap.sql', mode: 'section', content: BOOTSTRAP, hash: hashOf(BOOTSTRAP) } as RenderedTarget;
  const section = `${BOOTSTRAP_SQUASH_BEGIN}\ncreate role "app_be";\n${BOOTSTRAP_SQUASH_END}\n`;
  const file = path.join(root, 'db/bootstrap.sql');
  fs.writeFileSync(file, `${BOOTSTRAP}${section}`);
  assert.equal(checkTargets(root, [target])[0]!.status, 'ok');
  assert.equal(writtenContent(target, `stale\n${section}`), `${BOOTSTRAP}${section}`);
  fs.writeFileSync(file, `${BOOTSTRAP}${section}grant all on schema public to app_be;\n`);
  assert.equal(checkTargets(root, [target])[0]!.status, 'drift');
  fs.writeFileSync(file, `${BOOTSTRAP}${BOOTSTRAP_SQUASH_BEGIN}\ncreate role "app_be";\n`);
  assert.equal(checkTargets(root, [target])[0]!.status, 'drift');
});

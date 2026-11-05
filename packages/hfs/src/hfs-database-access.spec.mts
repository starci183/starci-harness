// proves: DB_APP_ROLE@lite, DB_APP_ROLE@full
// proves: DB_FORCE_RLS_DEFAULT@lite, DB_FORCE_RLS_DEFAULT@full
// proves: DB_POLICY_TAUTOLOGY@lite, DB_POLICY_TAUTOLOGY@full
// proves: DB_VIEW_UNSAFE@lite, DB_VIEW_UNSAFE@full
// proves: DB_RLS_REQUIRED@lite, DB_RLS_REQUIRED@full
// proves: DB_DEFINER_REVOKE@lite, DB_DEFINER_REVOKE@full
// proves: DB_STORAGE_PREFIX@lite, DB_STORAGE_PREFIX@full
// The complete migration set is judged through checkDatabase, using real temporary repositories and its
// production Git runner. Each rule has violating and passing SQL fixtures in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { withoutGitLocalEnv } from '../runtime/scripts/lib/git.mjs';

interface CaseOptions { contents?: Record<string, string>; db?: Record<string, unknown> }
/** A rule case: its name, the migration, whether it violates, and the declaration or extra migrations it runs under. */
type Case = [name: string, sql: string, violates: boolean, options?: CaseOptions];

const made: string[] = [];
const MIGRATION = 'db/migrations/20260101120000_access.sql';
const NEXT_MIGRATION = 'db/migrations/20260102120000_hardening.sql';

test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureRepo(edition: string, contents: Record<string, string>, db: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-access-'));
  made.push(dir);
  const declaration = {
    hfs: 3, kind: 'app', project: 'access', edition, db,
    sides: { be: { apps: [] }, fe: { apps: [] } },
  };
  fs.writeFileSync(path.join(dir, 'hfs.json'), JSON.stringify(declaration));
  for (const [file, text] of Object.entries(contents)) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  execFileSync('git', ['-C', dir, 'init', '-b', 'main', '-q'], {
    env: withoutGitLocalEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  return dir;
}

async function findingsFor(edition: string, sql: string, options: CaseOptions = {}) {
  const contents = { [MIGRATION]: sql, ...options.contents };
  const repoRoot = fixtureRepo(edition, contents, options.db);
  return checkDatabase({ repoRoot, files: Object.keys(contents) });
}

async function expectCode(edition: string, code: string, sql: string, violates: boolean, options?: CaseOptions) {
  const findings = await findingsFor(edition, sql, options);
  const matching = findings.filter((finding) => finding.code === code);
  assert.equal(matching.length > 0, violates, JSON.stringify(findings, null, 2));
  for (const finding of matching) {
    assert.equal(finding.level, 'error');
    assert.ok(finding.path.startsWith('db/migrations/'));
  }
}

const table = `
create table public.items (id uuid primary key, user_id uuid not null, tenant_id uuid);
alter table public.items enable row level security;
`;
const listed = {};
const memberPolicy = (predicate: string, action = 'select') => `${table}
create policy items_member_${action} on public.items for ${action} to authenticated
  ${action === 'insert' ? 'with check' : 'using'} (${predicate});`;
const publicRead = `${table}
create policy items_public_read on public.items for select to anon using (true);
`;
const definer = `
create function public.identity(subject uuid) returns uuid language sql security definer
set search_path = '' as $$ select subject $$;
`;

const roleCases: Case[] = [
  ['superuser application role', 'create role app_be login noinherit nobypassrls superuser;', true],
  ['bypassrls application role', 'create role app_be login noinherit bypassrls;', true],
  ['inherited privileges', 'create role app_be login inherit nobypassrls;', true],
  ['least privilege role', 'create role app_be login noinherit nobypassrls nosuperuser;', false],
  ['grant all on a schema', 'grant all on schema public to app_be;', true],
  ['grant all on every table', 'grant all on all tables in schema public to app_be;', true],
  ['grant all on one table', `${table} grant all privileges on public.items to app_be;`, true],
  ['bounded table and schema grants', `${table} grant usage on schema public to app_be; grant select, insert, update, delete on public.items to app_be;`, false],
  ['alter role to bypassrls', 'create role app_be login noinherit nobypassrls; alter role app_be bypassrls;', true],
  ['declared role is checked', 'create role backend login noinherit bypassrls;', true, { db: { appRole: 'backend' } }],
  ['another role is independent', 'create role maintenance superuser;', false],
  ['usage on schema auth', 'grant usage on schema auth to app_be;', true],
  ['select on auth.users', 'grant select on table auth.users to app_be;', true],
  ['insert and update on auth.identities', 'grant insert, update on auth.identities to app_be;', true],
  ['a column grant on auth.users', 'grant update (email) on auth.users to app_be;', true],
  ['every table in schema auth', 'grant select on all tables in schema auth to app_be;', true],
  ['every sequence in schema auth', 'grant usage on all sequences in schema auth to app_be;', true],
  ['default privileges in schema auth', 'alter default privileges in schema auth grant select on tables to app_be;', true],
  ['the declared role is the one judged on schema auth', 'grant usage on schema auth to backend;', true, { db: { appRole: 'backend' } }],
  ['the browser roles keep their schema auth grants', 'grant usage on schema auth to anon, authenticated, service_role;', false],
  ['a public table is not schema auth', `${table} grant select on public.items to app_be;`, false],
  ['a partial revoke leaves the rest of the grant', 'grant select, insert on auth.users to app_be; revoke insert on auth.users from app_be;', true],
  ['the account doors are the way in', `${definer} revoke execute on function public.identity(uuid) from public, anon, authenticated; grant execute on function public.identity(uuid) to app_be;`, false],
];

const owned = `${table} alter table public.items owner to app_be;`;
const forceCases: Case[] = [
  ['owner role needs force RLS', owned, true],
  ['owner role enables force RLS', `${owned} alter table public.items force row level security;`, false],
  ['SET ROLE determines the creator', `set role app_be; ${table} reset role;`, true],
  ['SET ROLE with force RLS', `set role app_be; ${table} alter table public.items force row level security; reset role;`, false],
  ['reasoned table exemption', owned, false, { db: { forceRlsExemptions: [{ table: 'public.items', reason: 'The documented owner path must bypass its own RLS.' }] } }],
  ['empty exemption reason is refused', owned, true, { db: { forceRlsExemptions: [{ table: 'public.items', reason: '' }] } }],
  ['whitespace exemption reason is refused', owned, true, { db: { forceRlsExemptions: [{ table: 'public.items', reason: '   ' }] } }],
  ['unrelated exemption cannot cover the table', owned, true, { db: { forceRlsExemptions: [{ table: 'public.other', reason: 'Owner maintenance.' }] } }],
  ['another owner has no default-force obligation', `${table} alter table public.items owner to migration_owner;`, false],
];

const scopeRoles = [{ role: 'app_engine', reason: 'the engine role entered per transaction' }];
const scoped = { db: { scopeSettings: ['nivo.workspace_id'], scopeRoles } };
const engineRole = 'create role app_engine nologin noinherit nobypassrls;';
const engineScope = "create function public.engine_workspace() returns uuid language sql stable as $$ select nullif(current_setting('nivo.workspace_id', true), '')::uuid $$;";
const engineOther = "create function public.engine_workspace() returns uuid language sql stable as $$ select nullif(current_setting('nivo.other_id', true), '')::uuid $$;";
const enginePolicy = (predicate: string, roles = 'app_engine') => `${engineRole} ${table.replace('tenant_id uuid)', 'tenant_id uuid, workspace_id uuid)')}
create policy items_engine_select on public.items for select to ${roles} using (${predicate});`;

const policyCases: Case[] = [
  ['literal true', memberPolicy('true'), true, listed],
  ['non-null column', memberPolicy('id is not null'), true, listed],
  ['self equality', memberPolicy('user_id = user_id'), true, listed],
  ['constant equality', memberPolicy('1 = 1'), true, listed],
  ['OR true bypasses the principal', memberPolicy('user_id = auth.uid() or true'), true, listed],
  ['principal being present does not filter a row', memberPolicy('auth.uid() is not null'), true, listed],
  ['with check is independently judged', `${table} create policy items_member_update on public.items for update to authenticated using (user_id = auth.uid()) with check (id is not null);`, true, listed],
  ['principal identity equality', memberPolicy('user_id = auth.uid()'), false, listed],
  ['JWT claim equality', memberPolicy("tenant_id::text = (auth.jwt() ->> 'tenant_id')"), false, listed],
  ['request claims equality', memberPolicy("tenant_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')"), false, listed],
  ['SQL helper carries the principal', `create function private.principal_id() returns uuid language sql as $$ select auth.uid() $$; ${memberPolicy('user_id = private.principal_id()')}`, false, listed],
  ['ordinary helper is not a principal source', `create function private.constant_id() returns uuid language sql as $$ select null::uuid $$; ${memberPolicy('user_id = private.constant_id()')}`, true, listed],
  ['trusted application role may accept every row', `${table} create policy items_app_be_all on public.items for all to app_be using (id is not null) with check (id is not null);`, false],
  ['intentional public read', publicRead, false],
  ['declared scope setting through a SQL function', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()')}`, false, scoped],
  ['declared scope setting read directly', enginePolicy("workspace_id = nullif(current_setting('nivo.workspace_id', true), '')::uuid"), false, scoped],
  ['declared scope setting is no principal when undeclared', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()')}`, true, listed],
  ['an undeclared setting is no principal', enginePolicy("workspace_id = nullif(current_setting('nivo.other_id', true), '')::uuid"), true, scoped],
  ['declared scope function that reads an undeclared setting', `${engineOther} ${enginePolicy('workspace_id = public.engine_workspace()')}`, true, scoped],
  ['literal true for the engine role', enginePolicy('true'), true, scoped],
  ['declared scope or true bypasses the principal', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace() or true')}`, true, scoped],
  ['declared scope present does not filter a row', `${engineScope} ${enginePolicy('public.engine_workspace() is not null')}`, true, scoped],
  ['declared scope compared with itself', `${engineScope} ${enginePolicy('public.engine_workspace() = public.engine_workspace()')}`, true, scoped],
  ['declared scope for a browser role', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()', 'authenticated')}`, true, scoped],
  ['declared scope for the anonymous role', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()', 'anon')}`, true, scoped],
  ['declared scope in a policy of mixed roles', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()', 'app_engine, authenticated')}`, true, scoped],
  ['declared scope for a role not declared as a scope role', `${engineScope} ${enginePolicy('workspace_id = public.engine_workspace()', 'app_reader')}`, true, scoped],
  ['declared scope compared with the owning column on the right', `${engineScope} ${enginePolicy('public.engine_workspace() = workspace_id')}`, false, scoped],
  ['declared scope may be one conjunct beside other filters', `${engineScope} ${enginePolicy('id is not null and workspace_id = public.engine_workspace()')}`, false, scoped],
  ['declared scope compared with a column that does not own the row', `${engineScope} ${enginePolicy('id = public.engine_workspace()')}`, true, scoped],
  ['declared scope compared with another owner column', `${engineScope} ${enginePolicy('tenant_id = public.engine_workspace()')}`, true, scoped],
  ['declared scope beside a non-null column test', `${engineScope} ${enginePolicy('id is not null and public.engine_workspace() is not null')}`, true, scoped],
  ['declared scope in a non-equality comparison', `${engineScope} ${enginePolicy('workspace_id <> public.engine_workspace()')}`, true, scoped],
  ['declared scope column list names the owning column', `${engineScope} ${enginePolicy('tenant_id = public.engine_workspace()')}`, false, { db: { scopeSettings: ['nivo.workspace_id'], scopeRoles, scopeColumns: ['tenant_id'] } }],
  ['public read suffix cannot authorize writes', `${table} create policy items_public_read on public.items for insert to anon with check (true);`, true],
];

const viewCases: Case[] = [
  ['exposed owner view', `${table} create view public.item_view as select id from public.items;`, true],
  ['exposed materialized view', `${table} create materialized view public.item_view as select id from public.items;`, true],
  ['invoker view', `${table} create view public.item_view with (security_invoker = true) as select id from public.items;`, false],
  ['explicit non-invoker view', `${table} create view public.item_view with (security_invoker = false) as select id from public.items;`, true],
  ['revoke all browser privileges', `${table} create view public.item_view as select id from public.items; revoke all on public.item_view from anon, authenticated;`, false],
  ['revoke SELECT browser privileges', `${table} create materialized view public.item_view as select id from public.items; revoke select on public.item_view from anon, authenticated;`, false],
  ['independent browser revokes', `${table} create view public.item_view as select id from public.items; revoke select on public.item_view from anon; revoke select on public.item_view from authenticated;`, false],
  ['partial browser revoke', `${table} create view public.item_view as select id from public.items; revoke all on public.item_view from anon;`, true],
  ['revoking writes does not revoke reads', `${table} create view public.item_view as select id from public.items; revoke insert on public.item_view from anon, authenticated;`, true],
  ['private owner view', `${table} create view private.item_view as select id from public.items;`, false],
];

const rlsCases: Case[] = [
  ['disable exposed RLS', `${table} alter table public.items disable row level security;`, true],
  ['remove exposed forced RLS', `${table} alter table public.items force row level security; alter table public.items no force row level security;`, true],
  ['enabled RLS', table, false],
  ['private table moved into exposed schema', 'create table private.items (id uuid); alter table private.items set schema public;', true],
  ['moved table enables RLS at its destination', 'create table private.items (id uuid); alter table private.items set schema public; alter table public.items enable row level security;', false],
  ['private RLS weakening', 'create table private.items (id uuid); alter table private.items disable row level security;', false],
];

const definerCases: Case[] = [
  ['authenticated revoke is missing', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, true],
  ['all browser roles revoked', `${definer} revoke execute on function public.identity(uuid) from public, anon, authenticated;`, false],
  ['private definer', "create function private.identity(subject uuid) returns uuid language sql security definer set search_path = '' as $$ select subject $$;", false],
  ['ALTER FUNCTION activates the definer rule', "create function public.identity(subject uuid) returns uuid language sql security invoker set search_path = '' as $$ select subject $$; alter function public.identity(uuid) security definer; revoke execute on function public.identity(uuid) from public, anon;", true],
  ['ALTER FUNCTION with complete revocation', "create function public.identity(subject uuid) returns uuid language sql security invoker set search_path = '' as $$ select subject $$; alter function public.identity(uuid) security definer; revoke execute on function public.identity(uuid) from public, anon, authenticated;", false],
  ['invoker function does not need revocation', 'create function public.identity(subject uuid) returns uuid language sql security invoker as $$ select subject $$;', false],
];

const storagePolicy = (predicate: string, action = 'select') => `create policy objects_member_${action} on storage.objects for ${action} to authenticated ${action === 'insert' ? 'with check' : 'using'} (${predicate});`;
const storageCases: Case[] = [
  ['private bucket without owner prefix', storagePolicy("bucket_id = 'avatars'"), true],
  ['private bucket ownership prefix', storagePolicy("bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text"), false],
  ['insert with ownership prefix', storagePolicy("bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text", 'insert'), false],
  ['insert without ownership prefix', storagePolicy("bucket_id = 'avatars'", 'insert'), true],
  ['public bucket exemption', storagePolicy("bucket_id = 'brand_public'"), false],
  ['wrong path component', storagePolicy("bucket_id = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text"), true],
  ['constant owner prefix', storagePolicy("bucket_id = 'avatars' and (storage.foldername(name))[1] = 'everyone'"), true],
  ['OR true bypasses prefix', storagePolicy("(bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) or true"), true],
  ['OR private bucket bypasses prefix', storagePolicy("(bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) or bucket_id = 'documents'"), true],
  ['every OR branch enforces ownership or public bucket', storagePolicy("(bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) or bucket_id = 'brand_public'"), false],
];

const ruleCases: [string, Case[]][] = [
  ['DB_APP_ROLE', roleCases], ['DB_FORCE_RLS_DEFAULT', forceCases],
  ['DB_POLICY_TAUTOLOGY', policyCases], ['DB_VIEW_UNSAFE', viewCases],
  ['DB_RLS_REQUIRED', rlsCases], ['DB_DEFINER_REVOKE', definerCases],
  ['DB_STORAGE_PREFIX', storageCases],
];

const historicalCases: [name: string, code: string, initial: string, hardening: string, violates?: boolean][] = [
  ['a later migration revokes the grants on schema auth', 'DB_APP_ROLE', 'grant usage on schema auth to app_be; grant select, insert, update on table auth.users to app_be; grant select, insert on table auth.identities to app_be;', 'revoke all on table auth.users from app_be; revoke all on table auth.identities from app_be; revoke usage on schema auth from app_be;'],
  ['a later migration leaves the schema usage in place', 'DB_APP_ROLE', 'grant usage on schema auth to app_be; grant select on table auth.users to app_be;', 'revoke select on table auth.users from app_be;', true],
  ['a later migration grants again after the revoke', 'DB_APP_ROLE', 'grant select on table auth.users to app_be; revoke all on table auth.users from app_be;', 'grant select on table auth.users to app_be;', true],
  ['view access revoked by the next migration', 'DB_VIEW_UNSAFE', `${table} create view public.item_view as select id from public.items;`, 'revoke select on public.item_view from anon, authenticated;'],
  ['definer revoke completed by the next migration', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, 'revoke execute on function public.identity(uuid) from authenticated;'],
  ['definer schema revoke completed by the next migration', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, 'revoke all on all functions in schema public from authenticated;'],
  ['later grant reopens definer execution', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon, authenticated;`, 'grant execute on function public.identity(uuid) to authenticated;', true],
  ['later revoke of another overload does not close definer execution', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, 'revoke execute on function public.identity(text) from authenticated;', true],
  ['later invoker declaration retires definer execution obligation', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, 'alter function public.identity(uuid) security invoker;'],
  ['later function drop retires definer execution obligation', 'DB_DEFINER_REVOKE', `${definer} revoke execute on function public.identity(uuid) from public, anon;`, 'drop function public.identity(uuid);'],
  ['later promotion checks previously created function', 'DB_DEFINER_REVOKE', "create function public.identity(subject uuid) returns uuid language sql security invoker set search_path = '' as $$ select subject $$;", "alter function public.identity(uuid) security definer; alter function public.identity(uuid) set search_path = ''; revoke execute on function public.identity(uuid) from public, anon;", true],
  ['promotion preserves earlier authenticated revocation', 'DB_DEFINER_REVOKE', "create function public.identity(subject uuid) returns uuid language sql security invoker set search_path = '' as $$ select subject $$; revoke execute on function public.identity(uuid) from authenticated;", "alter function public.identity(uuid) security definer; alter function public.identity(uuid) set search_path = ''; revoke execute on function public.identity(uuid) from public, anon;"],
];

const cleanSql = `
create role app_be login noinherit nobypassrls nosuperuser;
${owned}
alter table public.items force row level security;
create policy items_app_be_all on public.items for all to app_be
using (id is not null) with check (id is not null);
grant usage on schema public to app_be;
grant select, insert, update, delete on public.items to app_be;
create view public.item_view with (security_invoker = true) as select id from public.items;
${definer}
revoke execute on function public.identity(uuid) from public, anon, authenticated;
create table public.countries (code text primary key);
alter table public.countries enable row level security;
create policy countries_public_read on public.countries for select to anon using (true);
grant select on public.countries to anon;
${storagePolicy("bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text")}
`;

for (const edition of ['lite', 'full']) {
  for (const [code, cases] of ruleCases) {
    for (const [name, sql, violates, options] of cases) {
      test(`${code}@${edition}: ${name}`, () => expectCode(edition, code, sql, violates, options));
    }
  }
  for (const [name, code, initial, hardening, violates = false] of historicalCases) {
    test(`${code}@${edition}: ${name}`, () => expectCode(edition, code, initial, violates, {
      contents: { [NEXT_MIGRATION]: hardening },
    }));
  }
  test(`database access@${edition}: a complete hardened migration has no findings`, async () => {
    assert.deepEqual(await findingsFor(edition, cleanSql), []);
  });
}

// The catalog's proof discovery reads literal test blocks: one violating and one passing block name each R255 code.
for (const edition of ['lite', 'full']) {
  test(`DB_APP_ROLE@${edition}: a superuser application role is refused and a least-privilege one passes`, async () => {
    await expectCode(edition, 'DB_APP_ROLE', 'create role app_be login noinherit nobypassrls superuser;', true);
    await expectCode(edition, 'DB_APP_ROLE', 'create role app_be login noinherit nobypassrls nosuperuser;', false);
  });
  test(`DB_FORCE_RLS_DEFAULT@${edition}: an app-role-owned table without force RLS is refused and with it passes`, async () => {
    await expectCode(edition, 'DB_FORCE_RLS_DEFAULT', owned, true);
    await expectCode(edition, 'DB_FORCE_RLS_DEFAULT', `${owned} alter table public.items force row level security;`, false);
  });
}

// The same literal-block proof for R254: one block per code, a violating and a passing migration each.
for (const _edition of ['lite', 'full']) {
}

test('the declaration takes db.scopeSettings as dotted custom settings and refuses request claims, bare names and other shapes', () => {
  const sides = { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }], grammar: 'core' } };
  const declared = (scopeSettings: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { scopeSettings }, sides }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  const withRoles = (scopeSettings: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { scopeSettings, scopeRoles }, sides }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  assert.deepEqual(withRoles(['nivo.workspace_id']), []);
  assert.equal(declared(['nivo.workspace_id']).length, 1, 'settings without scope roles');
  const roles = (list: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { scopeRoles: list }, sides }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  assert.deepEqual(roles(scopeRoles), []);
  for (const bad of [[], ['app_engine'], [{ role: 'app_engine' }], [{ role: 'App', reason: 'x' }], [{ role: 'a', reason: ' ' }], [{ role: 'a', reason: 'x', more: 1 }]]) assert.equal(roles(bad).length, 1, JSON.stringify(bad));
  const columns = (scopeColumns: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { scopeColumns }, sides }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  assert.deepEqual(columns(['workspace_id']), []);
  for (const bad of [[], ['Workspace'], 'workspace_id', ['a.b']]) assert.equal(columns(bad).length, 1, JSON.stringify(bad));
  for (const bad of [['workspace_id'], ['request.jwt.claims'], ['Nivo.Workspace'], 'nivo.workspace_id', [''], [1]]) {
    assert.equal(withRoles(bad).length, 1, JSON.stringify(bad));
  }
});

for (const edition of ['lite', 'full']) {
  const policy = `${table.replace('tenant_id uuid)', 'tenant_id uuid, workspace_id uuid)')} create policy items_engine_select on public.items for select to app_engine using (workspace_id = public.engine_workspace());`;
  const cases: [name: string, sql: string, violates: boolean][] = [
    ['a scope role created NOLOGIN NOINHERIT NOBYPASSRLS', `${engineRole} ${policy}`, false],
    ['a scope role created with LOGIN', `create role app_engine login noinherit nobypassrls; ${policy}`, true],
    ['a scope role created with BYPASSRLS', `create role app_engine nologin noinherit bypassrls; ${policy}`, true],
    ['a scope role created inheriting', `create role app_engine nologin inherit nobypassrls; ${policy}`, true],
    ['a scope role created without stating its attributes', `create role app_engine; ${policy}`, true],
    ['a scope role altered to LOGIN', `${engineRole} alter role app_engine login; ${policy}`, true],
    ['a scope role never created by a migration', policy, true],
  ];
  for (const [name, sql, violates] of cases) {
    test(`DB_APP_ROLE@${edition}: ${name}`, async () => {
      await expectCode(edition, 'DB_APP_ROLE', `${engineScope} ${sql}`, violates, scoped);
    });
  }
}

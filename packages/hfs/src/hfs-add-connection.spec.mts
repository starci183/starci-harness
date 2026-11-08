// hfs-add-connection.spec.mts - `starci app add connection <name> --owner <app>`: one more database connection of a full app. The verb declares it in
// hfs.json (every other byte kept), writes the platform/database files R84 asks for, registers its EntityManager token, adds the roster keys, the dev
// database (a native stack's role and URL file, or a compose service's secret) and the production secret (declared, granted, mounted, sealed), and
// writes nothing at all when it refuses. The judge (the architecture machine) passes on the result.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepository } from '../runtime/scripts/hfs/check.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { appendToArray } from '../scaffold/json-append.mjs';

type CodedError = Error & { code?: string };
const SCAFFOLDED = Date.parse('2026-10-25T00:00:00Z');
const MANIFEST = '.starcistacks/application-stacks.yaml';
const DATABASE = 'be/src/modules/platform/database';
const lockedOk = (root: string) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true as const };
};

function fullApp(t: TestContext, edition: 'full' | 'lite' = 'full'): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-add-connection-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({
    name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init, now: () => new Date(SCAFFOLDED),
  }).root;
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const write = (root: string, file: string, text: string) => fs.writeFileSync(path.join(root, ...file.split('/')), text);
const exists = (root: string, file: string) => fs.existsSync(path.join(root, ...file.split('/')));
const add = (root: string, name: string, options: { owner?: string; isolation?: string; envPrefix?: string } = { owner: 'core' }) => addKind({ repoRoot: root, noun: 'connection', name, options });

/** Every file of the tree with its text, to prove a refusal changed nothing. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, 'latin1');
    }
  };
  walk(root);
  return out;
}

/** True when `after` is `before` with lines added: every line of before survives in order. */
function onlyAdditions(before: string, after: string): boolean {
  const kept = after.split('\n');
  let at = 0;
  for (const line of before.split('\n')) {
    while (at < kept.length && kept[at] !== line) at += 1;
    if (at >= kept.length) return false;
    at += 1;
  }
  return true;
}

const refusal = (run: () => unknown): CodedError => {
  try { run(); } catch (error) { return error as CodedError; }
  return assert.fail('expected a refusal') as never;
};

/** The error codes the judge reports, with the tsconfig package a scaffolded app resolves from node_modules. */
function judged(root: string): string[] {
  const modules = path.join(root, 'node_modules', '@starci');
  if (!fs.existsSync(path.join(modules, 'tsconfig'))) {
    fs.mkdirSync(modules, { recursive: true });
    fs.symlinkSync(path.join(import.meta.dirname, '..', '..', 'tsconfig'), path.join(modules, 'tsconfig'), 'junction');
  }
  spawnSync('git', ['add', '-A'], { cwd: root });
  const result = checkRepository({ repoRoot: root });
  return result.findings.filter((finding: { level?: string }) => finding.level === 'error').map((finding: { code: string }) => finding.code).sort();
}

test('add connection declares the connection, its platform files, rosters, dev secret and production secret, keeping every other byte', (t) => {
  const root = fullApp(t);
  const baseline = judged(root);
  const files = ['hfs.json', `${DATABASE}/index.ts`, `${DATABASE}/database.module.ts`, MANIFEST, '.starcistacks/dev/runtime/env/KEYS.md', '.starcistacks/production/runtime/env/KEYS.md', '.starcistacks/dev/infra/compose/stack.yaml', '.starcistacks/production/infra/swarm/stack.yaml'];
  const before = Object.fromEntries(files.map((file) => [file, read(root, file)]));

  const result = add(root, 'ledger');

  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.connections.at(-1), { name: 'ledger', envPrefix: 'LEDGER_DB', owner: 'core', isolation: 'database' });
  // The token union of database.module.ts is rewritten to hold the new member; every other line of every file stays.
  const stable = (file: string) => before[file]!.replace(/\r\n/g, '\n').replace(/^type EntityManagerToken = .*\n/mu, '');
  for (const file of files) assert.ok(onlyAdditions(stable(file), read(root, file).replace(/\r\n/g, '\n').replace(', {member: ledger-db-url}]', ']')), `${file} only gained lines`);
  assert.deepEqual(result.created.slice(0, 3), [`${DATABASE}/ledger.connection.ts`, `${DATABASE}/ledger.config.ts`, `${DATABASE}/ledger.decorators.ts`]);
  assert.match(read(root, `${DATABASE}/ledger.connection.ts`), /export const LEDGER_CONNECTION = "ledger"/u);
  assert.match(read(root, `${DATABASE}/ledger.config.ts`), /env\.secret\("LEDGER_DB_URL"\)/u);
  assert.match(read(root, `${DATABASE}/ledger.decorators.ts`), /export const InjectLedgerEntityManager/u);
  assert.match(read(root, `${DATABASE}/index.ts`), /export \{ parseLedgerDatabaseConfig \} from "\.\/ledger\.config"/u);
  const module = read(root, `${DATABASE}/database.module.ts`);
  assert.match(module, /type EntityManagerToken = typeof PRIMARY_ENTITY_MANAGER \| typeof LEDGER_ENTITY_MANAGER/u);
  assert.match(module, /\[LEDGER_CONNECTION, LEDGER_ENTITY_MANAGER\],/u);
  for (const env of ['dev', 'production']) assert.match(read(root, `.starcistacks/${env}/runtime/env/KEYS.md`), /\| `LEDGER_DB_URL` \|/u);

  const manifest = parseYaml(read(root, MANIFEST));
  const member = manifest.environments.production.secrets.find((entry: { name: string }) => entry.name === 'ledger-db-url');
  assert.equal(member.runtimeName, 'demo-production-ledger-db-url-v1');
  assert.equal(member.where, 'secrets/ledger-db-url');
  const grant = manifest.environments.production.deploy.secrets.grants.find((entry: { service: string }) => entry.service === 'core');
  assert.deepEqual(grant.from.at(-1), { member: 'ledger-db-url' });
  const swarm = parseYaml(read(root, '.starcistacks/production/infra/swarm/stack.yaml'));
  assert.equal(swarm.services.core.environment.LEDGER_DB_URL_FILE, '/run/secrets/ledger-db-url');
  assert.deepEqual(swarm.services.core.secrets.at(-1), { source: 'ledger-db-url', target: 'ledger-db-url' });
  assert.deepEqual(swarm.secrets['ledger-db-url'], { external: true, name: 'demo-production-ledger-db-url-v1' });
  const dev = parseYaml(read(root, '.starcistacks/dev/infra/compose/stack.yaml'));
  assert.equal(dev.services.core.environment.LEDGER_DB_URL_FILE, '/run/secrets/ledger-db-url');
  assert.equal(dev.secrets['ledger-db-url'].file, '/run/starci-secrets/demo/dev/ledger-db-url');
  assert.ok(exists(root, '.starcistacks/production/secrets/ledger-db-url.enc'), 'the placeholder is sealed to the app recipient');
  assert.ok(result.notes?.some((note) => /compose ledger in the owner/u.test(note)));

  assert.deepEqual(judged(root), baseline, 'the judge (R84 connection-map included) reports nothing new');
});

test('a connection declared without its files is what R84 refuses, so the judge does hold the files the verb writes', (t) => {
  const root = fullApp(t);
  const baseline = judged(root);
  const declaration = JSON.parse(read(root, 'hfs.json'));
  declaration.sides.be.connections.push({ name: 'ghost', envPrefix: 'GHOST_DB', owner: 'core', isolation: 'database' });
  write(root, 'hfs.json', `${JSON.stringify(declaration, null, 2)}\n`);
  assert.ok(judged(root).includes('BE_CONNECTION_DUPLICATE'));
  assert.ok(!baseline.includes('BE_CONNECTION_DUPLICATE'));
});

test('a duplicate name, a foreign owner, a bad isolation or prefix and a lite app are refused and nothing is written', (t) => {
  const root = fullApp(t);
  const before = tree(root);
  assert.equal(refusal(() => add(root, 'primary')).code, 'HFS_ADD_EXISTS');
  assert.equal(refusal(() => add(root, 'ledger', {})).code, 'HFS_ADD_CONNECTION_OWNER');
  assert.equal(refusal(() => add(root, 'ledger', { owner: 'cli' })).code, 'HFS_ADD_CONNECTION_OWNER');
  assert.equal(refusal(() => add(root, 'ledger', { owner: 'nobody' })).code, 'HFS_ADD_CONNECTION_OWNER');
  assert.equal(refusal(() => add(root, 'ledger', { owner: 'core', isolation: 'table' })).code, 'HFS_ADD_CONNECTION_ISOLATION');
  assert.equal(refusal(() => add(root, 'ledger', { owner: 'core', envPrefix: 'lower' })).code, 'HFS_ADD_CONNECTION_PREFIX');
  assert.equal(refusal(() => add(root, 'ledger', { owner: 'core', envPrefix: 'PRIMARY_DB_EXTRA' })).code, 'HFS_ADD_CONNECTION_PREFIX');
  assert.equal(refusal(() => add(root, 'Ledger', { owner: 'core' })).code, 'HFS_ADD_NAME_INVALID');
  assert.deepEqual(tree(root), before);
  const lite = fullApp(t, 'lite');
  const liteBefore = tree(lite);
  assert.match(refusal(() => add(lite, 'ledger', { owner: 'api' })).message, /full edition only/u);
  assert.deepEqual(tree(lite), liteBefore);
});

test('a platform/database the canon shape does not match refuses before anything is written', (t) => {
  const root = fullApp(t);
  write(root, `${DATABASE}/database.module.ts`, read(root, `${DATABASE}/database.module.ts`).replace('type EntityManagerToken', 'type Token'));
  const before = tree(root);
  assert.equal(refusal(() => add(root, 'ledger')).code, 'HFS_ADD_WIRE_INVALID');
  assert.deepEqual(tree(root), before);
});

test('a second run for the same name is refused and changes nothing; a second connection joins the first', (t) => {
  const root = fullApp(t);
  add(root, 'ledger');
  const once = tree(root);
  assert.equal(refusal(() => add(root, 'ledger')).code, 'HFS_ADD_EXISTS');
  assert.deepEqual(tree(root), once);
  add(root, 'audit-trail', { owner: 'core', envPrefix: 'AUDIT_DB' });
  const module = read(root, `${DATABASE}/database.module.ts`);
  assert.match(module, /type EntityManagerToken =\n {4}\| typeof PRIMARY_ENTITY_MANAGER\n {4}\| typeof LEDGER_ENTITY_MANAGER\n {4}\| typeof AUDIT_TRAIL_ENTITY_MANAGER\n/u);
  assert.equal(JSON.parse(read(root, 'hfs.json')).sides.be.connections.length, 3);
  assert.match(read(root, '.starcistacks/production/runtime/env/KEYS.md'), /`AUDIT_DB_URL`/u);
  assert.ok(exists(root, '.starcistacks/production/secrets/audit-db-url.enc'));
});

test('a schema connection reads its schema key and hands the schema to both data sources', (t) => {
  const root = fullApp(t);
  const baseline = judged(root);
  add(root, 'tenant', { owner: 'core', isolation: 'schema' });
  assert.match(read(root, `${DATABASE}/tenant.config.ts`), /schema: env\.string\("TENANT_DB_SCHEMA"\)/u);
  assert.match(read(root, `${DATABASE}/database.options.ts`), /readonly schema\?: string/u);
  assert.match(read(root, `${DATABASE}/database.module.ts`), /connection\.schema === undefined/u);
  assert.match(read(root, `${DATABASE}/connection-source.client.ts`), /connection\.schema === undefined/u);
  assert.match(read(root, '.starcistacks/dev/runtime/env/KEYS.md'), /`TENANT_DB_SCHEMA`/u);
  assert.deepEqual(judged(root), baseline);
});

const NATIVE_DEV = `    local:
      ports: {db: 54322, core: 3001}
      services: [{name: db, wait: healthy}]
      # The owner's comment on the database block stays.
      database:
        service: db
        port: db
        urlEnv: PRIMARY_DB_URL
        password: {member: db, key: OWNER_PASSWORD}
        adminPassword: {member: db, key: ADMIN_PASSWORD}
      custody:
        - {member: db, key: ADMIN_PASSWORD, kind: password}
        - {member: db, key: OWNER_PASSWORD, kind: password}
      processes:
        - name: core
          argv: [node, core.mjs]
          port: core
          files: [JWT_KEY]
`;

test('a native dev stack gets the connection as a further database: role, password key in custody, URL file in the owner process, owner comments kept', (t) => {
  const root = fullApp(t);
  const text = read(root, MANIFEST);
  const start = text.indexOf('    local:');
  const end = text.indexOf('  production:');
  write(root, MANIFEST, `${text.slice(0, start)}${NATIVE_DEV}${text.slice(end)}`);
  const before = read(root, MANIFEST);

  add(root, 'ledger');

  const after = read(root, MANIFEST);
  assert.ok(onlyAdditions(before.replace(/\r\n/g, '\n').replace('    secrets: []\n', '    secrets:\n'), after.replace(/\r\n/g, '\n').replace(/files: \[JWT_KEY, LEDGER_DB_URL\]/u, 'files: [JWT_KEY]').replace(', {member: ledger-db-url}]', ']')), 'only additions besides the two flow lists it extends');
  assert.match(after, /# The owner's comment on the database block stays\./u);
  const dev = parseYaml(after).environments.dev;
  const { config, problems } = normalizeLocal(dev.local, { project: 'demo', env: 'dev' });
  assert.deepEqual(problems, []);
  assert.deepEqual(config?.databases.map((database) => [database.connection, database.role, database.name, database.urlEnv, database.password.key, database.service]), [['ledger', 'demo_dev_ledger', 'demo_dev_ledger', 'LEDGER_DB_URL', 'LEDGER_DB_PASSWORD', 'db']]);
  assert.deepEqual(dev.local.custody.at(-1), { member: 'db', key: 'LEDGER_DB_PASSWORD', kind: 'password' });
  assert.deepEqual(dev.local.processes[0].files, ['JWT_KEY', 'LEDGER_DB_URL']);
  assert.deepEqual(dev.secrets.at(-1), { name: 'ledger-db-password', member: 'db', key: 'LEDGER_DB_PASSWORD', where: 'secrets/db', recipientPolicy: dev.secrets.at(-1).recipientPolicy, keyCustody: dev.secrets.at(-1).keyCustody });
  const compose = parseYaml(read(root, '.starcistacks/dev/infra/compose/stack.yaml'));
  assert.equal(compose.services.core.environment.LEDGER_DB_URL_FILE, undefined, 'a native stack does not wire the compose file');
});

test('appendToArray keeps every other byte of an inline, a broken and an absent list, and CRLF endings', () => {
  const inline = '{ "sides": { "be": { "connections": [{ "name": "a" }], "x": 1 } } }\n';
  assert.equal(appendToArray(inline, ['sides', 'be', 'connections'], { name: 'b' }), '{ "sides": { "be": { "connections": [{ "name": "a" }, { "name": "b" }], "x": 1 } } }\n');
  const broken = '{\n  "be": {\n    "connections": [\n      {\n        "name": "a"\n      }\n    ],\n    "x": 1\n  }\n}\n';
  assert.equal(appendToArray(broken, ['be', 'connections'], { name: 'b' }), '{\n  "be": {\n    "connections": [\n      {\n        "name": "a"\n      },\n      {\n        "name": "b"\n      }\n    ],\n    "x": 1\n  }\n}\n');
  assert.equal(appendToArray(broken.replaceAll('\n', '\r\n'), ['be', 'connections'], { name: 'b' }).replaceAll('\r\n', '\n'), appendToArray(broken, ['be', 'connections'], { name: 'b' }));
  const absent = '{\n  "be": {\n    "apps": []\n  }\n}\n';
  assert.deepEqual(JSON.parse(appendToArray(absent, ['be', 'connections'], { name: 'a' })), { be: { apps: [], connections: [{ name: 'a' }] } });
  assert.equal(appendToArray(absent, ['be', 'connections'], { name: 'a' }), '{\n  "be": {\n    "apps": [],\n    "connections": [\n      {\n        "name": "a"\n      }\n    ]\n  }\n}\n');
  assert.equal(refusalOf(() => appendToArray('{ "be": 1 }', ['be', 'connections'], {})), 'HFS_ADD_JSON_EDIT');
});

function refusalOf(run: () => unknown): string | undefined {
  try { run(); } catch (error) { return (error as CodedError).code; }
  return undefined;
}

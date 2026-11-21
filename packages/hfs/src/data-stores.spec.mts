/** Every store that must be kept has an adapter (PROJECT-STACKS-14, R426): the data declaration's stores and derived entries against the stack's stateful components. */
// proves: DATA_STORE_INVALID
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dataStoreFindings, dataStoresFindings } from '../runtime/scripts/hfs/rules/data-stores.mjs';
import { statefulComponentsOf } from '../runtime/scripts/hfs/rules/stateful-components.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

// reason: stack declarations are YAML-shaped trees the assertions build and judge.
type Json = any;
const DB = 'be/src/modules/integrations/seed/database.adapter.ts';
const OBJECTS = 'be/src/modules/integrations/seed/storage.adapter.ts';
const ADAPTER = 'export class DatabaseStore implements StoreAdapter {}\n';
const SOURCES: Record<string, string> = { [DB]: ADAPTER, [OBJECTS]: 'export class StorageStore implements StoreAdapter {}\n' };
const tracked = new Set(Object.keys(SOURCES));
const source = (file: string): string | null => SOURCES[file] ?? null;
const codes = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code);

/** The smallest example of PROJECT-STACKS-14: a database and an object store, a Redis rebuilt from the outbox. */
const stack = (data: Json = {}): Json => ({
  schema: 'starci/application-stacks@1',
  components: { db: { role: 'stateful', image: 'postgres' }, minio: { role: 'stateful', image: 'minio' }, redis: { role: 'stateful', image: 'redis' }, api: { role: 'stateless', image: 'api' } },
  environments: { dev: {}, production: {} },
  data: {
    stores: [
      { id: 'database', kind: 'database', level: 'logical', component: 'db', adapter: { module: DB } },
      { id: 'storage', kind: 'storage', level: 'logical', component: 'minio', adapter: { module: OBJECTS } },
    ],
    derived: [{ component: 'redis', from: 'database', rebuild: 'the relay republishes the outbox' }],
    ...data,
  },
});
const run = (doc: Json): string[] => codes(dataStoreFindings(doc, tracked, source));

test('the smallest example is green, and a project with no stateful component and no data member is green', () => {
  assert.deepEqual(run(stack()), []);
  assert.deepEqual(run({ schema: 'x', components: { api: { role: 'stateless' } } }), []);
  assert.deepEqual(run({}), []);
});

test('the stateful definition is the one R267 uses: role, flag, database, volumes, declared backing', () => {
  const doc = { components: { a: { role: 'stateful' }, b: { stateful: true }, c: { database: { provider: 'x' } }, d: { volumes: ['v:/data'] }, e: { role: 'stateless' } }, backing: { db: { provider: 'neon' } } };
  assert.deepEqual(statefulComponentsOf(doc).sort(), ['a', 'b', 'c', 'd', 'db']);
});

test('DATA_STORE_INVALID: a stateful component that is no store and no derived entry; a store naming no component', () => {
  const missing = dataStoreFindings(stack({ derived: [] }), tracked, source);
  assert.deepEqual(codes(missing), ['DATA_STORE_INVALID']);
  assert.match(missing[0]!.message, /the stateful component redis is the component of no store and of no derived entry/);
  assert.deepEqual(run({ ...stack(), data: undefined }).length, 3, 'a stateful stack with no data member owes all three');
  const nobody = stack();
  nobody.data.stores[1].component = 'ghost';
  assert.deepEqual(run(nobody), ['DATA_STORE_INVALID', 'DATA_STORE_INVALID'], 'the ghost is no component, and minio is left uncovered');
  const backing = { components: {}, backing: { db: { provider: 'neon' } } };
  assert.deepEqual(run(backing), ['DATA_STORE_INVALID'], 'a declared backing owes a store');
  assert.deepEqual(run({ ...backing, data: { stores: [{ id: 'database', kind: 'database', level: 'logical', component: 'db', adapter: { module: DB } }] } }), []);
});

test('DATA_STORE_INVALID: a kind outside the closed list, a bad level, no id, a twin id', () => {
  const kind = stack();
  kind.data.stores[0].kind = 'queue';
  assert.deepEqual(run(kind), ['DATA_STORE_INVALID']);
  const level = stack();
  level.data.stores[0].level = 'logicalish';
  assert.deepEqual(run(level), ['DATA_STORE_INVALID']);
  const twin = stack();
  twin.data.stores[1].id = 'database';
  assert.deepEqual(run(twin), ['DATA_STORE_INVALID']);
  const noId = stack();
  delete noId.data.stores[0].id;
  assert.deepEqual(run(noId).includes('DATA_STORE_INVALID'), true);
  assert.deepEqual(run({ ...stack(), data: 'x' }).includes('DATA_STORE_INVALID'), true, 'a data member that is no mapping');
});

test('DATA_STORE_INVALID: the module is a tracked source file that implements StoreAdapter', () => {
  const absent = stack();
  delete absent.data.stores[0].adapter;
  assert.deepEqual(run(absent), ['DATA_STORE_INVALID']);
  const untracked = stack();
  untracked.data.stores[0].adapter.module = 'be/src/nowhere.ts';
  assert.deepEqual(run(untracked), ['DATA_STORE_INVALID']);
  const outside = stack();
  outside.data.stores[0].adapter.module = '../elsewhere.ts';
  assert.deepEqual(run(outside), ['DATA_STORE_INVALID'], 'a path that leaves the app root is refused');
  const bare = dataStoreFindings(stack(), tracked, (file) => (file === DB ? 'export class DatabaseStore {}\n' : source(file)));
  assert.deepEqual(codes(bare), ['DATA_STORE_INVALID']);
  assert.match(bare[0]!.message, /holds no class that implements StoreAdapter/);
  const generic = dataStoreFindings(stack(), tracked, (file) => (file === DB ? 'export class DatabaseStore extends Base implements Other, StoreAdapter {\n}\n' : source(file)));
  assert.deepEqual(generic, [], 'negative control: a class with several interfaces still implements it');
  const factory = dataStoreFindings(stack(), tracked, (file) => (file === DB ? 'export const databaseOf = (run: Runner): StoreAdapter =>\n    postgresStore({ id: "database", run })\n' : source(file)));
  assert.deepEqual(factory, [], 'a factory whose declared return type is StoreAdapter builds the store (a package store such as postgresStore)');
});

test('DATA_STORE_INVALID: adapter.command is an argv, and a store of a seed-backup or a seed-standard set must have one', () => {
  const backup = (): Json => stack({ sets: [{ id: 'shop-backup', purpose: 'seed-backup', stores: ['database'], environments: ['dev'], to: [{ driver: 'git', repository: 'x/shop-seed-backup-{env}' }] }] });
  assert.deepEqual(run(stack()), [], 'no backup set: a store needs no command');
  assert.deepEqual(run(backup()), ['DATA_STORE_INVALID'], 'the database is in a seed-backup set and has no command');
  const served = backup();
  served.data.stores[0].adapter.command = ['npx', 'starci-shop', 'data'];
  assert.deepEqual(run(served), [], 'negative control: the command is declared');
  for (const bad of [[], 'npx', [''], [7]]) {
    const wrong = backup();
    wrong.data.stores[0].adapter.command = bad;
    assert.deepEqual(run(wrong), ['DATA_STORE_INVALID'], JSON.stringify(bad));
  }
  const standard = stack({ sets: [{ id: 'shop-standard', purpose: 'seed-standard', stores: ['database'], environments: ['dev'], to: [] }] });
  assert.deepEqual(run(standard), ['DATA_STORE_INVALID'], 'the bring-up applies a standard through the door of the store: it needs the command');
  standard.data.stores[0].adapter.command = ['npx', 'starci-shop', 'data'];
  assert.deepEqual(run(standard), [], 'negative control: the door is declared');
  const project = stack({ sets: [{ id: 'shop-standard', purpose: 'seed-standard', stores: ['database'], environments: ['dev'], to: [], completeness: 'ext:catalogue' }] });
  assert.deepEqual(run(project), [], 'a project kind (completeness) reads its own standard: no door is needed');
});

test('DATA_STORE_INVALID: from names a declared store and rebuild is not empty', () => {
  const from = stack();
  from.data.derived[0].from = 'nothing';
  assert.deepEqual(run(from), ['DATA_STORE_INVALID']);
  const rebuild = stack();
  rebuild.data.derived[0].rebuild = ' ';
  assert.deepEqual(run(rebuild), ['DATA_STORE_INVALID']);
  const component = stack();
  component.data.derived[0].component = 'ghost';
  assert.deepEqual(run(component), ['DATA_STORE_INVALID', 'DATA_STORE_INVALID'], 'the ghost is no component and redis is left uncovered');
});

test('DATA_STORE_INVALID: from is optional (a source outside the project), and a from that is present names a declared store', () => {
  const outside = stack();
  outside.data.derived = [{ component: 'redis', rebuild: 'the cache re-fills from its upstream' }];
  assert.deepEqual(run(outside), [], 'a derived entry with no from and a rebuild is green');
  outside.data.derived[0].rebuild = '';
  assert.deepEqual(run(outside), ['DATA_STORE_INVALID'], 'no from still owes a rebuild');
  const empty = stack();
  empty.data.derived[0].from = '';
  assert.deepEqual(run(empty), ['DATA_STORE_INVALID'], 'a from that is present but empty names no store');
});

test('R426 over a work tree: the finder reads the stack declaration and the adapter sources', (t) => {
  const root = mkdtemp(t, 'hfs-data-stores-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('.starcistacks/application-stacks.yaml', [
    'schema: starci/application-stacks@1', 'components:', '  db: {role: stateful, image: postgres}', 'environments: {dev: {}}',
    'data:', '  stores:', `    - {id: database, kind: database, level: logical, component: db, adapter: {module: ${DB}}}`, '',
  ].join('\n'));
  write(DB, ADAPTER);
  const repo: Json = { kind: 'app', project: 'shop' };
  const all = ['.starcistacks/application-stacks.yaml', DB];
  assert.deepEqual(dataStoresFindings({ repoRoot: root, repo, isRoot: true, all }), []);
  assert.deepEqual(codes(dataStoresFindings({ repoRoot: root, repo, isRoot: true, all: ['.starcistacks/application-stacks.yaml'] })), ['DATA_STORE_INVALID'], 'an untracked adapter is refused');
  assert.deepEqual(dataStoresFindings({ repoRoot: root, repo, isRoot: false, all }), [], 'a side scope is judged by the root');
});

test('DATA_STORE_INVALID: the skeleton stack keeps its own stateful components covered (database a store, ingress and statics storage derived)', () => {
  const text = fs.readFileSync(new URL('../templates/app/skeleton/.starcistacks/application-stacks.yaml', import.meta.url), 'utf8').replaceAll(/\{\{[^}]*\}\}/gu, '1');
  const doc = parseYaml(text) as Json;
  const adapter = 'be/src/modules/integrations/seed/database.adapter.ts';
  assert.deepEqual(dataStoreFindings(doc, new Set([adapter]), () => 'export class DatabaseStore implements StoreAdapter {}\n').map(({ code, message }) => [code, message]), []);
});

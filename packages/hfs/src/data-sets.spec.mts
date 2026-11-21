/** Every copy is written through a driver (PROJECT-STACKS-14, R427): the data sets of the stack declaration, and no bring-up loads a backup. */
// proves: DATA_SET_INVALID
// proves: DATA_COPY_NAME
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { backupLoadedFindings, dataSetFindings, dataSetsFindings, environmentLabel, repositoryName, resolveRepository } from '../runtime/scripts/hfs/rules/data-sets.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: stack declarations are YAML-shaped trees the assertions build and judge.
type Json = any;
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const codes = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code);

/** The sets of the smallest example of PROJECT-STACKS-14. */
const sets = (): Json[] => [
  { id: 'shop-standard', purpose: 'seed-standard', stores: ['database'], environments: ['dev', 'production'], to: [{ driver: 'git', repository: 'https://github.com/example/shop-seed-standard' }], commit: COMMIT },
  { id: 'shop-backup', purpose: 'seed-backup', stores: ['database', 'storage'], environments: ['dev', 'production'], everyMinutes: 1440, to: [{ driver: 'git', repository: 'https://github.com/example/shop-seed-backup-{env}' }] },
];
const stack = (mutate: (set: Json[]) => void = () => undefined): Json => {
  const list = sets();
  mutate(list);
  return { environments: { dev: {}, production: {} }, data: { stores: [{ id: 'database' }, { id: 'storage' }], sets: list } };
};
const run = (mutate?: (set: Json[]) => void, checks: string[] = []): string[] => codes(dataSetFindings(stack(mutate), new Set(checks)));

test('the smallest example is green; no data member and no sets are green', () => {
  assert.deepEqual(run(), []);
  assert.deepEqual(codes(dataSetFindings({}, new Set())), []);
  assert.deepEqual(codes(dataSetFindings({ data: { stores: [] } }, new Set())), []);
});

test('repositoryName takes the last path segment without .git', () => {
  assert.equal(repositoryName('https://github.com/example/shop-seed-standard.git'), 'shop-seed-standard');
  assert.equal(repositoryName('git@github.com:example/shop-seed-backup-{env}'), 'shop-seed-backup-{env}');
  assert.equal(repositoryName('../shop-seed-standard/'), 'shop-seed-standard');
  assert.equal(repositoryName('D:\\data\\shop-seed-standard'), 'shop-seed-standard');
});

test('DATA_SET_INVALID: a purpose outside the list, unknown stores and environments, a missing or twin id', () => {
  assert.deepEqual(run((list) => { list[0].purpose = 'seed'; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].stores = ['ghost']; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].stores = []; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[1].environments = ['dev', 'staging']; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[1].id = 'shop-standard'; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { delete list[1].id; }), ['DATA_SET_INVALID']);
});

test('DATA_SET_INVALID: a driver outside {git, s3}, no destination, a git destination without a repository', () => {
  assert.deepEqual(run((list) => { list[0].to = [{ driver: 'ftp', repository: 'x' }]; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].to = []; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].to = [{ driver: 'git' }]; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].to = [{ driver: 's3', bucket: 'b' }]; }), [], 'negative control: an s3 destination is a driver of the list');
});

test('DATA_COPY_NAME: -seed-standard for a standard; {env} and -seed-backup-<env> for a backup', () => {
  assert.deepEqual(run((list) => { list[0].to[0].repository = 'https://github.com/example/shop-data'; }), ['DATA_COPY_NAME']);
  assert.deepEqual(run((list) => { list[0].to[0].repository = 'https://github.com/example/shop-seed-standard.git'; }), [], 'a .git suffix is not part of the name');
  assert.deepEqual(run((list) => { list[1].to[0].repository = 'https://github.com/example/shop-seed-backup'; }), ['DATA_COPY_NAME']);
  assert.deepEqual(run((list) => { list[1].to[0].repository = 'https://github.com/example/shop-seed-backup-production'; }), ['DATA_COPY_NAME'], 'a fixed environment name has no {env}');
  assert.deepEqual(run((list) => { list[1].to[0].repository = 'https://github.com/example/shop-{env}-seed-backup'; }), ['DATA_COPY_NAME', 'DATA_COPY_NAME'], 'the name must END -seed-backup-<env>, for each environment');
});

test('DATA_COPY_NAME: <env> is the environment short name, else its name; a short is lowercase kebab of at most 12 and unique', () => {
  const withShort = (short: unknown, mutate: (list: Json[]) => void = () => undefined): string[] => {
    const doc = stack(mutate);
    doc.environments.production.short = short;
    return codes(dataSetFindings(doc, new Set()));
  };
  assert.deepEqual(withShort('prod'), [], 'production with short prod and the template ...-seed-backup-{env} resolves to -seed-backup-prod');
  assert.equal(resolveRepository(repositoryName('https://github.com/example/shop-seed-backup-{env}'), environmentLabel({ production: { short: 'prod' } }, 'production')), 'shop-seed-backup-prod');
  assert.equal(environmentLabel({ production: {} }, 'production'), 'production', 'no short: the name');
  assert.equal(environmentLabel(undefined, 'dev'), 'dev');
  assert.deepEqual(withShort('prod', (list) => { list[1].to[0].repository = 'https://github.com/example/shop-seed-backup-{env}-x'; }), ['DATA_COPY_NAME', 'DATA_COPY_NAME'], 'the name must still END -seed-backup-<env>');
  assert.deepEqual(withShort('Prod'), ['DATA_COPY_NAME'], 'not lowercase');
  assert.deepEqual(withShort('a-very-long-name'), ['DATA_COPY_NAME'], 'over 12 characters');
  assert.deepEqual(withShort('dev'), ['DATA_COPY_NAME'], 'two environments with one label: dev and production would share a repository');
  assert.deepEqual(withShort(7), ['DATA_COPY_NAME']);
});

test('DATA_SET_INVALID: maxAgeMinutes belongs to a backup, as a whole number', () => {
  assert.deepEqual(run((list) => { list[1].maxAgeMinutes = 720; }), [], 'negative control');
  assert.deepEqual(run((list) => { list[0].maxAgeMinutes = 720; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[1].maxAgeMinutes = 0; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[1].maxAgeMinutes = 'day'; }), ['DATA_SET_INVALID']);
});

test('DATA_SET_INVALID: a standard carries a 40-hex commit', () => {
  assert.deepEqual(run((list) => { delete list[0].commit; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].commit = 'main'; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].commit = COMMIT.toUpperCase(); }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].force = true; }), [], 'negative control: force on a pinned standard is lawful');
});

test('DATA_SET_INVALID: force and commit on a backup, everyMinutes on a standard, a non-boolean force', () => {
  assert.deepEqual(run((list) => { list[1].force = true; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[1].commit = COMMIT; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].everyMinutes = 60; }), ['DATA_SET_INVALID']);
  assert.deepEqual(run((list) => { list[0].force = 'yes'; }), ['DATA_SET_INVALID']);
});

test('DATA_SET_INVALID: completeness is ext:<id> of a check ext/manifest.json declares', () => {
  const complete = (value: unknown) => (list: Json[]): void => { list[0].completeness = value; };
  assert.deepEqual(run(complete('ext:shop-complete'), ['shop-complete']), []);
  assert.deepEqual(run(complete('ext:shop-complete'), []), ['DATA_SET_INVALID']);
  assert.deepEqual(run(complete('shop-complete'), ['shop-complete']), ['DATA_SET_INVALID']);
  assert.deepEqual(run(complete(7), []), ['DATA_SET_INVALID']);
});

test('DATA_SET_INVALID: no seeds.yaml entry of any level, nor a document it names, mentions a -seed-backup repository', () => {
  const files: Record<string, string> = {
    '.starcistacks/seeds/seeds.yaml': 'schema: starci/seeds@1\nentries:\n  - {id: plans, kind: data, path: data/plans.json, target: [node, a], mode: once}\n',
    '.starcistacks/seeds/data/plans.json': '{"plans":[]}\n',
    '.starcistacks/dev/seeds/seeds.yaml': 'schema: starci/seeds@1\nentries:\n  - {id: demo, kind: data, path: data, target: [node, a], mode: once}\n  - {id: restore, kind: data, path: data/x.json, target: [node, "restore", "https://h/shop-seed-backup-dev"], mode: once}\n',
    '.starcistacks/dev/seeds/data/demo.json': '{"from":"https://github.com/example/shop-seed-backup-dev"}\n',
    '.starcistacks/dev/seeds/data/x.json': '{}\n',
  };
  const all = Object.keys(files);
  const findings = backupLoadedFindings(all, (file) => files[file] ?? null);
  assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [
    ['DATA_SET_INVALID', '.starcistacks/dev/seeds/data/demo.json'],
    ['DATA_SET_INVALID', '.starcistacks/dev/seeds/seeds.yaml'],
  ]);
  assert.deepEqual(backupLoadedFindings(all.filter((file) => !file.includes('/dev/')), (file) => files[file] ?? null), [], 'negative control: the shared level alone is clean');
  assert.deepEqual(backupLoadedFindings(['.starcistacks/seeds/seeds.yaml'], () => 'entries: [unclosed'), [], 'a manifest that does not parse is another rule\'s finding');
});

test('R427 over a work tree: the finder reads the stack declaration, ext/manifest.json and the seed levels', (t) => {
  const root = mkdtemp(t, 'hfs-data-sets-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('.starcistacks/application-stacks.yaml', [
    'schema: starci/application-stacks@1', 'environments: {dev: {}}', 'data:', '  stores: [{id: database}]', '  sets:',
    `    - {id: s, purpose: seed-standard, stores: [database], environments: [dev], to: [{driver: git, repository: ../shop-seed-standard}], commit: ${COMMIT}, completeness: "ext:complete"}`, '',
  ].join('\n'));
  write('ext/manifest.json', JSON.stringify({ schema: 'starci/project-ext@1', checks: [{ id: 'complete', run: 'ext/checks/complete.mjs', why: 'x' }] }));
  const repo: Json = { kind: 'app', project: 'shop' };
  const all = ['.starcistacks/application-stacks.yaml', 'ext/manifest.json'];
  assert.deepEqual(dataSetsFindings({ repoRoot: root, repo, isRoot: true, all }), []);
  fs.rmSync(path.join(root, 'ext/manifest.json'));
  assert.deepEqual(codes(dataSetsFindings({ repoRoot: root, repo, isRoot: true, all })), ['DATA_SET_INVALID']);
  assert.deepEqual(dataSetsFindings({ repoRoot: root, repo, isRoot: false, all }), [], 'a side scope is judged by the root');
});

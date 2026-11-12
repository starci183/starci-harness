/** A project's business data lives in git only in its private data repository `<project>-data`, sealed with sops (PROJECT-STACKS-13, R400): the hfs check and the commit hook's data guard. */
// proves: HFS_DATA_IN_CODE@lite
// proves: HFS_DATA_IN_CODE@full
// proves: HFS_DATA_DEPENDENCY@lite
// proves: HFS_DATA_DEPENDENCY@full
// proves: STACKS_DATA_REPOSITORY@lite
// proves: HFS_DATA_UNSEALED@lite
// proves: HFS_DATA_UNSEALED@full
// proves: HFS_DATA_MANIFEST_DRIFT@lite
// proves: HFS_DATA_MANIFEST_DRIFT@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataBoundaryFindings, dataDependencyFindings, dataInCodeFindings, dataRepositoryDeclared, dataRepositoryFindings, stackDataFindings } from '../runtime/scripts/hfs/rules/data-repository.mjs';
import { judge } from '../sync/hygiene.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: the fixtures are JSON documents of the data format the assertions build and judge.
type Json = any;
const ENC = 'ENC[AES256_GCM,data:bm8=,iv:aXZpdml2aXZpdml2aXZpdg==,tag:dGFndGFndGFndGFndGFndA==,type:str]';
const SOPS = { age: [{ recipient: 'age1qqqq', enc: '-----BEGIN AGE ENCRYPTED FILE-----\nx\n-----END AGE ENCRYPTED FILE-----\n' }], lastmodified: '2026-01-01T00:00:00Z', mac: ENC, unencrypted_suffix: '_unencrypted', version: '3.13.2' };
const json = (value: Json): string => `${JSON.stringify(value, null, 2)}\n`;
const plaintext = (count: number): Json => ({ exportedAt: '2026-01-01T00:00:00.000Z', items: Array.from({ length: count }, (_, index) => ({ code: `C${String(index)}`, name: 'n' })), schema: 'shop-data/customers@1', source: 'export' });
/** A record file as sops seals it: every value ENC[...], an empty string left as it is, the sops block with its mac. */
const sealed = (count: number): Json => ({ exportedAt: ENC, items: Array.from({ length: count }, () => ({ code: ENC, note: '', name: ENC })), schema: ENC, source: ENC, sops: SOPS });
const SHA = 'a'.repeat(64);
const manifest = (files: Json[]): Json => ({ files, format: 'shop-data@1', snapshotAt: '2026-01-01T00:00:00.000Z', source: 'export' });
const entry = (entity: string, items: number, extra: Json = {}): Json => ({ entity, items, path: `data/${entity}.json`, schema: `shop-data/${entity}@1`, sha256: SHA, ...extra });
const codes = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code);

test('HFS_DATA_IN_CODE: a data manifest and a record file, plaintext or sealed, are refused in a code project; other JSON is not', () => {
  assert.deepEqual(codes(dataInCodeFindings('manifest.json', json(manifest([entry('customers', 1)])))), ['HFS_DATA_IN_CODE']);
  const dump = dataInCodeFindings('be/fixtures/customers.json', json(plaintext(2)));
  assert.deepEqual(codes(dump), ['HFS_DATA_IN_CODE']);
  assert.match(dump[0]!.message, /is a plaintext record file of a data repository; business data lives in git only in the private <project>-data repository/);
  assert.match(dataInCodeFindings('data/customers.json', json(sealed(1)))[0]!.message, /sealed record file/);
  assert.deepEqual(dataInCodeFindings('package.json', json({ name: 'shop', items: [] })), [], 'an items list without the format marker is no record file');
  assert.deepEqual(dataInCodeFindings('seeds/plans.json', json({ schema: 'starci/seeds@1', items: [] })), [], 'a schema id outside a data format is not one');
  assert.deepEqual(dataInCodeFindings('manifest.json', json({ format: 'shop@1', files: [] })), [], 'a manifest of another format is not one');
  assert.deepEqual(dataInCodeFindings('notes.md', json(plaintext(1))), [], 'only JSON documents are judged');
});

test('HFS_DATA_DEPENDENCY: package.json, a submodule or a tsconfig path naming <project>-data is refused; a longer name and prose are not', () => {
  const dependency = dataDependencyFindings('package.json', json({ name: 'shop', dependencies: { 'shop-data': 'git+ssh://git@example.test/owner/shop-data.git' } }), 'shop-data');
  assert.deepEqual(codes(dependency), ['HFS_DATA_DEPENDENCY']);
  assert.match(dependency[0]!.message, /names the data repository shop-data in dependencies; a code project never depends on its data repository's content/);
  assert.match(dataDependencyFindings('be/package.json', json({ workspaces: ['../shop-data'] }), 'shop-data')[0]!.message, /in workspaces/);
  assert.match(dataDependencyFindings('.gitmodules', '[submodule "data"]\n\tpath = data\n\turl = ../shop-data.git\n', 'shop-data')[0]!.message, /in a submodule/);
  assert.match(dataDependencyFindings('tsconfig.json', json({ compilerOptions: { paths: { '@data/*': ['../shop-data/data/*'] } } }), 'shop-data')[0]!.message, /in a path/);
  assert.deepEqual(dataDependencyFindings('package.json', json({ dependencies: { 'shop-data-client': '1.0.0' } }), 'shop-data'), [], 'a longer name is another package');
  assert.deepEqual(dataDependencyFindings('package.json', json({ description: 'backed up to shop-data' }), 'shop-data'), [], 'only the dependency fields count');
  assert.deepEqual(dataDependencyFindings('README.md', 'Back up with git push in shop-data.\n', 'shop-data'), [], 'prose that names the repository is no dependency');
});

test('STACKS_DATA_REPOSITORY: the stack declaration names exactly <project>-data, private', () => {
  assert.deepEqual(stackDataFindings('shop', { data: { repository: 'shop-data', private: true } }), []);
  assert.deepEqual(stackDataFindings('shop', {}), [], 'a project without a data repository declares none');
  const wrong = stackDataFindings('shop', { data: { repository: 'shop-lite-data', private: false } });
  assert.deepEqual(codes(wrong), ['STACKS_DATA_REPOSITORY']);
  assert.match(wrong[0]!.message, /repository must be shop-data \(the project's name with -data\); private must be true/);
});

test('R400 the hfs check: an app root that tracks a record dump, depends on its data repository and misnames it is refused', (t) => {
  const root = mkdtemp(t, 'hfs-data-boundary-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', json({ name: 'shop', devDependencies: { 'shop-data': 'file:../shop-data' } }));
  write('be/test/customers.json', json(plaintext(1)));
  write('fe/messages/en.json', json({ title: 'Shop' }));
  write('.starcistacks/application-stacks.yaml', 'schema: starci/application-stacks@1\ndata: {repository: shop-data, private: false}\n');
  const repo: Json = { kind: 'app', project: 'shop' };
  const all = ['package.json', 'be/test/customers.json', 'fe/messages/en.json', '.starcistacks/application-stacks.yaml'];
  const findings = dataBoundaryFindings({ repoRoot: root, repo, isRoot: true, all });
  assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [['HFS_DATA_DEPENDENCY', 'package.json'], ['HFS_DATA_IN_CODE', 'be/test/customers.json'], ['STACKS_DATA_REPOSITORY', '.starcistacks/application-stacks.yaml']]);
  assert.deepEqual(dataBoundaryFindings({ repoRoot: root, repo, isRoot: false, all }), [], 'a side scope is judged by the root');
});

test('R400 a data repository: every data/ file sealed, the manifest lists exactly them with their counts', () => {
  const files = { 'data/customers.json': json(sealed(2)), 'data/contacts.json': json(sealed(0)) };
  const read = (file: string): string | null => (files as Record<string, string>)[file] ?? null;
  const lawful = json(manifest([entry('customers', 2), entry('contacts', 0)]));
  assert.equal(dataRepositoryDeclared(lawful, null), 'shop-data', 'a root data manifest and no hfs.json declare a data repository');
  assert.equal(dataRepositoryDeclared(lawful, '{"kind":"app"}'), null, 'a code project is never one');
  assert.deepEqual(dataRepositoryFindings({ manifestText: lawful, files: ['manifest.json', ...Object.keys(files)], read }), []);
  const unsealed = dataRepositoryFindings({ manifestText: lawful, files: ['data/customers.json', 'data/contacts.json'], read: (file) => (file === 'data/customers.json' ? json(plaintext(2)) : read(file)) });
  assert.deepEqual(codes(unsealed), ['HFS_DATA_UNSEALED']);
  assert.match(unsealed[0]!.message, /data\/customers\.json is not sealed: every file under data\/ is a sops envelope/);
  const binary = dataRepositoryFindings({ manifestText: lawful, files: [...Object.keys(files), 'data/scan.pdf'], read });
  assert.deepEqual(binary.map((finding) => [finding.code, finding.path]), [['HFS_DATA_UNSEALED', 'data/scan.pdf'], ['HFS_DATA_MANIFEST_DRIFT', 'data/scan.pdf']]);
  const drift = dataRepositoryFindings({ manifestText: json(manifest([entry('customers', 3), entry('contacts', 0, { sha256: 'x', schema: 'other-data/contacts@1' }), entry('invoices', 1)])), files: Object.keys(files), read });
  assert.deepEqual(codes(drift), ['HFS_DATA_MANIFEST_DRIFT', 'HFS_DATA_MANIFEST_DRIFT', 'HFS_DATA_MANIFEST_DRIFT', 'HFS_DATA_MANIFEST_DRIFT']);
  assert.match(drift[0]!.message, /files\[0\]: says 3 items for data\/customers\.json, which holds 2/);
  assert.match(drift[1]!.message, /sha256 of data\/contacts\.json must be the hex sha256/);
  assert.match(drift[2]!.message, /schema of data\/contacts\.json must be a schema id of the format, shop-data\/<entity>@<major>/);
  assert.match(drift[3]!.message, /lists data\/invoices\.json, which is not tracked/);
});

test('R400 the commit hook: the data guard judges a data repository by its index and refuses a record dump anywhere else', (t) => {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (cwd: string, ...args: string[]): void => { assert.equal(spawnSync('git', args, { cwd, env: gitEnv, windowsHide: true }).status, 0, `git ${args.join(' ')}`); };
  const repository = (files: Record<string, string>): string => {
    const root = mkdtemp(t, 'hfs-data-guard-');
    git(root, 'init', '-q', '-b', 'main');
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    git(root, 'add', '-A');
    return root;
  };
  const guard = (root: string, files: string[]): string[] => judge(root, files).findings.filter((finding) => finding.code.startsWith('HFS_DATA_')).map((finding) => `${finding.code} ${finding.file}`);
  const data = repository({ 'manifest.json': json(manifest([entry('customers', 1)])), 'data/customers.json': json(sealed(1)), 'README.md': 'private\n' });
  assert.deepEqual(guard(data, ['manifest.json', 'data/customers.json']), [], 'a sealed snapshot the manifest lists commits');
  fs.writeFileSync(path.join(data, 'data/customers.json'), json(plaintext(1)));
  git(data, 'add', '-A');
  assert.deepEqual(guard(data, ['data/customers.json']), ['HFS_DATA_UNSEALED data/customers.json'], 'the staged blob is judged, not the work tree');
  assert.deepEqual(guard(data, ['README.md']), [], 'a commit that leaves data/ and the manifest alone is not judged by them');
  const code = repository({ 'hfs.json': '{"kind":"app"}\n', 'manifest.json': json(manifest([entry('customers', 1)])), 'be/test/customers.json': json(plaintext(1)) });
  assert.deepEqual(guard(code, ['manifest.json', 'be/test/customers.json']), ['HFS_DATA_IN_CODE manifest.json', 'HFS_DATA_IN_CODE be/test/customers.json'], 'a code project is no data repository, whatever it tracks');
});

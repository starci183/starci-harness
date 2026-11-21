/** Data lives in git only in a seed copy repository (PROJECT-STACKS-13, R400): the hfs check of a code project and the commit hook's guard of a copy repository. */
// proves: HFS_DATA_IN_CODE
// proves: HFS_DATA_COPY_INVALID
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GIT_CAP_BYTES, GIT_SHARD_BYTES, copyRepositoryDeclared, dataBoundaryFindings, dataCopyFindings, dataDependencyFindings, dataInCodeFindings, formatPurpose } from '../runtime/scripts/hfs/rules/data-copies.mjs';
import { judge } from '../sync/hygiene.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: the fixtures are JSON documents of the copy format the assertions build and judge.
type Json = any;
const ENC = 'ENC[AES256_GCM,data:AA==,iv:aXZpdml2aXZpdml2aXZpdg==,tag:dGFndGFndGFndGFndGFndA==,type:str]';
const SOPS = { age: [{ recipient: 'age1qqqq', enc: '-----BEGIN AGE ENCRYPTED FILE-----\nx\n-----END AGE ENCRYPTED FILE-----\n' }], lastmodified: '2026-01-01T00:00:00Z', mac: ENC, version: '3.13.2' };
const json = (value: Json): string => `${JSON.stringify(value, null, 2)}\n`;
/** A file as sops seals it in binary mode: {data: ENC[...], sops}. */
const envelope = json({ data: ENC, sops: SOPS });
const FILE = { plain: 'a'.repeat(64), size: 10 };
const standard = (files: string[], extra: Json = {}): Json => ({ schema: 'starci/data-manifest@1', format: 'shop-seed-standard@1', purpose: 'seed-standard', takenAt: '2026-01-01T00:00:00Z', source: { project: 'shop', environment: 'dev' }, sealing: 'none', recipients: [], files: Object.fromEntries(files.map((file) => [file, FILE])), ...extra });
const backup = (files: string[], extra: Json = {}): Json => standard(files, { format: 'shop-seed-backup-production@1', purpose: 'seed-backup', source: { project: 'shop', environment: 'production' }, sealing: 'sops-age', recipients: ['age1qqqq'], ...extra });
const codes = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code);

/** The reader of a copy repository from a map of file name to text; a size is the text's length unless `sizes` says. */
const reader = (files: Record<string, string>, sizes: Record<string, number> = {}) => ({ files: Object.keys(files), read: (file: string): string | null => files[file] ?? null, sizeOf: (file: string): number | null => sizes[file] ?? files[file]?.length ?? null });

test('the limits are the law of PROJECT-STACKS-13: 4 MiB a file, 500 MiB a snapshot', () => {
  assert.equal(GIT_SHARD_BYTES, 4 * 1024 * 1024);
  assert.equal(GIT_CAP_BYTES, 500 * 1024 * 1024);
});

test('a format name states the purpose; a copy repository is a manifest of the schema and no hfs.json', () => {
  assert.deepEqual(formatPurpose('shop-seed-standard@1'), { purpose: 'seed-standard', environment: null });
  assert.deepEqual(formatPurpose('shop-seed-backup-production@12'), { purpose: 'seed-backup', environment: 'production' });
  assert.equal(formatPurpose('shop-data@1'), null, 'the earlier format is no copy format');
  assert.equal(formatPurpose('shop-seed-backup@1'), null, 'a backup names its environment');
  assert.notEqual(copyRepositoryDeclared(json(standard([])), null), null);
  assert.equal(copyRepositoryDeclared(json(standard([])), '{"kind":"app"}'), null, 'a code project is never a copy repository');
  assert.equal(copyRepositoryDeclared(json({ schema: 'other@1' }), null), null);
  assert.equal(copyRepositoryDeclared(null, null), null);
});

test('HFS_DATA_IN_CODE: a copy manifest and a sops binary envelope are refused in a code project; other JSON is not', () => {
  const manifest = dataInCodeFindings('manifest.json', json(standard([])));
  assert.deepEqual(codes(manifest), ['HFS_DATA_IN_CODE']);
  assert.match(manifest[0]!.message, /is a data manifest of a seed copy; data lives in git only in a copy repository/);
  assert.deepEqual(codes(dataInCodeFindings('data/orders/0.json.sops.json', envelope)), ['HFS_DATA_IN_CODE']);
  assert.deepEqual(dataInCodeFindings('package.json', json({ name: 'shop', files: [] })), [], 'a package.json is no manifest');
  assert.deepEqual(dataInCodeFindings('manifest.json', json({ schema: 'starci/seeds@1' })), [], 'another schema is not a copy manifest');
  assert.deepEqual(dataInCodeFindings('secrets/x.sops.json', json({ other: ENC, sops: SOPS })), [], 'a sealed document without a data member is no binary-mode envelope');
  assert.deepEqual(dataInCodeFindings('data/x.json', envelope), [], 'only the *.sops.json name is a sealed copy file');
  assert.deepEqual(dataInCodeFindings('notes.md', json(standard([]))), [], 'only JSON documents are judged');
});

test('HFS_DATA_IN_CODE: a package dependency, workspace, submodule or tsconfig path naming a copy repository is refused; prose and a longer name are not', () => {
  const dependency = dataDependencyFindings('package.json', json({ name: 'shop', dependencies: { x: 'git+ssh://git@example.test/owner/shop-seed-standard.git' } }));
  assert.deepEqual(codes(dependency), ['HFS_DATA_IN_CODE']);
  assert.match(dependency[0]!.message, /names the copy repository shop-seed-standard in dependencies/);
  assert.match(dataDependencyFindings('be/package.json', json({ workspaces: ['../shop-seed-backup-production'] }))[0]!.message, /shop-seed-backup-production in workspaces/);
  assert.match(dataDependencyFindings('.gitmodules', '[submodule "d"]\n\turl = ../shop-seed-standard.git\n')[0]!.message, /in a submodule/);
  assert.match(dataDependencyFindings('tsconfig.json', json({ compilerOptions: { paths: { '@d/*': ['../shop-seed-standard/data/*'] } } }))[0]!.message, /in a path/);
  assert.deepEqual(dataDependencyFindings('package.json', json({ dependencies: { 'shop-seed-standard-client': '1.0.0' } })), [], 'a longer name is another package');
  assert.deepEqual(dataDependencyFindings('package.json', json({ description: 'seeded from shop-seed-standard' })), [], 'only the dependency fields count');
  assert.deepEqual(dataDependencyFindings('README.md', 'See shop-seed-standard.\n'), [], 'prose is no dependency');
});

test('R400 the hfs check: a tracked manifest with its data tree, an envelope and a dependency are refused; a clean root is green', (t) => {
  const root = mkdtemp(t, 'hfs-data-copies-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', json({ name: 'shop', devDependencies: { x: 'file:../shop-seed-standard' } }));
  write('be/copy/manifest.json', json(standard(['data/a/0.json'])));
  write('be/copy/data/a/0.json', '{}\n');
  write('be/copy/blobs/a/00/1.bin', 'x');
  write('be/test/x.sops.json', envelope);
  write('fe/messages/en.json', json({ title: 'Shop' }));
  const repo: Json = { kind: 'app', project: 'shop' };
  const all = ['package.json', 'be/copy/manifest.json', 'be/copy/data/a/0.json', 'be/copy/blobs/a/00/1.bin', 'be/test/x.sops.json', 'fe/messages/en.json'];
  const findings = dataBoundaryFindings({ repoRoot: root, repo, isRoot: true, all });
  assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [
    ['HFS_DATA_IN_CODE', 'package.json'], ['HFS_DATA_IN_CODE', 'be/copy/manifest.json'], ['HFS_DATA_IN_CODE', 'be/test/x.sops.json'],
    ['HFS_DATA_IN_CODE', 'be/copy/data/'], ['HFS_DATA_IN_CODE', 'be/copy/blobs/'],
  ]);
  assert.deepEqual(dataBoundaryFindings({ repoRoot: root, repo, isRoot: false, all }), [], 'a side scope is judged by the root');
  assert.deepEqual(dataBoundaryFindings({ repoRoot: root, repo, isRoot: true, all: ['fe/messages/en.json'] }), [], 'negative control: the clean tree is green');
});

test('a lawful seed-backup and a lawful seed-standard are green', () => {
  const sealedFiles = { 'data/orders/00.json.sops.json': envelope, 'index/orders.json.sops.json': envelope };
  assert.deepEqual(dataCopyFindings({ manifestText: json(backup(['data/orders/00.json', 'index/orders.json'])), ...reader(sealedFiles) }), []);
  const plainFiles = { 'data/orders/00.json': '{"a":1}\n', 'index/orders.json': '{}\n', 'README.md': 'plain\n', '.sops.yaml': 'creation_rules: []\n' };
  assert.deepEqual(dataCopyFindings({ manifestText: json(standard(['data/orders/00.json', 'index/orders.json'])), ...reader(plainFiles) }), []);
});

test('HFS_DATA_COPY_INVALID: a seed-backup file that is not a *.sops.json sops envelope is refused', () => {
  const files = { 'data/orders/00.json.sops.json': envelope, 'data/orders/01.json.sops.json': json({ a: 1 }), 'blobs/x/00/1.bin.sops.json': 'binary-ish' };
  const findings = dataCopyFindings({ manifestText: json(backup(['data/orders/00.json', 'data/orders/01.json', 'blobs/x/00/1.bin'])), ...reader(files) });
  assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [['HFS_DATA_COPY_INVALID', 'data/orders/01.json.sops.json'], ['HFS_DATA_COPY_INVALID', 'blobs/x/00/1.bin.sops.json']]);
  const plain = dataCopyFindings({ manifestText: json(backup(['data/orders/00.json'])), ...reader({ 'data/orders/00.json': '{"a":1}' }) });
  assert.deepEqual(codes(plain).sort(), ['HFS_DATA_COPY_INVALID', 'HFS_DATA_COPY_INVALID', 'HFS_DATA_COPY_INVALID'], 'a plain name is unsealed and drifts from the sealed name the manifest implies');
  assert.ok(plain.some((finding) => /seed-backup is a \.sops\.json sops envelope/.test(finding.message)));
});

test('HFS_DATA_COPY_INVALID: a seed-standard holds no sops envelope, *.sops.json or *.enc.yaml, and says no sealing', () => {
  const files = { 'data/a/0.json': '{}', 'data/a/1.json.sops.json': envelope, 'creds/x.enc.yaml': 'k: v\n', 'notes/e.json': envelope };
  const findings = dataCopyFindings({ manifestText: json(standard(['data/a/0.json'])), ...reader(files) });
  assert.deepEqual(findings.filter((finding) => / is sealed; a seed-standard is plain/.test(finding.message)).map((finding) => finding.path), ['data/a/1.json.sops.json', 'creds/x.enc.yaml', 'notes/e.json']);
  const sealing = dataCopyFindings({ manifestText: json(standard([], { sealing: 'sops-age' })), ...reader({}) });
  assert.deepEqual(codes(sealing), ['HFS_DATA_COPY_INVALID']);
  assert.deepEqual(dataCopyFindings({ manifestText: json(standard(['data/a/0.json'])), ...reader({ 'data/a/0.json': '{}' }) }), [], 'negative control');
});

test('HFS_DATA_COPY_INVALID: files against the tracked data, the purpose against the format name, the backup environment', () => {
  const missing = dataCopyFindings({ manifestText: json(standard(['data/a/0.json', 'data/a/1.json'])), ...reader({ 'data/a/0.json': '{}', 'data/a/2.json': '{}' }) });
  assert.deepEqual(missing.map((finding) => finding.code), ['HFS_DATA_COPY_INVALID', 'HFS_DATA_COPY_INVALID']);
  assert.match(missing[0]!.message, /lists data\/a\/1\.json, which is not tracked/);
  assert.match(missing[1]!.message, /data\/a\/2\.json is tracked but manifest\.json does not list it/);
  const purpose = dataCopyFindings({ manifestText: json(standard([], { purpose: 'seed-backup' })), ...reader({}) });
  assert.match(purpose[0]!.message, /purpose "seed-backup" disagrees with its format name shop-seed-standard@1/);
  const legacy = dataCopyFindings({ manifestText: json(standard([], { format: 'shop-data@1' })), ...reader({}) });
  assert.match(legacy[0]!.message, /is neither <name>-seed-standard@<major> nor <name>-seed-backup-<env>@<major>/);
  const environment = dataCopyFindings({ manifestText: json(backup([], { source: { environment: 'dev' } })), ...reader({}) });
  assert.match(environment[0]!.message, /names the environment production, but source\.environment is dev/);
  const sealing = dataCopyFindings({ manifestText: json(backup([], { sealing: 'none' })), ...reader({}) });
  assert.match(sealing[0]!.message, /a seed-backup is always sops-age/);
  const noFiles = dataCopyFindings({ manifestText: json(standard([], { files: undefined })), ...reader({}) });
  assert.match(noFiles[0]!.message, /has no files index/);
  const notManifest = dataCopyFindings({ manifestText: json({ schema: 'x' }), ...reader({}) });
  assert.match(notManifest[0]!.message, /is no copy manifest/);
});

test('HFS_DATA_COPY_INVALID and HFS_DATA_COPY_INVALID: a data file over 4 MiB, a snapshot over 500 MiB (the s3 driver is named)', () => {
  const names = ['data/a/0.json', 'data/a/1.json'];
  const big = dataCopyFindings({ manifestText: json(standard(names)), ...reader({ 'data/a/0.json': '{}', 'data/a/1.json': '{}' }, { 'data/a/1.json': GIT_SHARD_BYTES + 1 }) });
  assert.deepEqual(big.map((finding) => [finding.code, finding.path]), [['HFS_DATA_COPY_INVALID', 'data/a/1.json']]);
  const exact = dataCopyFindings({ manifestText: json(standard(names)), ...reader({ 'data/a/0.json': '{}', 'data/a/1.json': '{}' }, { 'data/a/1.json': GIT_SHARD_BYTES }) });
  assert.deepEqual(exact, [], 'negative control: exactly 4 MiB passes');
  const many = Array.from({ length: 126 }, (_, index) => `data/a/${String(index)}.json`);
  const cap = dataCopyFindings({ manifestText: json(standard(many)), ...reader(Object.fromEntries(many.map((name) => [name, '{}'])), Object.fromEntries(many.map((name) => [name, GIT_SHARD_BYTES]))) });
  assert.deepEqual(codes(cap), ['HFS_DATA_COPY_INVALID']);
  assert.match(cap[0]!.message, /outgrown git, declare the s3 driver/);
  const under = dataCopyFindings({ manifestText: json(standard(many.slice(0, 100))), ...reader(Object.fromEntries(many.slice(0, 100).map((name) => [name, '{}'])), Object.fromEntries(many.slice(0, 100).map((name) => [name, GIT_SHARD_BYTES]))) });
  assert.deepEqual(under, [], 'negative control: 400 MiB is under the cap');
});

test('R400 the commit hook: a copy repository is judged by its index, any other repository refuses a copy document', (t) => {
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
  const copy = repository({ 'manifest.json': json(backup(['data/a/0.json'])), 'data/a/0.json.sops.json': envelope });
  assert.deepEqual(guard(copy, ['manifest.json', 'data/a/0.json.sops.json']), [], 'a sealed backup the manifest lists commits');
  fs.writeFileSync(path.join(copy, 'data/a/0.json.sops.json'), json({ plain: true }));
  git(copy, 'add', '-A');
  assert.deepEqual(guard(copy, ['data/a/0.json.sops.json']), ['HFS_DATA_COPY_INVALID data/a/0.json.sops.json'], 'the staged blob is judged, not the work tree');
  const plain = repository({ 'manifest.json': json(standard(['data/a/0.json'])), 'data/a/0.json': '{}\n' });
  assert.deepEqual(guard(plain, ['manifest.json']), [], 'a plain standard commits');
  fs.writeFileSync(path.join(plain, 'data/a/0.json'), 'x'.repeat(GIT_SHARD_BYTES + 1));
  git(plain, 'add', '-A');
  assert.deepEqual(guard(plain, ['data/a/0.json']), ['HFS_DATA_COPY_INVALID data/a/0.json'], 'the size is the index blob\'s');
  const code = repository({ 'hfs.json': '{"kind":"app"}\n', 'manifest.json': json(standard([])), 'be/x.sops.json': envelope });
  assert.deepEqual(guard(code, ['manifest.json', 'be/x.sops.json']), ['HFS_DATA_IN_CODE manifest.json', 'HFS_DATA_IN_CODE be/x.sops.json'], 'a code project is no copy repository, whatever it tracks');
});

test('R400 over raw/ (R434): a raw/ file is sized and capped like a data file and never listed by the manifest', () => {
  const files = { 'data/a/0.json': '{}', 'raw/a.md': '# a', 'raw/big.png': 'x' };
  const big = dataCopyFindings({ manifestText: json(standard(['data/a/0.json'])), ...reader(files, { 'raw/big.png': GIT_SHARD_BYTES + 1 }) });
  assert.deepEqual(big.map((finding) => `${finding.code} ${finding.path}`), ['HFS_DATA_COPY_INVALID raw/big.png']);
  const listed = dataCopyFindings({ manifestText: json(standard(['data/a/0.json', 'raw/a.md'])), ...reader(files) });
  assert.deepEqual(listed.map((finding) => `${finding.code} ${finding.path}`), ['HFS_DATA_COPY_INVALID manifest.json']);
  assert.match(listed[0]?.message ?? '', /lists raw\/a\.md, which is no data file/u);
  const many = Array.from({ length: 126 }, (_, at) => `raw/${String(at)}.md`);
  const cap = dataCopyFindings({ manifestText: json(standard([])), ...reader(Object.fromEntries(many.map((name) => [name, '#'])), Object.fromEntries(many.map((name) => [name, GIT_SHARD_BYTES]))) });
  assert.deepEqual(codes(cap), ['HFS_DATA_COPY_INVALID'], 'raw/ counts toward the 500 MiB of the snapshot');
});

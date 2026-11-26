// proves: HFS_LITE_SECRET_CUSTODY
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { sealedSecretCustodyFindings, sealedSecretFindings } from '../runtime/scripts/hfs/rules/secret-custody.mjs';
import { secretFindings, untrackedSecretFindings } from '../runtime/scripts/hfs/rules/secrets.mjs';

const tree = (t: TestContext, files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-supabase-secrets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
};

const app = (edition: string) => ({ profile: 'app', edition });
const fe = (edition: string) => ({ profile: 'fe', edition });
const resolver = { classifyPath: () => ({ status: 'owned' }), slot: () => null };
const jwtFixture = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'service_role', exp: 4102444800 })).toString('base64url')}.${'C'.repeat(43)}`;
const fullApp = { hfs: 3, kind: 'app', project: 'fixture', sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } };
const liteApp = { ...fullApp };

for (const ignored of [false, true]) {
  test(`R06 warns about an ${ignored ? 'ignored' : 'unignored'} untracked secrets.env at the app root without making it an error`, t => {
    const root = tree(t, { '.gitignore': ignored ? 'secrets.env\n' : '' });
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '.gitignore'], { cwd: root, stdio: 'ignore' });
    const baseline = checkRepo({ repoRoot: root, declaration: liteApp });
    fs.writeFileSync(path.join(root, 'secrets.env'), '');
    const result = checkRepo({ repoRoot: root, declaration: liteApp });
    const findings = result.findings.filter(item => item.path === 'secrets.env');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.code, 'HFS_PLAINTEXT_SECRET');
    assert.equal(findings[0]!.level, 'warning');
    assert.match(findings[0]!.message!, /starci app secret set/);
    assert.equal(result.counts.warning, baseline.counts.warning + 1, 'the custody warning is the one warning the file adds');
    assert.equal(result.counts.error, baseline.counts.error, 'the generic untracked-entry gate must not turn the custody warning into an error');
    const fast = checkRepo({ repoRoot: root, declaration: liteApp, tree: false, only: [] });
    assert.equal(fast.findings.filter(item => item.code === 'HFS_PLAINTEXT_SECRET' && item.level === 'warning').length, 1, 'a fast check also reports local secret custody');
  });
}

test('R06 keeps a tracked secrets.env an error by path even when its content is empty, and never downgrades it in a fast check', t => {
  const root = tree(t, { 'secrets.env': '' });
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', 'secrets.env'], { cwd: root, stdio: 'ignore' });
  for (const declaration of [fullApp, liteApp]) {
    const result = checkRepo({ repoRoot: root, declaration });
    const [finding] = result.findings.filter(item => item.code === 'HFS_PLAINTEXT_SECRET');
    assert.equal(finding?.path, 'secrets.env');
    assert.equal(finding?.level, 'error');
    assert.equal(finding?.slot, 'app.plaintext-env');
    assert.deepEqual(result.findings.filter(item => item.level === 'warning' && item.code !== 'HFS_MASTER_PLAN_MISSING'), [], 'no warning beside the app-level Master Plan one (R449)');
    const fast = checkRepo({ repoRoot: root, declaration, tree: false, only: [] });
    assert.deepEqual(fast.findings.filter(item => item.level === 'warning' && item.code !== 'HFS_MASTER_PLAN_MISSING'), []);
  }
});

test('the untracked custody warning applies only to the app root, with no warning for an absent file or nested secrets.env', t => {
  const root = tree(t, { 'be/secrets.env': '' });
  const input = { repoRoot: root, files: [] };
  assert.deepEqual(untrackedSecretFindings({ ...input, repo: app('lite') }), []);
  fs.writeFileSync(path.join(root, 'secrets.env'), '');
  assert.deepEqual(untrackedSecretFindings({ ...input, repo: fe('lite') }), []);
  assert.deepEqual(untrackedSecretFindings({ ...input, repo: { profile: 'be' } }), []);
  assert.deepEqual(untrackedSecretFindings({ ...input, files: ['secrets.env'], repo: app('lite') }), []);
});

test('HFS_LITE_SECRET_CUSTODY: root env/custody entries and sealed files outside the starcistacks secret home are refused', t => {
  const files = ['.env.example', 'secrets.env', '.secrets/ci.key', 'backup.enc', '.starcistacks/dev/secrets/app.enc'];
  const root = tree(t, Object.fromEntries(files.map(file => [file, 'fixture'])));
  const findings = sealedSecretCustodyFindings({ repoRoot: root, files, repo: app('lite') });
  assert.deepEqual(findings.map(item => item.path).sort((left, right) => left.localeCompare(right)), ['.env.example', '.secrets/ci.key', 'backup.enc', 'secrets.env']);
  assert.ok(findings.every(item => item.code === 'HFS_LITE_SECRET_CUSTODY' && item.level === 'error'));
});

test('a root .env or .secrets/ file is refused once: R06 owns the path, the custody rule adds no second finding', t => {
  const files = ['.env', '.secrets/ci.key'];
  const root = tree(t, Object.fromEntries(files.map(file => [file, 'fixture'])));
  const findings = sealedSecretFindings({ repoRoot: root, files, repo: app('lite'), resolver });
  for (const file of files) assert.deepEqual(findings.filter(item => item.path === file).map(item => item.code), ['HFS_PLAINTEXT_SECRET'], file);
});

test('HFS_LITE_SECRET_CUSTODY: direct sealed stack members and ordinary source files pass', t => {
  const encrypted = 'ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]';
  const contents = {
    '.starcistacks/dev/secrets/app.enc': JSON.stringify({ data: encrypted, sops: { mac: encrypted } }),
    'be/apps/api/src/main.ts': 'export const port = 3000;\n',
  };
  const root = tree(t, contents);
  const input = { repoRoot: root, files: Object.keys(contents), repo: app('lite'), resolver };
  assert.deepEqual(sealedSecretCustodyFindings(input), []);
  assert.deepEqual(secretFindings(input), [], 'the fixture also satisfies the generic sealed-envelope contract');
});

test('HFS_LITE_SECRET_CUSTODY: Supabase tokens, long eyJ service material and password-bearing connection strings under fe/ are refused', t => {
  const source = [
    `export const publishable = 'sbp_${'A'.repeat(24)}'`,
    `export const secret = 'sb_secret_${'B'.repeat(24)}'`,
    `export const service = '${jwtFixture}'`,
    `export const database = 'postgresql://app:${'p'.repeat(12)}@db.invalid/product'`,
  ].join('\n');
  const root = tree(t, { 'apps/web/src/modules/config/generated.ts': source });
  const findings = sealedSecretCustodyFindings({ repoRoot: root, files: ['apps/web/src/modules/config/generated.ts'], repo: fe('lite') });
  assert.deepEqual(findings.map(item => item.pattern as string).sort((left, right) => left.localeCompare(right)), [
    'password-connection-string', 'signed-jwt', 'supabase-personal-access-token', 'supabase-secret-token',
  ]);
  assert.ok(findings.every(item => !item.message.includes('postgresql://') && !item.message.includes('sb_secret_')), 'a finding never prints the captured value');
});

test('HFS_LITE_SECRET_CUSTODY: comments, token-family names, passwordless/env-derived URLs and lockfiles pass', t => {
  const harmless = `
// sbp_ and sb_secret_ are provider prefixes; eyJ is a header prefix.
export const names=['sbp_example','sb_secret_example','eyJshort'];
export const passwordless='postgresql://db.invalid/product';
export const injected='postgresql://app:\${DATABASE_PASSWORD}@db.invalid/product';
`;
  const files = ['apps/web/src/modules/config/index.ts', 'package-lock.json'];
  const root = tree(t, { [files[0]!]: harmless, [files[1]!]: `{"note":"sbp_${'Z'.repeat(30)}"}` });
  assert.deepEqual(sealedSecretCustodyFindings({ repoRoot: root, files, repo: fe('lite') }), []);
});

test('the extended scanner emits one specific L17 finding instead of duplicate R06/L17 findings for a complete JWT in lite', t => {
  const file = 'db/config.ts';
  const root = tree(t, { [file]: `export const copied = '${jwtFixture}'\n` });
  const lite = sealedSecretFindings({ repoRoot: root, files: [file], repo: app('lite'), resolver });
  assert.equal(lite.length, 1, JSON.stringify(lite, null, 2));
  assert.equal(lite[0]!.code, 'HFS_LITE_SECRET_CUSTODY');
  const full = secretFindings({ repoRoot: root, files: [file], resolver });
  assert.equal(full.length, 1, JSON.stringify(full, null, 2));
  assert.equal(full[0]!.code, 'HFS_PLAINTEXT_SECRET', 'full edition keeps the unchanged R06 judgement');
});

/** The recipient policy of every app's sealed members (R451, PROJECT-STACKS-5, owner 2026-11-21 model B): a security guard over the rule, init and the SOPS_AGE_KEY guard. */
// proves: HFS_SOPS_RECIPIENTS
// proves: HFS_SOPS_RECIPIENT_UNDECLARED
// proves: HFS_SOPS_CATCH_ALL
// proves: HFS_SOPS_MEMBER_RECIPIENTS
// proves: HFS_SOPS_IDENTITY_MISMATCH
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { RECIPIENT_POLICY_FILE, recipientPolicy, recipientPolicyOf, type RecipientPolicy } from '../runtime/scripts/lib/sops-recipients.mjs';
import { sopsRecipientFindings } from '../runtime/scripts/hfs/rules/sops-recipients.mjs';
import { policyCreationRules } from '../runtime/scripts/hfs/secret-init.mjs';
import { identityMismatch } from '../runtime/scripts/hfs/secret-identity-guard.mjs';

// Fixture recipients: syntactically age recipients, held by no one.
const HARNESS = 'age1harnessaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SERVER = 'age1serveraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BACKUP = 'age1backupaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const APP_ONLY = 'age1apponlyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ENV_RULE = (env: string): string => String.raw`\.starcistacks[/\\]` + env + String.raw`[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;
const CATCH_ALL = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;

const policy = (backup: string | null = BACKUP): RecipientPolicy => recipientPolicyOf({
  schema: 'starci/sops-recipients@1', harness: HARNESS, servers: { 'sv-1': { server: SERVER, backup } }, environments: { dev: ['harness'] }, otherwise: ['server', 'backup'],
});
const stack = (deployed: Record<string, string | null>) => ({
  environments: { dev: {}, ...Object.fromEntries(Object.entries(deployed).map(([env, recorded]) => [env, recorded === null ? { deploy: {} } : { deploy: { remote: { serverRecipient: recorded } } }])) },
});
const member = (env: string, recipients: string[]) => ({ file: `.starcistacks/${env}/secrets/db.enc.yaml`, text: `POSTGRES_PASSWORD: ENC[AES256_GCM,data:x]\nsops:\n  age:\n${recipients.map((r) => `    - recipient: ${r}\n      enc: |\n        x\n`).join('')}` });
const codes = (findings: { code: string }[]): string[] => findings.map((finding) => finding.code).sort();

test('the shipped policy is the harness repository\'s ops/vps/recipients.yaml, and dev is the harness recipient alone', () => {
  const owner = fileURLToPath(new URL('../../../ops/vps/recipients.yaml', import.meta.url));
  assert.deepEqual(parseYaml(fs.readFileSync(RECIPIENT_POLICY_FILE, 'utf8')), parseYaml(fs.readFileSync(owner, 'utf8')));
  const shipped = recipientPolicy();
  assert.match(shipped.harness, /^age173qf/u);
  assert.deepEqual(shipped.environments.dev, ['harness']);
  assert.deepEqual(shipped.otherwise, ['server', 'backup']);
});

test('an app on the policy passes: dev the harness key, a deployed environment its server key plus the backup, no catch-all', () => {
  const findings = sopsRecipientFindings({
    rules: [{ path_regex: ENV_RULE('dev'), age: HARNESS }, { path_regex: ENV_RULE('production'), age: `${SERVER},${BACKUP}` }],
    stackDoc: stack({ production: SERVER }), members: [member('dev', [HARNESS]), member('production', [BACKUP, SERVER])], policy: policy(),
  });
  assert.deepEqual(findings, []);
});

test('the NIVO shape: an app-only owner key on every environment and the catch-all are found, and the missing backup is named', () => {
  const findings = sopsRecipientFindings({
    rules: [{ path_regex: ENV_RULE('staging'), age: `${APP_ONLY},${SERVER}` }, { path_regex: ENV_RULE('production'), age: `${APP_ONLY},${SERVER}` }, { path_regex: CATCH_ALL, age: APP_ONLY }],
    stackDoc: stack({ staging: SERVER, production: SERVER }), members: [member('dev', [APP_ONLY]), member('staging', [APP_ONLY, SERVER])], policy: policy(null),
  });
  assert.deepEqual(codes(findings), ['HFS_SOPS_CATCH_ALL', 'HFS_SOPS_MEMBER_RECIPIENTS', 'HFS_SOPS_MEMBER_RECIPIENTS', 'HFS_SOPS_RECIPIENTS', 'HFS_SOPS_RECIPIENTS', 'HFS_SOPS_RECIPIENTS', 'HFS_SOPS_RECIPIENT_UNDECLARED', 'HFS_SOPS_RECIPIENT_UNDECLARED']);
  const dev = findings.find((finding) => finding.code === 'HFS_SOPS_RECIPIENTS' && (finding as { env?: string }).env === 'dev');
  assert.match(String(dev?.message), /app-only identity/u);
  assert.match(String(dev?.message), /starci app secret recipients --env dev --add age1harness\S* --remove age1apponly\S* --execute/u);
  assert.ok(findings.every((finding) => (finding as { local?: boolean }).local === true), 'every R451 finding is report-only in --env local');
});

test('the StarCi Next shape: the harness key on staging and production is refused, the dev rule passes', () => {
  const findings = sopsRecipientFindings({
    rules: [{ path_regex: ENV_RULE('dev'), age: HARNESS }, { path_regex: ENV_RULE('production'), age: `${HARNESS},${SERVER}` }, { path_regex: CATCH_ALL, age: APP_ONLY }],
    stackDoc: stack({ production: SERVER }), members: [member('dev', [HARNESS]), member('production', [HARNESS, SERVER])], policy: policy(),
  });
  assert.deepEqual(codes(findings), ['HFS_SOPS_CATCH_ALL', 'HFS_SOPS_MEMBER_RECIPIENTS', 'HFS_SOPS_RECIPIENTS']);
  const production = findings.find((finding) => finding.code === 'HFS_SOPS_RECIPIENTS');
  assert.match(String(production?.message), /harness key, which must never open production/u);
  assert.match(String(production?.message), /lacks age1backup/u);
  assert.match(String(production?.message), /ON the server/u);
});

test('the lite shape: one app-only catch-all, and a production that records no server', () => {
  const findings = sopsRecipientFindings({ rules: [{ path_regex: CATCH_ALL, age: APP_ONLY }], stackDoc: stack({ production: null }), members: [member('production', [APP_ONLY])], policy: policy() });
  assert.deepEqual(codes(findings), ['HFS_SOPS_CATCH_ALL', 'HFS_SOPS_MEMBER_RECIPIENTS', 'HFS_SOPS_RECIPIENTS', 'HFS_SOPS_RECIPIENTS', 'HFS_SOPS_RECIPIENT_UNDECLARED']);
  assert.match(String(findings.find((finding) => finding.code === 'HFS_SOPS_RECIPIENT_UNDECLARED')?.message), /secret server-key --env production --execute/u);
});

function fixtureApp(t: { after: (fn: () => void) => void }, stackText: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-sops-recipients-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev', 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), stackText);
  return root;
}

test('secret init writes one rule per environment from the policy, keeps an existing rule and leaves a deployed environment without its keys unruled', (t) => {
  const root = fixtureApp(t, `environments:\n  dev: {}\n  staging: {}\n  production:\n    deploy:\n      remote: {serverRecipient: ${SERVER}}\n`);
  const made = policyCreationRules(root, [{ path_regex: ENV_RULE('staging'), age: APP_ONLY }], policy());
  assert.deepEqual(made.written, ['dev', 'production']);
  assert.deepEqual(made.kept, ['staging']);
  assert.deepEqual(made.rules.map((rule) => rule.age), [APP_ONLY, HARNESS, `${SERVER},${BACKUP}`]);
  const unminted = policyCreationRules(root, [], policy(null));
  assert.deepEqual(unminted.written, ['dev']);
  assert.equal(unminted.skipped.length, 2);
  assert.ok(unminted.rules.every((rule) => rule.age !== HARNESS || rule.path_regex === ENV_RULE('dev')), 'the harness key is written for dev only');
});

test('the SOPS_AGE_KEY guard names the file read and the expected prefix, for dev members only', (t) => {
  const root = fixtureApp(t, 'environments:\n  dev: {}\n');
  const file = path.join(root, '.starcistacks', 'dev', 'secrets', 'db.enc.yaml');
  fs.writeFileSync(file, member('dev', [HARNESS]).text);
  const pasted = { source: path.join(root, '.claude', 'secret.env'), recipient: APP_ONLY };
  const harness = { source: 'the harness secret.env', recipient: HARNESS };
  const shadowed = identityMismatch(file, [pasted, harness], policy());
  assert.match(String(shadowed), /^SECRET_IDENTITY_MISMATCH: the SOPS_AGE_KEY read from .*secret\.env is the recipient age1apponlya…, but db\.enc\.yaml \(dev\) is sealed to age1harnessa…/u);
  assert.match(String(shadowed), /the harness secret\.env holds a matching identity/u);
  assert.match(String(shadowed), /NIVO_PACKAGE_AGE_KEY, never SOPS_AGE_KEY/u);
  assert.equal(identityMismatch(file, [harness], policy()), null);
  assert.doesNotMatch(String(shadowed), /AGE-SECRET-KEY/u);
  const deployed = path.join(root, '.starcistacks', 'production', 'secrets', 'db.enc.yaml');
  fs.mkdirSync(path.dirname(deployed), { recursive: true });
  fs.writeFileSync(deployed, member('production', [SERVER, BACKUP]).text);
  assert.equal(identityMismatch(deployed, [pasted], policy()), null, 'a dev machine holding no deployed identity is expected');
});

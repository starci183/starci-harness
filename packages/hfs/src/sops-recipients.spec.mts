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
import { RECIPIENT_POLICY_FILE, expectedRecipients, recipientPolicy, recipientPolicyOf, type RecipientPolicy } from '../runtime/scripts/lib/sops-recipients.mjs';
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

const policy = (backup: string | null = BACKUP, { enforce = true, server }: { enforce?: boolean; server?: boolean } = {}): RecipientPolicy => recipientPolicyOf({
  schema: 'starci/sops-recipients@1', harness: HARNESS, enforce, servers: { 'sv-1': { server: SERVER, backup, ...(server === undefined ? {} : { enforce: server }) } }, environments: { dev: ['harness'] }, otherwise: ['server', 'backup'],
});
const stack = (deployed: Record<string, string | null>) => ({
  environments: { dev: {}, ...Object.fromEntries(Object.entries(deployed).map(([env, recorded]) => [env, recorded === null ? { deploy: {} } : { deploy: { remote: { serverRecipient: recorded } } }])) },
});
const member = (env: string, recipients: string[]) => ({ file: `.starcistacks/${env}/secrets/db.enc.yaml`, text: `POSTGRES_PASSWORD: ENC[AES256_GCM,data:x]\nsops:\n  age:\n${recipients.map((r) => `    - recipient: ${r}\n      enc: |\n        x\n`).join('')}` });
const policyCreationRulesFor = (p: RecipientPolicy, app: string): string => expectedRecipients(p, 'production', SERVER, app).recipients.join(',');
const codes = (findings: { code: string }[]): string[] => findings.map((finding) => finding.code).sort();

test('the shipped policy is the harness repository\'s ops/vps/recipients.yaml, and dev is the harness recipient alone', () => {
  const owner = fileURLToPath(new URL('../../../ops/vps/recipients.yaml', import.meta.url));
  assert.deepEqual(parseYaml(fs.readFileSync(RECIPIENT_POLICY_FILE, 'utf8')), parseYaml(fs.readFileSync(owner, 'utf8')));
  const shipped = recipientPolicy();
  assert.match(shipped.harness, /^age173qf/u);
  assert.deepEqual(shipped.environments.dev, ['harness']);
  assert.deepEqual(shipped.otherwise, ['server', 'backup', 'ci']);
  assert.match(shipped.apps['nivoos-lite']?.ci ?? '', /^age138u6/u, 'NIVO deploys from CI with its own key');
  assert.equal(shipped.enforce, false, 'R451 warns until the owner-approved migration completes');
  assert.ok(Object.values(shipped.servers).every((server) => server.enforce !== true), 'no server blocks yet');
});

test('the enforce switch: a warning in every env while off, an error (report-only in --env local) once on, per server or globally', () => {
  const nivo = { rules: [{ path_regex: ENV_RULE('production'), age: `${APP_ONLY},${SERVER}` }, { path_regex: CATCH_ALL, age: APP_ONLY }], stackDoc: stack({ production: SERVER }), members: [] };
  const levels = (p: RecipientPolicy) => sopsRecipientFindings({ ...nivo, policy: p }).map((finding) => `${finding.code}:${String((finding as { env?: string }).env ?? '-')}:${String(finding.level)}`).sort();
  assert.ok(levels(policy(BACKUP, { enforce: false })).every((line) => line.endsWith(':warning')));
  const serverOn = levels(policy(BACKUP, { enforce: false, server: true }));
  assert.ok(serverOn.includes('HFS_SOPS_RECIPIENTS:production:error'), 'the server switch makes its environments block');
  assert.ok(serverOn.includes('HFS_SOPS_RECIPIENTS:dev:warning') && serverOn.includes('HFS_SOPS_CATCH_ALL:-:warning'), 'dev and the catch-all follow the global switch');
  const findings = sopsRecipientFindings({ ...nivo, policy: policy() });
  assert.ok(findings.every((finding) => finding.level === 'error' && (finding as { local?: boolean }).local === true));
});

test('an app on the policy passes: dev the harness key, a deployed environment its server key plus the backup, no catch-all', () => {
  const findings = sopsRecipientFindings({
    rules: [{ path_regex: ENV_RULE('dev'), age: HARNESS }, { path_regex: ENV_RULE('production'), age: `${SERVER},${BACKUP}` }],
    stackDoc: stack({ production: SERVER }), members: [member('dev', [HARNESS]), member('production', [BACKUP, SERVER])], policy: policy(),
  });
  assert.deepEqual(findings, []);
});

test('one CI key per project: an app\'s own CI recipient joins its deployed sets, another app\'s is refused, and a shared or reused key breaks the policy', () => {
  const CI_A = 'age1ciappaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const CI_B = 'age1ciappbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const doc = (apps: Record<string, unknown>) => ({ schema: 'starci/sops-recipients@1', harness: HARNESS, enforce: true, servers: { 'sv-1': { server: SERVER, backup: BACKUP } }, apps, environments: { dev: ['harness'] }, otherwise: ['server', 'backup', 'ci'] });
  const p = recipientPolicyOf(doc({ 'app-a': { ci: CI_A }, 'app-b': { ci: CI_B } }));
  const judge = (app: string | null, sealed: string[]) => sopsRecipientFindings({
    rules: [{ path_regex: ENV_RULE('dev'), age: HARNESS }, { path_regex: ENV_RULE('production'), age: sealed.join(',') }],
    stackDoc: stack({ production: SERVER }), members: [member('dev', [HARNESS]), member('production', sealed)], policy: p, app,
  });
  assert.deepEqual(judge('app-a', [SERVER, BACKUP, CI_A]), [], 'server + backup + its own CI key is exactly the set');
  const without = judge('app-a', [SERVER, BACKUP]);
  assert.deepEqual(codes(without), ['HFS_SOPS_MEMBER_RECIPIENTS', 'HFS_SOPS_RECIPIENTS']);
  assert.match(without[0]!.message, /lacks age1ciappaaa… \(ci\)/u);
  const other = judge('app-a', [SERVER, BACKUP, CI_A, CI_B]);
  assert.ok(other.some((finding) => /is the CI key of app-b, which only app-b's own members hold/u.test(finding.message)), 'another project\'s CI key is refused');
  assert.deepEqual(judge('app-c', [SERVER, BACKUP]), [], 'an app with no CI key keeps server + backup');
  assert.ok(judge('app-c', [SERVER, BACKUP, CI_A]).length > 0, 'an app may not borrow a CI key');
  assert.throws(() => recipientPolicyOf(doc({ 'app-a': { ci: CI_A }, 'app-b': { ci: CI_A } })), /apps\.app-b\.ci is also the CI key of app-a: each project has a CI key of its own/u);
  assert.throws(() => recipientPolicyOf(doc({ 'app-a': { ci: SERVER } })), /apps\.app-a\.ci is also the server key of sv-1/u);
  assert.throws(() => recipientPolicyOf(doc({ 'app-a': { ci: BACKUP } })), /is also the backup key of sv-1/u);
  assert.throws(() => recipientPolicyOf(doc({ 'app-a': { ci: HARNESS } })), /is also the harness key/u);
  assert.throws(() => recipientPolicyOf(doc({ 'app-a': { ci: 'not-a-key' } })), /apps\.app-a\.ci must be one public age recipient/u);
  assert.deepEqual(policyCreationRulesFor(p, 'app-a'), `${SERVER},${BACKUP},${CI_A}`, 'secret init seals a new rule to the same set');
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
  assert.ok(findings.every((finding) => (finding as { local?: boolean }).local === true), 'once enforced, every R451 finding is report-only in --env local');
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

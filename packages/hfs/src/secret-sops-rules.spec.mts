// proves: HFS_PLAINTEXT_SECRET@lite
// proves: HFS_PLAINTEXT_SECRET@full
// `starci app secret set` seals a `.enc.yaml` member: sops finds its creation rule by the file's own name, so an app whose `.sops.yaml` only has the
// legacy `.enc$` rule is refused with SECRET_SOPS_RULE_MISSING (naming the path and the remedy) before sops runs, and `starci app codemod sops-rules`
// migrates the file to the managed form. Public recipients only; every value here is a fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { managedPathRegex, migrateSopsRules, sopsRulesMarkdown } from '../codemod/sops-rules.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { sopsFindsRule } from '../runtime/scripts/hfs/secret-init.mjs';
import type { SecretToolOverrides } from '../runtime/scripts/hfs/secret-init.mjs';
import { defaultSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import { app } from './helpers/hfs-secret-fixture.mjs';

const RECIPIENT = `age1${'q'.repeat(58)}`;
const LEGACY = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;
const CURRENT = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;
const MEMBER = '.starcistacks/dev/secrets/sonar.enc.yaml';

const rules = (...regexes: Array<string | null>): string => `creation_rules:\n${regexes.map((regex) => `  - ${regex === null ? '' : `path_regex: '${regex}'\n    `}age: ${RECIPIENT}`).join('\n')}\n`;

/** A sops seam whose binary is a double: every program it runs is recorded, and a seal answers a sealed document. */
function sopsOf(root: string, env: NodeJS.ProcessEnv, programs: string[][]): ReturnType<typeof defaultSops> {
  const ok = (text: string) => ({ status: 0, signal: null, error: null, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
  const tools: SecretToolOverrides = {
    resolveSops: () => process.execPath,
    resolveRealTool: () => process.execPath,
    secretEnv: () => ({}),
    runProgram: (_program: string, args: readonly string[]) => {
      programs.push([...args]);
      if (args[0] === '--disable-version-check') return ok('sops 3.13.2\n');
      if (args[0] === '--version') return ok('1.3.1\n');
      return ok('SONAR_TOKEN: ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]\nsops:\n  age: []\n');
    },
  };
  return defaultSops(env, root, 'linux', tools);
}

const seal = (sops: ReturnType<typeof defaultSops>, root: string) => sops.seal({ inputType: 'yaml', plaintext: 'SONAR_TOKEN: fake-value\n', recipients: [], filenameOverride: path.join(root, MEMBER) });

test('1. sops finds a rule by the file name as written: the legacy .enc rule does not reach a .enc.yaml member', (t) => {
  const fixture = app(t, {});
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(LEGACY));
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, MEMBER)), false);
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, '.starcistacks/dev/secrets/sonar.enc')), true);
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(CURRENT));
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, MEMBER)), true);
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(null));
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, MEMBER)), true, 'a rule with no path_regex matches every file');
  fs.rmSync(path.join(fixture.root, '.sops.yaml'));
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, MEMBER)), false);
});

test('2. a new member the rules do not reach is refused before sops runs, naming the path and the remedy', (t) => {
  const fixture = app(t, {});
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(LEGACY));
  const programs: string[][] = [];
  const sops = sopsOf(fixture.root, fixture.env, programs);
  const before = programs.length;
  assert.throws(() => seal(sops, fixture.root), (error: Error) => /SECRET_SOPS_RULE_MISSING/.test(error.message)
    && error.message.includes(MEMBER) && /starci app secret init --env dev/.test(error.message) && /codemod sops-rules/.test(error.message) && !/exit 1/.test(error.message));
  assert.equal(programs.length, before, 'sops was not asked to seal');
});

test('3. the managed rule seals, and an existing member keeps its recipients under its own rule', (t) => {
  const fixture = app(t, {});
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(CURRENT));
  const programs: string[][] = [];
  const sops = sopsOf(fixture.root, fixture.env, programs);
  const sealed = ((): string => { try { return seal(sops, fixture.root); } catch (error) { return (error as Error).message; } })();
  assert.doesNotMatch(sealed, /SECRET_SOPS_RULE_MISSING/, 'the managed rule reaches the member');
});

test('4. the legacy rule becomes the managed one; the recipients and the other rules stay', () => {
  assert.equal(managedPathRegex(LEGACY), CURRENT);
  assert.equal(managedPathRegex(CURRENT), CURRENT);
  assert.equal(managedPathRegex(String.raw`\.starcistacks[/\\]dev[/\\]secrets[/\\][^/\\]+\.enc$`), String.raw`\.starcistacks[/\\]dev[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`);
  assert.equal(managedPathRegex(String.raw`^other\.enc$`), String.raw`^other\.enc$`, 'a rule that is no member rule is left alone');
});

test('5. the codemod previews, migrates with --execute, and a sealed member then finds its rule', (t) => {
  const fixture = app(t, {});
  const file = path.join(fixture.root, '.sops.yaml');
  fs.writeFileSync(file, rules(LEGACY, null));
  const dry = migrateSopsRules({ root: fixture.root });
  assert.deepEqual(dry.changes, [{ rule: 0, from: LEGACY, to: CURRENT }]);
  assert.equal(fs.readFileSync(file, 'utf8'), rules(LEGACY, null), 'a dry run writes nothing');
  assert.match(sopsRulesMarkdown(dry), /1 creation rule\(s\) would be migrated/);
  const out: string[] = [];
  assert.equal(codemodMain(['sops-rules', '--execute'], { cwd: fixture.root, stdout: (text) => out.push(text) }), 0);
  const migrated = parseYaml(fs.readFileSync(file, 'utf8')) as { creation_rules: Array<{ path_regex?: string; age: string }> };
  assert.equal(migrated.creation_rules[0]?.path_regex, CURRENT);
  assert.equal(migrated.creation_rules[0]?.age, RECIPIENT);
  assert.equal(migrated.creation_rules[1]?.path_regex, undefined);
  assert.equal(sopsFindsRule(fixture.root, path.join(fixture.root, MEMBER)), true);
  assert.deepEqual(migrateSopsRules({ root: fixture.root }).changes, []);
  assert.ok(CODEMODS.includes('sops-rules'));
});

test('6. a .sops.yaml without rules is left for a person, and an app without one has nothing to do', (t) => {
  const broken = app(t, {});
  fs.writeFileSync(path.join(broken.root, '.sops.yaml'), 'stores: {}\n');
  const report = migrateSopsRules({ root: broken.root, write: true });
  assert.deepEqual(report.findings.map((finding) => finding.code), ['SOPS_RULES_UNREADABLE']);
  assert.equal(codemodMain(['sops-rules'], { cwd: broken.root, stdout: () => undefined }), 1);
  const bare = app(t, {});
  assert.deepEqual(migrateSopsRules({ root: bare.root }).changes, []);
});

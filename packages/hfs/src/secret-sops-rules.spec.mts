// proves: HFS_PLAINTEXT_SECRET
// proves: HFS_PLAINTEXT_SECRET
// `starci app secret set` seals a `.enc.yaml` member: sops finds its creation rule by the file's own name, so an app whose `.sops.yaml` has only an
// `.enc$` rule is refused with SECRET_SOPS_RULE_MISSING (naming the path and the remedy) before sops runs. Public recipients only; every value here is a fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sopsFindsRule } from '../runtime/scripts/hfs/secret-init.mjs';
import type { SecretToolOverrides } from '../runtime/scripts/hfs/secret-init.mjs';
import { defaultSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import { app } from './helpers/hfs-secret-fixture.mjs';

const RECIPIENT = `age1${'q'.repeat(58)}`;
const ENC_ONLY = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc$`;
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

test('1. sops finds a rule by the file name as written: the `.enc$` rule does not reach a .enc.yaml member', (t) => {
  const fixture = app(t, {});
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(ENC_ONLY));
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
  fs.writeFileSync(path.join(fixture.root, '.sops.yaml'), rules(ENC_ONLY));
  const programs: string[][] = [];
  const sops = sopsOf(fixture.root, fixture.env, programs);
  const before = programs.length;
  assert.throws(() => seal(sops, fixture.root), (error: Error) => /SECRET_SOPS_RULE_MISSING/.test(error.message)
    && error.message.includes(MEMBER) && /starci app secret init --env dev/.test(error.message) && !/exit 1/.test(error.message));
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

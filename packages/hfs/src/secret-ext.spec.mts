/** `starci app secret set|unset|list --env <env> --ext <target>` and R429 (PROJECT-STACKS-5): a sealed file the project's ext/manifest.json declares. */
// proves: HFS_SECRET_TARGET_MISSING@lite
// proves: HFS_SECRET_TARGET_MISSING@full
// proves: HFS_SECRET_TARGET_UNSEALED@lite
// proves: HFS_SECRET_TARGET_UNSEALED@full
// proves: HFS_SECRET_TARGET_PLAIN@lite
// proves: HFS_SECRET_TARGET_PLAIN@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { secretMain } from '../runtime/scripts/hfs/secret.mjs';
import { judgeTargetFile, secretTargetFindings } from '../runtime/scripts/hfs/rules/secret-targets.mjs';
import { loadProjectExt } from '../runtime/scripts/lib/project-ext.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: manifests, sealed trees and the sops fake are YAML/JSON-shaped trees the assertions build and judge.
type Json = any;
const ENC = (n: number): string => `ENC[AES256_GCM,data:${'a'.repeat(n)},iv:bbbb,tag:cccc,type:str]`;
const MAC = ENC(6);

/** A fake sops seam: seal stores the plaintext tree and returns a sops-shaped envelope; decryptTree gives the stored tree back; nothing is real crypto. */
function fakeSops() {
  const files = new Map<string, Json>();
  const sealed: Array<{ file: string; recipients: string[] }> = [];
  const encrypt = (node: Json): Json => (node !== null && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, encrypt(v)])) : ENC(3));
  const render = (node: Json, indent = ''): string => Object.entries(node).map(([k, v]) => (typeof v === 'object' ? `${indent}${k}:\n${render(v, `${indent}  `)}` : `${indent}${k}: ${String(v)}\n`)).join('');
  return {
    files, sealed,
    sops: {
      identity: { source: 'test', looked: [] },
      requireIdentity: () => undefined,
      decrypt: () => ({}),
      decryptBinary: () => '',
      updateKeys: () => undefined,
      decryptTree: (file: string): Json => structuredClone(files.get(path.resolve(file))),
      seal: ({ plaintext, recipients, filenameOverride }: { plaintext: string; recipients: string[]; filenameOverride: string }): string => {
        const tree = parseYaml(plaintext);
        files.set(path.resolve(filenameOverride), tree);
        sealed.push({ file: path.resolve(filenameOverride), recipients });
        return `${render(encrypt(tree))}sops:\n  mac: ${MAC}\n  age:\n    - recipient: age1abc\n`;
      },
    },
  };
}

const MANIFEST_TARGET = (): Json => ({
  id: 'blocks-core', why: 'Credentials of the blocks-core seed standard.', root: '../standard',
  environments: { dev: 'secrets.dev.enc.yaml', production: 'secrets.prod.enc.yaml' }, recipients: '.sops.yaml', under: ['accounts'], depth: 2,
});

/** An app root with an ext/manifest.json declaring the target and the sibling checkout `standard` with its .sops.yaml. */
function project(t: TestContext, mutate: (target: Json) => void = () => undefined, { checkout = true }: { checkout?: boolean } = {}) {
  const base = mkdtemp(t, 'secret-ext-');
  const app = path.join(base, 'app'), standard = path.join(base, 'standard');
  fs.mkdirSync(path.join(app, 'ext'), { recursive: true });
  fs.writeFileSync(path.join(app, 'hfs.json'), JSON.stringify({ kind: 'app', project: 'demo' }));
  const target = MANIFEST_TARGET();
  mutate(target);
  fs.writeFileSync(path.join(app, 'ext', 'manifest.json'), JSON.stringify({ schema: 'starci/project-ext@1', api: 1, secretTargets: [target] }));
  if (checkout) { fs.mkdirSync(standard, { recursive: true }); fs.writeFileSync(path.join(standard, '.sops.yaml'), 'creation_rules: []\n'); }
  return { app, standard };
}

async function run(app: string, argv: string[], { stdin = () => 'VALUE', seam = fakeSops() }: { stdin?: () => string; seam?: ReturnType<typeof fakeSops> } = {}) {
  let out = '', err = '';
  const status = await secretMain(argv, { cwd: app, stdout: (text) => { out += text; }, stderr: (text) => { err += text; }, stdin, sops: seam.sops as never, env: {} });
  return { status, out, err, seam };
}

test('the manifest declares a target: a sound one is read, a malformed one refuses the whole extension', (t) => {
  const { app } = project(t, );
  const ext = loadProjectExt(app);
  assert.deepEqual(ext.problems, []);
  assert.equal(ext.secretTargets[0]?.id, 'blocks-core');
  assert.equal(ext.secretTargets[0]?.depth, 2);
  for (const bad of [(t: Json) => { t.root = 'C:/absolute'; }, (t: Json) => { t.recipients = 'sops.txt'; }, (t: Json) => { t.environments = { dev: 'secrets.enc.yaml', production: 'secrets.enc.yaml' }; },
    (t: Json) => { t.environments = { dev: 'plain.yaml' }; }, (t: Json) => { t.depth = 9; }, (t: Json) => { t.extra = true; }, (t: Json) => { t.id = 'Blocks Core'; }]) {
    assert.ok(loadProjectExt(project(t, bad).app).problems.length > 0, String(bad));
  }
});

test('set seals a nested key into the target file with the checkout as the sops root, and never prints the value', async (t) => {
  const { app, standard } = project(t, );
  const { status, out, err, seam } = await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'crm-main/credential']);
  assert.equal(status, 0, err);
  assert.match(out, /sealed dev\/blocks-core \(crm-main\/credential\) in secrets\.dev\.enc\.yaml/u);
  assert.ok(!(out + err).includes('VALUE'));
  const file = path.join(standard, 'secrets.dev.enc.yaml');
  assert.deepEqual(seam.files.get(path.resolve(file)), { accounts: { 'crm-main': { credential: 'VALUE' } } });
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(path.join(standard, 'secrets.prod.enc.yaml')));
  assert.ok(!fs.existsSync(path.join(app, '.starcistacks')));
});

test('a second set adds beside the first (the file is opened in memory, nothing is lost), production seals its own file, list prints names only', async (t) => {
  const { app, standard } = project(t, );
  const seam = fakeSops();
  await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'crm-main/credential'], { seam });
  await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'zalo-a/apiToken'], { seam, stdin: () => 'OTHER' });
  assert.deepEqual(seam.files.get(path.resolve(standard, 'secrets.dev.enc.yaml')), { accounts: { 'crm-main': { credential: 'VALUE' }, 'zalo-a': { apiToken: 'OTHER' } } });
  await run(app, ['set', '--env', 'production', '--ext', 'blocks-core', 'crm-main/credential'], { seam, stdin: () => 'PROD' });
  assert.deepEqual(seam.files.get(path.resolve(standard, 'secrets.prod.enc.yaml')), { accounts: { 'crm-main': { credential: 'PROD' } } });
  const listed = await run(app, ['list', '--env', 'dev', '--ext', 'blocks-core'], { seam });
  assert.equal(listed.out, 'crm-main/credential\nzalo-a/apiToken\n');
  assert.ok(!listed.out.includes('VALUE'));
});

test('unset is a dry run until --execute, removes the key and an account left empty', async (t) => {
  const { app, standard } = project(t, );
  const seam = fakeSops();
  await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'crm-main/credential'], { seam });
  await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'zalo-a/apiToken'], { seam, stdin: () => 'OTHER' });
  const dry = await run(app, ['unset', '--env', 'dev', '--ext', 'blocks-core', 'zalo-a/apiToken'], { seam });
  assert.match(dry.out, /dry run/u);
  assert.ok((seam.files.get(path.resolve(standard, 'secrets.dev.enc.yaml')) as Json).accounts['zalo-a']);
  const done = await run(app, ['unset', '--env', 'dev', '--ext', 'blocks-core', 'zalo-a/apiToken', '--execute'], { seam });
  assert.equal(done.status, 0, done.err);
  assert.deepEqual(seam.files.get(path.resolve(standard, 'secrets.dev.enc.yaml')), { accounts: { 'crm-main': { credential: 'VALUE' } } });
  const missing = await run(app, ['unset', '--env', 'dev', '--ext', 'blocks-core', 'nope/credential', '--execute'], { seam });
  assert.equal(missing.status, 2);
  assert.match(missing.err, /SECRET_TARGET_KEY/u);
});

test('typed refusals: an unknown target lists the declared ones, an environment it does not seal, a key of another depth or naming an environment, a missing checkout or .sops.yaml, get', async (t) => {
  const { app } = project(t, );
  const unknown = await run(app, ['set', '--env', 'dev', '--ext', 'nivo-core', 'a/b']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /SECRET_TARGET_UNKNOWN.*declared: blocks-core/u);
  assert.match((await run(app, ['set', '--env', 'staging', '--ext', 'blocks-core', 'a/b'])).err, /SECRET_TARGET_ENVIRONMENT/u);
  assert.match((await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'FLAT'])).err, /SECRET_TARGET_KEY/u);
  assert.match((await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'DEV_main/credential'])).err, /carries an environment/u);
  assert.match((await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'prod-main/credential'])).err, /carries an environment/u);
  assert.match((await run(app, ['get', '--env', 'dev', '--ext', 'blocks-core', 'a/b', '--reveal'])).err, /--ext is only valid for set, unset and list/u);
  assert.match((await run(project(t, () => undefined, { checkout: false }).app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'a/b'])).err, /SECRET_TARGET_ROOT/u);
  const noSops = project(t, );
  fs.unlinkSync(path.join(noSops.standard, '.sops.yaml'));
  assert.match((await run(noSops.app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'a/b'])).err, /SECRET_TARGET_RECIPIENTS/u);
});

test('a flat target (depth 1, no under) takes plain KEY names', async (t) => {
  const { app, standard } = project(t, (t) => { t.depth = 1; delete t.under; });
  const seam = fakeSops();
  assert.equal((await run(app, ['set', '--env', 'dev', '--ext', 'blocks-core', 'API_TOKEN'], { seam })).status, 0);
  assert.deepEqual(seam.files.get(path.resolve(standard, 'secrets.dev.enc.yaml')), { API_TOKEN: 'VALUE' });
});

test('R429: a missing file, an unsealed file and a sealed file holding a plain value are findings; an absent checkout and a sealed file are not', (t) => {
  const { app, standard } = project(t, );
  const repo = { kind: 'app' };
  const codes = (): string[] => secretTargetFindings({ repoRoot: app, repo: repo as never, isRoot: true }).map((finding) => finding.code);
  assert.deepEqual(codes(), ['HFS_SECRET_TARGET_MISSING', 'HFS_SECRET_TARGET_MISSING']);
  const sealed = `accounts:\n  a:\n    credential: ${ENC(3)}\nsops:\n  mac: ${MAC}\n  age:\n    - recipient: age1abc\n`;
  fs.writeFileSync(path.join(standard, 'secrets.dev.enc.yaml'), sealed);
  fs.writeFileSync(path.join(standard, 'secrets.prod.enc.yaml'), 'accounts:\n  a:\n    credential: hunter2\n');
  assert.deepEqual(codes(), ['HFS_SECRET_TARGET_UNSEALED']);
  fs.writeFileSync(path.join(standard, 'secrets.prod.enc.yaml'), sealed.replace(`credential: ${ENC(3)}`, 'credential: hunter2'));
  assert.deepEqual(codes(), ['HFS_SECRET_TARGET_PLAIN']);
  fs.writeFileSync(path.join(standard, 'secrets.prod.enc.yaml'), sealed);
  assert.deepEqual(codes(), []);
  assert.deepEqual(secretTargetFindings({ repoRoot: project(t, () => undefined, { checkout: false }).app, repo: repo as never, isRoot: true }), []);
  assert.equal(judgeTargetFile(sealed), 'sealed');
});

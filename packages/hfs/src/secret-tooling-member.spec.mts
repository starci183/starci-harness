// proves: APP_SECRET_IN_CI@lite
// proves: APP_SECRET_IN_CI@full
// `starci app secret set` on a tooling member (sonar.enc.yaml: the analysis token of a quality service) never declares it as an app runtime secret
// (CI custody refuses a runtime-granted CI secret) and binds it where the template shows: the service's `credentials` and its `ci.secrets`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { declareKeys } from '../runtime/scripts/hfs/secret-standard.mjs';
import { app } from './helpers/hfs-secret-fixture.mjs';

const stacks = (service: string): string => `schema: starci/application-stacks@1
environments:
  dev:
    status: supported
    runtime: docker-compose
    secrets: []
services:
${service}`;

const EMPTY = `  sonar:
    provider: sonarqube
    projects: [{repository: demo, key: demo}]
    credentials: []
    ci: {wiring: required, workflow: .github/workflows/ci.yml, token: SONAR_TOKEN, secrets: []}
`;

const BOUND = `  sonar:
    provider: sonarqube
    projects: [{repository: demo, key: demo}]
    credentials:
      - id: analysis
        project: "demo"
        key: SONAR_TOKEN
        custody: {repository: "demo", path: .starcistacks/dev/secrets/sonar.enc.yaml}
    ci: {wiring: required, workflow: .github/workflows/ci.yml, token: SONAR_TOKEN, secrets: [{name: SONAR_TOKEN, credential: analysis}]}
`;

function fixture(t: test.TestContext, service: string): { root: string; read(): { environments: { dev: { secrets: unknown[] } }; services: { sonar: { credentials: unknown[]; ci: { secrets: unknown[] } } } } } {
  const { root } = app(t, {});
  fs.mkdirSync(path.join(root, '.starcistacks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), stacks(service));
  return { root, read: () => parseYaml(fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8')) as never };
}

test('1. a tooling member with no binding gets the credential and the ci secret the template shows, and no runtime entry', (t) => {
  const { root, read } = fixture(t, EMPTY);
  const result = declareKeys(root, 'dev', 'sonar', ['SONAR_TOKEN']);
  assert.deepEqual([result.declared, result.byHand, result.tooling?.bound, result.tooling?.remedy], [[], [], ['SONAR_TOKEN'], '']);
  const document = read();
  assert.deepEqual(document.environments.dev.secrets, [], 'the token is not an app runtime secret');
  const [credential] = document.services.sonar.credentials as Array<{ id: string; project: string; key: string; custody: { repository: string; path: string } }>;
  assert.deepEqual([document.services.sonar.credentials.length, credential?.id, credential?.project, credential?.key, credential?.custody.path], [1, 'analysis', 'demo', 'SONAR_TOKEN', '.starcistacks/dev/secrets/sonar.enc.yaml']);
  assert.deepEqual(document.services.sonar.ci.secrets, [{ name: 'SONAR_TOKEN', credential: 'analysis' }]);
  const again = declareKeys(root, 'dev', 'sonar', ['SONAR_TOKEN']);
  assert.deepEqual(again, { declared: [], byHand: [] }, 'a second set changes nothing');
});

test('2. a member whose binding exists is left alone, runtime entry included', (t) => {
  const { root, read } = fixture(t, BOUND);
  const before = fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8');
  const result = declareKeys(root, 'dev', 'sonar', ['SONAR_TOKEN']);
  assert.deepEqual(result, { declared: [], byHand: [] });
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8'), before);
  assert.deepEqual(read().environments.dev.secrets, []);
});

test('3. a shape the edit cannot place returns the exact binding to add, and writes nothing', (t) => {
  const odd = EMPTY.replace('credentials: []', 'credentials: [] # none yet').replace('ci: {wiring: required, workflow: .github/workflows/ci.yml, token: SONAR_TOKEN, secrets: []}', 'ci:\n      wiring: required\n      secrets: []');
  const { root } = fixture(t, odd);
  const before = fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8');
  const result = declareKeys(root, 'dev', 'sonar', ['SONAR_TOKEN']);
  assert.deepEqual(result.tooling?.bound, []);
  assert.match(result.tooling?.remedy ?? '', /tooling credential of services\.sonar, not an app runtime secret[^]*credentials: \[\{"id":"analysis"[^]*ci\.secrets: \[\{"name":"SONAR_TOKEN","credential":"analysis"\}\]/);
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8'), before);
});

test('4. an ordinary member is still declared as a runtime secret', (t) => {
  const { root, read } = fixture(t, EMPTY);
  const result = declareKeys(root, 'dev', 'stripe', ['STRIPE_KEY']);
  assert.deepEqual([result.declared, result.tooling], [['STRIPE_KEY'], undefined]);
  assert.equal(read().environments.dev.secrets.length, 1);
});

const SEALED = 'SONAR_TOKEN: ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]\nsops:\n  mac: ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]\n  age:\n    - recipient: age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\n      enc: x\n';

function sealedFixture(t: test.TestContext, service: string, runtimeEntry = false): ReturnType<typeof fixture> {
  const made = fixture(t, service);
  fs.mkdirSync(path.join(made.root, '.starcistacks', 'dev', 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(made.root, '.starcistacks', 'dev', 'secrets', 'sonar.enc.yaml'), SEALED);
  if (runtimeEntry) {
    const file = path.join(made.root, '.starcistacks', 'application-stacks.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('secrets: []', 'secrets:\n      - {name: sonar-token, member: sonar, key: SONAR_TOKEN, where: secrets/sonar}'));
  }
  return made;
}

test('5. quality-binding previews, binds an app scaffolded before the binding with --execute, and names the runtime entry an earlier set declared', async (t) => {
  const { migrateQualityBinding, qualityBindingMarkdown } = await import('../codemod/quality-binding.mjs');
  const { CODEMODS, codemodMain } = await import('../codemod/main.mjs');
  const { root, read } = sealedFixture(t, EMPTY, true);
  const dry = migrateQualityBinding({ root });
  assert.deepEqual(dry.changes.map((change) => [change.member, change.service]), [['sonar', 'sonar']]);
  assert.deepEqual(dry.findings.map((finding) => finding.code), ['QUALITY_RUNTIME_ENTRY']);
  assert.equal(read().services.sonar.credentials.length, 0, 'a dry run writes nothing');
  assert.equal(codemodMain(['quality-binding', '--execute'], { cwd: root, stdout: () => undefined }), 1, 'the runtime entry is left for the owner');
  assert.equal(read().services.sonar.credentials.length, 1);
  assert.deepEqual(read().services.sonar.ci.secrets, [{ name: 'SONAR_TOKEN', credential: 'analysis' }]);
  assert.match(qualityBindingMarkdown(migrateQualityBinding({ root })), /delete the entry/);
  assert.ok(CODEMODS.includes('quality-binding'));
  const clean = sealedFixture(t, BOUND);
  assert.deepEqual([migrateQualityBinding({ root: clean.root }).changes, migrateQualityBinding({ root: clean.root }).findings], [[], []]);
});

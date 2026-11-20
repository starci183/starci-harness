// proves: BE_TEST_TOPOLOGY@lite BE_TEST_TOPOLOGY@full
// proves: BE_SPEC_WORLD_MISSING@lite BE_SPEC_WORLD_MISSING@full
// R47 / BE-TEST-12: test infrastructure lives only in src/tests/world/, no test overrides a provider, and every integration or
// e2e spec gets its world from useTestWorld of src/tests/world/use-test-world. Lite carries e2e flows too (useTestWorld({ apps })).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { testInfraPlacementFindings } from '../runtime/scripts/hfs/rules/test-infra-placement.mjs';

type Files = Record<string, string>;

const WORLD_ENTRY = "export { useTestWorld, useSandbox } from './test-world.config';\n";
const WORLD_SPEC = "import { useTestWorld } from '../../world/use-test-world';\nconst world = useTestWorld({ modules: [] });\nit('boots', () => { expect(world).toBeDefined(); });\n";
const E2E_SPEC = "import { useTestWorld } from '../../world/use-test-world';\nconst world = useTestWorld({ apps: {} });\nit('drives the door', () => { expect(world).toBeDefined(); });\n";

/** A scratch be repository holding `files`, with the tsconfig the specs resolve their imports through. */
function repoWith(t: TestContext, files: Files): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-test-infra-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all: Files = { 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022' } }), ...files };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const run = (root: string) => testInfraPlacementFindings({ repoRoot: root, files: walk(root).filter((file) => file !== 'tsconfig.json') });

function walk(root: string, dir = ''): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(root, `${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
}

/** The homemade world of a repository that shipped without src/tests/world/ (the case this rule was written for). */
const HOMEMADE: Files = {
  'src/tests/fixtures/e2e/world.ts': [
    "import { Test } from '@nestjs/testing';",
    "import { AppModule } from '../../../app.module';",
    'export async function bootWorld() {',
    '  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })',
    "    .overrideProvider('MODEL_GATEWAY').useValue({})",
    '    .compile();',
    '  const app = moduleRef.createNestApplication();',
    '  await app.listen(0);',
    '  return app;',
    '}',
    '',
  ].join('\n'),
  'src/tests/integration/chat/chat.integration-spec.ts': "import { bootWorld } from '../../fixtures/e2e/world';\nit('boots', async () => { await bootWorld(); });\n",
};

for (const edition of ['lite'] as const) {
  test(`BE_TEST_TOPOLOGY (${edition}): infrastructure outside src/tests/world/ and a provider override are refused`, (t) => {
    const hits = run(repoWith(t, HOMEMADE));
    const topology = hits.filter((hit) => hit.code === 'BE_TEST_TOPOLOGY' && hit.path === 'src/tests/fixtures/e2e/world.ts');
    const messages = topology.map((hit) => hit.message);
    for (const needle of ['imports @nestjs/testing', 'imports an app module', 'calls createTestingModule', 'calls .listen(', 'overrideProvider(...)']) {
      assert.ok(messages.some((message) => message.includes(needle)), `${edition}: expected a finding for ${needle}`);
    }
    assert.ok(topology.every((hit) => hit.level === 'error'));
  });

  test(`BE_SPEC_WORLD_MISSING (${edition}): an integration spec that boots its own world is refused`, (t) => {
    const hits = run(repoWith(t, HOMEMADE)).filter((hit) => hit.code === 'BE_SPEC_WORLD_MISSING');
    assert.deepEqual(hits.map((hit) => hit.path), ['src/tests/integration/chat/chat.integration-spec.ts']);
  });

  test(`BE_TEST_TOPOLOGY and BE_SPEC_WORLD_MISSING (${edition}): the world itself, builders and specs on useTestWorld pass`, (t) => {
    const root = repoWith(t, {
      'src/tests/world/test-world.config.ts': "import { Test } from '@nestjs/testing';\nexport const useTestWorld = () => Test; export const useSandbox = () => null;\n",
      'src/tests/world/use-test-world.ts': WORLD_ENTRY,
      'src/tests/fixtures/builders/order.builder.ts': 'export const orderOf = () => ({ id: "order-1" });\n',
      'src/tests/integration/chat/chat.integration-spec.ts': WORLD_SPEC,
      'src/tests/e2e/deploy/deploy.e2e-spec.ts': E2E_SPEC,
      'src/tests/contract/gateway/payment.contract-spec.ts': 'export {};\n',
    });
    assert.deepEqual(run(root), []);
  });

  test(`BE_SPEC_WORLD_MISSING (${edition}): an e2e spec and a spec that imports useTestWorld from elsewhere are refused; a spec that never calls it too`, (t) => {
    const root = repoWith(t, {
      'src/tests/world/use-test-world.ts': WORLD_ENTRY,
      'src/tests/helpers/use-test-world.ts': 'export const useTestWorld = () => null;\n',
      'src/tests/e2e/deploy/deploy.e2e-spec.ts': "import { useTestWorld } from '../../helpers/use-test-world';\nconst world = useTestWorld({ apps: {} });\n",
      'src/tests/integration/chat/chat.integration-spec.ts': "import { useTestWorld } from '../../world/use-test-world';\nit('never boots', () => { expect(useTestWorld).toBeDefined(); });\n",
    });
    assert.deepEqual(run(root).filter((hit) => hit.code === 'BE_SPEC_WORLD_MISSING').map((hit) => hit.path), ['src/tests/e2e/deploy/deploy.e2e-spec.ts', 'src/tests/integration/chat/chat.integration-spec.ts']);
  });

  test(`BE_TEST_TOPOLOGY (${edition}): override calls in a non-unit spec outside src/tests are refused, a unit spec is left to R48`, (t) => {
    const root = repoWith(t, {
      'src/tests/world/use-test-world.ts': WORLD_ENTRY,
      'src/modules/domain/orders/orders.service.spec.ts': "import { Test } from '@nestjs/testing';\nTest.createTestingModule({}).overrideGuard('g');\n",
      'src/modules/domain/orders/orders.contract-spec.ts': "declare const b: { overrideModule(x: string): void };\nb.overrideModule('m');\n",
    });
    assert.deepEqual(run(root).map((hit) => [hit.path, hit.code]), [['src/modules/domain/orders/orders.contract-spec.ts', 'BE_TEST_TOPOLOGY']]);
  });
}

test('a monorepo side prefix resolves the world entry of its own side', (t) => {
  const root = repoWith(t, {
    'be/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', baseUrl: '.', paths: { '@tests/*': ['src/tests/*'] } } }),
    'be/src/tests/world/use-test-world.ts': WORLD_ENTRY,
    'be/src/tests/e2e/deploy/deploy.e2e-spec.ts': "import { useTestWorld } from '@tests/world/use-test-world';\nuseTestWorld({ apps: {} });\n",
  });
  assert.deepEqual(testInfraPlacementFindings({ repoRoot: root, files: walk(root).filter((file) => file !== 'tsconfig.json') }), []);
});

test('lite accepts an e2e flow and a test:e2e script, and the check reports the homemade world through the app check', (t) => {
  const root = repoWith(t, {
    ...HOMEMADE,
    'src/tests/e2e/deploy/deploy.e2e-spec.ts': E2E_SPEC,
    'src/tests/world/use-test-world.ts': WORLD_ENTRY,
    'package.json': JSON.stringify({ scripts: { 'test:e2e': 'jest --selectProjects e2e' } }),
  });
  const declaration = { hfs: 3, kind: 'app', project: 'demo', sides: { be: { apps: [{ name: 'api', kind: 'api' }] } } };
  const files = [...walk(root), 'package.json'].filter((file, index, all) => all.indexOf(file) === index && file !== 'tsconfig.json');
  const findings = checkRepo({ repoRoot: root, declaration, files, tree: false }).findings;
  assert.deepEqual(findings.filter((finding) => finding.code === 'HFS_EDITION_FORBIDDEN_PRESENT'), []);
  assert.deepEqual(findings.filter((finding) => finding.code === 'HFS_FORBIDDEN_PRESENT' && String(finding.path).includes('tests/e2e')), []);
  assert.ok(findings.some((finding) => finding.code === 'BE_SPEC_WORLD_MISSING'));
  assert.ok(findings.some((finding) => finding.code === 'BE_TEST_TOPOLOGY' && finding.path === 'src/tests/fixtures/e2e/world.ts'));
});

// proves: CI_STANDARD
// proves: CI_STANDARD
// proves: HFS_E2E_IN_AUTOMATIC_GATE
// proves: HFS_E2E_IN_AUTOMATIC_GATE
// Integration and e2e run on request only and are no part of CI (R12): a workflow that runs one is refused by the CI standard item `no-world-layers`,
// and nothing the harness renders (the managed CI, the hooks, the package scripts the hooks call) runs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTargets } from '../sync/index.mjs';
import { ciStandardFindings } from '../runtime/scripts/hfs/rules/ci-standard.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const FILE = '.github/workflows/ci.yml';
const SHA = 'a'.repeat(40);
const declaration = (edition: string) => ({ hfs: 3, kind: 'app', edition, project: 'no-world', sides: {
  be: { apps: [{ name: 'api', kind: 'api' }] },
  fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }], reads: ['be/contracts/'] },
} });
const rendered = (edition: string, file: string) => renderTargets(declaration(edition), { sonarExclusions: '' }).find((item) => item.path === file)?.content;
const worldFindings = (doc: unknown, _edition: string) => ciStandardFindings({ doc, file: FILE, scope: 'app-ci' }).filter((finding) => finding.item === 'no-world-layers');
const workflowRunning = (run: string) => ({
  name: 'ci',
  on: { push: { branches: ['main'] } },
  jobs: { extra: { 'runs-on': 'ubuntu-latest', 'timeout-minutes': 10, steps: [{ uses: `actions/checkout@${SHA}`, with: { 'fetch-depth': 0 } }, { name: 'suite', run }] } },
});

const WORLD_COMMANDS = [
  'npm run test:e2e',
  'npm run test:integration',
  'npm run test:contract',
  'npm run e2e',
  'npm run e2e:ci',
  'pnpm run test:e2e',
  'yarn test:e2e',
  'npm test -- --selectProjects integration',
  'npx jest --selectProjects e2e',
  'npx jest --selectProjects=contract --ci',
  'npx jest be/src/tests/integration/db.integration-spec.ts',
  'npx jest be/src/tests/e2e/flow.e2e-spec.ts',
  'echo start\nnpm ci && npm run test:e2e',
];
const CLEAN_COMMANDS = [
  'npm run test:unit',
  'npx jest --selectProjects unit --shard=1/6',
  'npm run typecheck',
  'npx starci app check --gate wiring',
  '# npm run test:e2e is run by hand\nnpm run test:unit',
  'npm run lint',
];

for (const edition of ['lite'] as const) {
  for (const command of WORLD_COMMANDS) {
    test(`a workflow step running \`${command.replaceAll('\n', ' ; ')}\` is refused (no-world-layers)`, () => {
      const findings = worldFindings(workflowRunning(command), edition);
      assert.equal(findings.length, 1, command);
      assert.match(findings[0]!.message, /CI_STANDARD .*\[no-world-layers\].*only on request/u);
    });
  }

  for (const command of CLEAN_COMMANDS) {
    test(`a workflow step running \`${command.replaceAll('\n', ' ; ')}\` passes (no-world-layers)`, () => {
      assert.deepEqual(worldFindings(workflowRunning(command), edition), []);
    });
  }

  test(`the managed ci.yml, the hooks and the scripts they call run no integration or e2e`, () => {
    const text = rendered(edition, FILE);
    assert.ok(text, 'the managed CI is rendered');
    assert.deepEqual(worldFindings(parseYaml(text), edition), []);
    assert.doesNotMatch(text, /test:(?:e2e|integration|contract)|--selectProjects[ =]+(?:e2e|integration|contract)|e2e-spec|integration-spec/u, 'the rendered CI names no world layer');
    for (const hook of ['.husky/pre-commit', '.husky/pre-push']) {
      const hookText = rendered(edition, hook);
      if (hookText === undefined) continue;
      assert.doesNotMatch(hookText, /test:(?:e2e|integration|contract)|--selectProjects[ =]+(?:e2e|integration|contract)|typecheck:tests/u, `${hook} runs no world layer`);
    }
  });

  test(`no managed workflow other than ci.yml runs a world layer`, () => {
    for (const target of renderTargets(declaration(edition), { sonarExclusions: '' }).filter((item) => /^\.github\/workflows\/.+\.ya?ml$/u.test(item.path))) {
      assert.doesNotMatch(String(target.content), /test:(?:e2e|integration|contract)|--selectProjects[ =]+(?:e2e|integration|contract)/u, target.path);
    }
  });
}

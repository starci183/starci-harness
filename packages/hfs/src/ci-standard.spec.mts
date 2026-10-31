// proves: CI_STANDARD@lite
// proves: CI_STANDARD@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ciStandardAppFindings, ciStandardFindings } from '../runtime/scripts/hfs/rules/ci-standard.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const FAILURE = 'CI_STANDARD';
const FILE = '.github/workflows/ci.yml';
const SHA = 'a'.repeat(40);
const HEAP = { NODE_OPTIONS: '--max-old-space-size=6144' };
const checkout = { uses: `actions/checkout@${SHA}`, with: { 'fetch-depth': 0 } };
const baseRef = { run: 'echo "STARCI_BASE_REF=origin/main" >> "$GITHUB_ENV"' };
interface Step { [key: string]: unknown }
interface Job {
  'runs-on'?: string;
  uses?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps: Step[];
  strategy?: { matrix: { side?: string[]; shard?: number[] } };
  permissions?: Record<string, string>;
}
interface Workflow {
  name: string;
  on: object;
  jobs: { plan?: Job; fast?: Job; lint: Job; test: Job; coverage: Job; build?: Job; images?: Job; verdict?: Job; 'deploy-production'?: Job; 'db-types'?: Job; extra?: Job };
}
const job = (steps: Step[], extra: Partial<Job> = {}): Job => ({ 'runs-on': 'ubuntu-latest', 'timeout-minutes': 20, steps, ...extra });
const compliant = (edition: string): Workflow => ({
  name: 'ci',
  on: { push: { tags: ['v*'], branches: ['main', 'release/candidate-*'] }, workflow_dispatch: {} },
  jobs: {
    plan: job([checkout, { run: 'echo plan' }]),
    fast: job([checkout, { run: 'echo fast' }]),
    lint: job([checkout, baseRef, { run: 'starci app lint --side ${{ matrix.side }}', env: HEAP }], { strategy: { matrix: { side: ['be', 'fe'] } } }),
    test: job([checkout, { name: 'unit', run: 'npx jest --shard=${{ matrix.shard }}/2', env: { STARCI_COVERAGE_SHARD: '1' } }], { strategy: { matrix: { shard: [1, 2] } } }),
    coverage: job([
      checkout,
      { run: 'starci app coverage merge' },
      { run: 'starci app coverage verify', env: HEAP },
      { uses: `codecov/codecov-action@${SHA}`, with: { use_oidc: true, fail_ci_if_error: true } },
    ], { permissions: { 'id-token': 'write' } }),
    build: job([checkout, { run: 'docker build .' }]),
    images: { uses: './.github/workflows/images.yml', needs: 'plan', steps: [] },
    verdict: job([{ run: 'echo verdict' }], { needs: ['plan', 'fast', 'lint', 'test', 'coverage', 'build', 'images', ...(edition === 'lite' ? ['db-types'] : [])], if: '${{ always() }}' }),
    ...(edition === 'lite' ? { 'db-types': job([checkout, { run: 'echo types' }]) } : {}),
  },
});
const messagesOf = (findings: { item: string; message: string }[]) => findings.filter((finding) => finding.item === 'job-shape').map((finding) => finding.message).join('\n');
const items = (findings: { item: string }[]) => findings.map((finding) => finding.item);
const judge = (doc: Workflow, edition: string) => ciStandardFindings({ doc, file: FILE, scope: 'app-ci', edition });

for (const edition of ['lite', 'full']) {
  test(`${edition}: a conforming managed ci.yml is clean`, () => {
    assert.deepEqual(judge(compliant(edition), edition), []);
  });

  test(`${edition}: the deploy jobs call the reusable stack-deploy.yml after the verdict, and the verdict judges every other job`, () => {
    const ok = compliant(edition);
    ok.jobs['deploy-production'] = { uses: './.github/workflows/stack-deploy.yml', needs: ['plan', 'verdict', 'images'], steps: [] };
    assert.deepEqual(judge(ok, edition), []);

    const steps = compliant(edition);
    steps.jobs['deploy-production'] = job([{ run: 'docker stack deploy -c stack.yaml demo' }], { needs: ['plan'] });
    assert.match(messagesOf(judge(steps, edition)), /job deploy-production deploys, so it must need the verdict job/);
    assert.match(messagesOf(judge(steps, edition)), /deploys through the reusable \.\/\.github\/workflows\/stack-deploy\.yml/);

    const lax = compliant(edition);
    lax.jobs.verdict = job([{ run: 'echo verdict' }], { needs: ['plan', 'fast'], if: '${{ success() }}' });
    lax.jobs.images = { uses: './.github/workflows/other.yml', needs: 'plan', steps: [] };
    const messages = messagesOf(judge(lax, edition));
    assert.match(messages, /verdict job must need every other job; it does not need lint, test, coverage, build, images/);
    assert.match(messages, /verdict job runs under if: always\(\)/);
    assert.match(messages, /images job calls the reusable \.\/\.github\/workflows\/images\.yml/);
  });

  test(`${edition}: ${FAILURE} violation - a missing job, a stray job and the unit run outside test are refused`, () => {
    const doc = compliant(edition);
    delete doc.jobs.build;
    delete doc.jobs.plan;
    doc.jobs.extra = job([checkout]);
    doc.jobs.fast!.steps.push({ name: 'unit', run: 'npx jest' });
    const found = judge(doc, edition);
    assert.ok(found.every((finding) => finding.code === FAILURE));
    const messages = found.filter((finding) => finding.item === 'job-shape').map((finding) => finding.message).join('\n');
    assert.match(messages, /missing plan, build/);
    assert.match(messages, /not in the standard extra/);
    assert.match(messages, /unit run must be a step of the test job alone/);
  });

  test(`${edition}: ${FAILURE} reject - an unpinned action, a missing timeout, a short history and a small heap are each named`, () => {
    const doc = compliant(edition);
    doc.jobs.fast!.steps[0] = { uses: 'actions/checkout@v4' };
    delete doc.jobs.build!['timeout-minutes'];
    doc.jobs.lint.steps[2]!['env'] = { NODE_OPTIONS: '--max-old-space-size=2048' };
    const found = items(judge(doc, edition));
    for (const item of ['sha-pinned-actions', 'timeouts', 'full-history-base-ref', 'heap-per-step']) assert.ok(found.includes(item), item);
  });

  test(`${edition}: ${FAILURE} negative - sharding, lint matrix, sonar side, cache and provider probe violations are flagged`, () => {
    const doc = compliant(edition);
    delete doc.jobs.test.strategy;
    doc.jobs.lint.strategy!.matrix.side = ['be'];
    doc.jobs.lint.steps.push({ run: 'starci app lint --out reports/lint.sonar.json', env: HEAP });
    doc.jobs.fast!.steps.push({ uses: `actions/cache@${SHA}`, with: { key: 'k-${{ github.sha }}' } });
    doc.jobs.coverage.steps[3]!['continue-on-error'] = true;
    const found = items(judge(doc, edition));
    for (const item of ['test-sharding', 'lint-parallel', 'sonar-lint-per-side', 'cache-saved-always', 'required-providers']) assert.ok(found.includes(item), item);
  });

  test(`${edition}: ${FAILURE} fail - the app check reads only the managed ci.yml of an app root`, (t) => {
    const root = mkdtemp(t, 'hfs-ci-standard-');
    const doc = compliant(edition);
    delete doc.jobs.fast;
    const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
    write(FILE, JSON.stringify(doc));
    write('.github/workflows/other.yml', JSON.stringify({ jobs: {} }));
    const ctx = { repoRoot: root, files: [FILE, '.github/workflows/other.yml'], repo: { kind: 'app', edition }, isRoot: true };
    const found = ciStandardAppFindings(ctx);
    assert.ok(found.length > 0 && found.every((finding) => finding.code === FAILURE && finding.path === FILE));
    assert.deepEqual(ciStandardAppFindings({ ...ctx, isRoot: false }), []);
  });

  test(`${edition}: a conforming ci.yml on disk is accepted by the app check`, (t) => {
    const root = mkdtemp(t, 'hfs-ci-standard-');
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, FILE), JSON.stringify(compliant(edition)));
    assert.deepEqual(ciStandardAppFindings({ repoRoot: root, files: [FILE], repo: { kind: 'app', edition }, isRoot: true }), []);
  });
}

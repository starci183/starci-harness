// proves: CI_STANDARD@lite
// proves: CI_STANDARD@full
// proves: HFS_DEPLOY_WORKFLOW@lite
// proves: HFS_DEPLOY_WORKFLOW@full
// proves: HFS_APP_WORKFLOW_TRIGGER@lite
// proves: HFS_APP_WORKFLOW_TRIGGER@full
// proves: CI_TRIGGERS_RELEASE_ONLY@lite
// proves: CI_TRIGGERS_RELEASE_ONLY@full
// proves: HFS_RELEASE_TAG_MISMATCH@lite
// proves: HFS_RELEASE_TAG_MISMATCH@full
// proves: HFS_SBOM_MISSING@lite
// proves: HFS_SBOM_MISSING@full
// proves: HFS_WORKFLOW_CONTEXT@lite
// proves: HFS_WORKFLOW_CONTEXT@full
// The delivery pipeline `starci app sync` renders (contexts/project/cicd.md, ruling app-cicd-auto-deploy): ci.yml plans, checks, builds the images once, judges the
// verdict and calls the reusable stack-deploy.yml for every environment with deploy.auto; images.yml and stack-deploy.yml are reusable workflows. Every rendered file
// is judged by the same rules an app is, is prettier-stable and (when the machine has it) accepted by actionlint.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { qualityServices } from '../runtime/scripts/hfs/ci-declaration.mjs';
import { ciStandardFindings } from '../runtime/scripts/hfs/rules/ci-standard.mjs';
import { deployWorkflowFindings } from '../runtime/scripts/hfs/rules/deploy-workflow.mjs';
import { releaseProvenanceFindings } from '../runtime/scripts/hfs/rules/release-provenance.mjs';
import { supplyChainFindings } from '../runtime/scripts/hfs/rules/supply-chain.mjs';
import { workflowContextsFindings } from '../runtime/scripts/hfs/rules/workflow-contexts.mjs';
import { gitTriggerFindings } from '../runtime/scripts/hfs/runtime-rules/git-triggers.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { renderTargets, retiredFiles } from '../sync/index.mjs';
import type { DeclaredStack } from '../sync/stack-images.mjs';
import { declaredStack } from '../sync/stack-images.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

// reason: a workflow document is parsed-YAML-shaped data the cases read freely.
type Doc = any;
// reason: the stub carries only the facts the workflow templates read.
type AppSource = NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;

const WORKFLOWS = ['ci', 'images', 'stack-deploy', 'stack-key-restore'];
const environment = (name: string, auto = true) => ({ name, auto, approval: 'none' as const, platforms: ['linux/amd64'] });
const TWO: DeclaredStack = {
  images: [{ service: 'api', app: 'core', buildArgs: false, sealed: false }, { service: 'web', app: 'web', buildArgs: true, sealed: true }],
  passEnv: ['PUBLIC_HOST'],
  imageEnvironments: { production: ['core', 'web'], staging: ['core'] },
  environments: [environment('staging'), environment('production')],
  imageCache: 'gha',
};

/** The managed workflows of the sample app in an edition, by file name without the extension. */
function rendered(edition: string, stack: DeclaredStack, quality?: Record<string, unknown>): Record<string, string> {
  const source = { files: [], read: () => '', stack, hasImage: () => true, ...(quality ? { quality, qualityDeclared: true } : {}) } as unknown as AppSource;
  const targets = renderTargets({ ...structuredClone(APP), edition }, PRESETS, { source });
  return Object.fromEntries(targets.filter((target) => target.path.startsWith('.github/workflows/')).map((target) => [path.basename(target.path, '.yml'), target.content]));
}

const files = (workflows: Record<string, string>) => Object.keys(workflows).map((name) => `.github/workflows/${name}.yml`);
const reader = (workflows: Record<string, string>) => (file: string) => workflows[path.basename(file, '.yml')] ?? null;
const tree = (t: TestContext, workflows: Record<string, string>, version = '1.2.3') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-ci-pipeline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', version }));
  for (const [name, text] of Object.entries(workflows)) fs.writeFileSync(path.join(root, '.github', 'workflows', `${name}.yml`), text);
  return root;
};

for (const edition of ['lite', 'full']) {
  test(`${edition}: the pipeline renders plan, checks, images, verdict and a deploy call per auto environment, in declared order`, () => {
    const workflows = rendered(edition, TWO);
    const ci: Doc = parseWorkflow(workflows['ci']!);
    assert.deepEqual(Object.keys(ci.jobs).filter((id) => !['fast', 'lint', 'test', 'coverage', 'build', 'sonar'].includes(id)), ['plan', 'images', 'verdict', 'deploy-staging', 'deploy-production']);
    assert.deepEqual(ci.on.pull_request, { branches: ['main'] });
    assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
    assert.equal(ci.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
    assert.equal(ci.jobs.images.uses, './.github/workflows/images.yml');
    assert.deepEqual(ci.jobs.verdict.needs, ['plan', 'fast', 'lint', 'test', 'coverage', 'build', 'images', 'sonar']);
    assert.equal(ci.jobs.verdict.if, '${{ always() }}');
    assert.deepEqual(ci.jobs['deploy-staging'].needs, ['plan', 'verdict', 'images']);
    assert.deepEqual(ci.jobs['deploy-production'].needs, ['plan', 'verdict', 'images', 'deploy-staging']);
    for (const name of ['deploy-staging', 'deploy-production']) {
      const call: Doc = ci.jobs[name];
      assert.equal(call.uses, './.github/workflows/stack-deploy.yml');
      assert.equal(call.environment, undefined, 'a call of a reusable workflow binds no environment itself');
      assert.equal(call.with.environment, name.slice('deploy-'.length));
      assert.equal(call.with.auto, true);
      assert.equal(call.with.images, '${{ needs.images.outputs.refs }}');
      assert.equal(call.with.ci_run, '${{ needs.plan.outputs.ci_run }}');
      assert.equal(call.concurrency['cancel-in-progress'], false);
      assert.equal(call.if, "${{ needs.plan.outputs.release == 'true' }}");
    }
    // The checks never run on a plan that left them out, and sonar and the Codecov upload run on every full run.
    for (const id of ['fast', 'lint', 'test', 'build']) assert.equal(ci.jobs[id].if, "${{ needs.plan.outputs.checks == 'true' }}", id);
    assert.equal(ci.jobs.sonar.if, "${{ needs.plan.outputs.full == 'true' }}");
    const upload = ci.jobs.coverage.steps.find((step: Doc) => step.name === 'coverage upload');
    assert.equal(upload.if, "${{ !cancelled() && needs.plan.outputs.full == 'true' }}");
  });

  test(`${edition}: the plan job decides full, defer and reuse from the event, the ref and the green candidate run`, () => {
    const ci: Doc = parseWorkflow(rendered(edition, TWO)['ci']!);
    const plan: Doc = ci.jobs.plan.steps.find((step: Doc) => step.id === 'plan');
    assert.equal(ci.jobs.plan.permissions.actions, 'read');
    assert.match(plan.run, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}&event=push&status=success/u, 'the candidate run of the same commit is reused');
    assert.match(plan.run, /startswith\("release\/candidate-"\)/u);
    assert.match(plan.run, /git tag --points-at "\$GITHUB_SHA" --list 'v\*'/u, 'a main push of a tagged commit defers to the tag run');
    assert.match(plan.run, /does not match the package version/u);
    for (const output of ['checks', 'images', 'push', 'full', 'release', 'ci_run']) assert.ok(ci.jobs.plan.outputs[output], output);
    assert.equal(ci.jobs.plan.steps[0].with['fetch-depth'], 0);
  });

  test(`${edition}: images.yml is a reusable workflow: sha tags, SBOM and provenance, the sealed job on a release only, the digests collected`, () => {
    const images: Doc = parseWorkflow(rendered(edition, TWO)['images']!);
    assert.deepEqual(Object.keys(images.on), ['workflow_call']);
    assert.deepEqual(Object.keys(images.on.workflow_call.inputs), ['push', 'release']);
    assert.equal(images.on.workflow_call.outputs.refs.value, '${{ jobs.collect.outputs.refs }}');
    assert.deepEqual(Object.keys(images.jobs), ['image', 'image-sealed', 'collect']);
    assert.equal(images.jobs.image.environment, undefined, 'an image with no sealed build value builds with no environment and no secret');
    assert.equal(images.jobs['image-sealed'].environment, 'production');
    assert.equal(images.jobs['image-sealed'].if, '${{ inputs.release }}');
    assert.deepEqual(images.jobs['image-sealed'].strategy.matrix.include.map((entry: Doc) => entry.name), ['web']);
    for (const id of ['image', 'image-sealed']) {
      const build = images.jobs[id].steps.find((step: Doc) => String(step.uses).startsWith('docker/build-push-action@'));
      assert.equal(build.with.tags, '${{ steps.names.outputs.repo }}:sha-${{ github.sha }}', 'only the immutable commit tag is pushed by the build');
      assert.equal(build.with.sbom, true);
      assert.equal(build.with.provenance, 'mode=max');
      assert.equal(build.with.platforms, 'linux/amd64');
      assert.equal(build.with.push, '${{ inputs.push && matrix.deployed }}');
      assert.equal(build.with['cache-from'], 'type=gha,scope=${{ matrix.name }}');
      const retag = images.jobs[id].steps.find((step: Doc) => step.name === 'tag the release');
      assert.match(retag.run, /imagetools create --tag "\$REPO:\$GITHUB_REF_NAME" "\$REPO:sha-\$GITHUB_SHA"/u, 'the release name is a retag of the digest, not a rebuild');
      assert.match(retag.if, /^\$\{\{ inputs\.release && inputs\.push/u);
    }
    assert.equal(images.jobs['image-sealed'].steps.some((step: Doc) => step.env?.SOPS_AGE_KEY), true);
    assert.equal(images.jobs.image.steps.some((step: Doc) => step.env?.SOPS_AGE_KEY), false, 'the public job reads no secret');
    const collect = images.jobs.collect.steps.find((step: Doc) => step.id === 'refs');
    assert.match(collect.run, /api core false\nweb web true\nLIST/u);
    assert.match(collect.run, /\^sha256:\[0-9a-f\]\{64\}\$/u, 'only a digest is accepted');
  });

  test(`${edition}: stack-deploy.yml is reusable and dispatchable, brakes on STARCI_DEPLOY_PAUSED and opens only the age key of its environment`, () => {
    const text = rendered(edition, TWO)['stack-deploy']!;
    const deploy: Doc = parseWorkflow(text);
    assert.deepEqual(Object.keys(deploy.on).sort(), ['workflow_call', 'workflow_dispatch']);
    assert.deepEqual(deploy.on.workflow_dispatch.inputs.operation.options, ['deploy', 'redeploy', 'rollback']);
    assert.deepEqual(Object.keys(deploy.jobs), ['deploy', 'rollback']);
    for (const id of ['deploy', 'rollback']) {
      assert.equal(deploy.jobs[id].environment, '${{ inputs.environment }}');
      assert.equal(deploy.jobs[id].concurrency.group, 'stack-${{ inputs.environment }}');
      assert.equal(deploy.jobs[id].concurrency['cancel-in-progress'], false);
    }
    const brake = deploy.jobs.deploy.steps.find((step: Doc) => step.id === 'pause');
    assert.equal(brake.env.PAUSED, '${{ vars.STARCI_DEPLOY_PAUSED }}');
    assert.equal(brake.env.AUTO, '${{ inputs.auto }}', 'only an automatic deploy is braked: the dispatch still works');
    const paused = deploy.jobs.deploy.steps.slice(deploy.jobs.deploy.steps.indexOf(brake) + 1);
    assert.ok(paused.length > 5 && paused.every((step: Doc) => String(step.if).includes("steps.pause.outputs.paused != 'true'")), 'every step after the brake waits for it');
    const run = deploy.jobs.deploy.steps.find((step: Doc) => step.name === 'deploy the release');
    assert.match(run.run, /starci app stack deploy --env "\$STACK_ENVIRONMENT" \\\n\s+--image "api=\$IMAGE_API" \\\n\s+--image "web=\$IMAGE_WEB" \\\n\s+--sha "\$GITHUB_SHA" --ci-run "\$CI_RUN"/u);
    assert.equal(run.env.IMAGE_API, '${{ steps.images.outputs.api }}');
    assert.equal(run.env.PUBLIC_HOST, '${{ vars.PUBLIC_HOST }}');
    // Nothing but the server identity is a secret of a deploy: the transport is the sealed member vps-ci, and the log names no host.
    const secrets = [...text.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]);
    assert.deepEqual([...new Set(secrets)], ['SOPS_AGE_KEY']);
    assert.doesNotMatch(text, /VPS_SSH_KEY|VPS_KNOWN_HOSTS|VPS_HOST|VPS_USER/u);
    assert.match(text, /vps-ci/u);
    // The images are read from the registry by the workflow token, never pushed by a deploy.
    assert.equal(deploy.jobs.deploy.permissions.packages, 'read');
    assert.match(String(deploy.jobs.deploy.steps.find((step: Doc) => step.name === 'CI run of the commit').run), /no green CI run of this commit/u);
  });

  test(`${edition}: the rendered pipeline passes the rules that judge an app, and is prettier-stable`, (t) => {
    const workflows = rendered(edition, TWO);
    const root = tree(t, workflows);
    const ctx = { repoRoot: root, files: files(workflows), repo: { kind: 'app', edition }, isRoot: true, read: reader(workflows) };
    assert.deepEqual(deployWorkflowFindings(ctx), []);
    assert.deepEqual(supplyChainFindings(ctx).filter((finding) => ['HFS_WORKFLOW_PIN', 'HFS_SBOM_MISSING', 'HFS_AUDIT_STEP_MISSING'].includes(finding.code)), []);
    assert.deepEqual(releaseProvenanceFindings({ repoRoot: root, files: ['package.json', ...files(workflows)], repo: { kind: 'app', edition }, isRoot: true }), []);
    assert.deepEqual(workflowContextsFindings(ctx), []);
    assert.deepEqual(gitTriggerFindings(ctx), []);
    assert.deepEqual(ciStandardFindings({ doc: parseWorkflow(workflows['ci']!), file: '.github/workflows/ci.yml', scope: 'app-ci', edition }), []);
    for (const name of WORKFLOWS.filter((workflow) => workflows[workflow])) {
      const text = workflows[name]!;
      assert.doesNotMatch(text, /^\s*(?:pull_request_target|workflow_run|schedule)\s*:/mu, name);
      assert.doesNotMatch(text, /self-hosted/u, name);
      assert.doesNotMatch(text, /continue-on-error|\|\| true/u, name);
    }
  });

  test(`${edition}: actionlint accepts the rendered pipeline when the machine has it`, (t) => {
    const probe = spawnSync('actionlint', ['-version'], { encoding: 'utf8', windowsHide: true });
    if (probe.error || probe.status !== 0) return t.skip('actionlint is not installed here');
    const workflows = rendered(edition, TWO);
    const root = tree(t, workflows);
    const out = spawnSync('actionlint', ['-shellcheck=', ...files(workflows).map((file) => path.join(root, file))], { encoding: 'utf8', windowsHide: true });
    assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
  });

  test(`${edition}: an app with no auto environment renders no deploy job; one with no image renders no collect job and no images input`, () => {
    const manual: DeclaredStack = { ...TWO, environments: [environment('staging', false), environment('production', false)] };
    assert.deepEqual(Object.keys(parseWorkflow(rendered(edition, manual)['ci']!).jobs).filter((id) => id.startsWith('deploy-')), []);
    const bare = rendered(edition, { images: [], passEnv: [], imageEnvironments: {}, environments: [] });
    const images: Doc = parseWorkflow(bare['images']!);
    assert.deepEqual(Object.keys(images.jobs), ['image']);
    assert.equal(images.on.workflow_call.outputs, undefined);
    const ci: Doc = parseWorkflow(bare['ci']!);
    assert.equal(Object.keys(ci.jobs).some((id) => id.startsWith('deploy-')), false);
  });

  test(`${edition}: with Sonar disabled the verdict neither needs nor expects a sonar job`, () => {
    const quality = qualityServices({ services: { sonar: { mode: 'disabled' } } });
    const ci: Doc = parseWorkflow(rendered(edition, TWO, quality)['ci']!);
    assert.equal(ci.jobs.sonar, undefined);
    assert.deepEqual(ci.jobs.verdict.needs, ['plan', 'fast', 'lint', 'test', 'coverage', 'build', 'images']);
    assert.doesNotMatch(String(ci.jobs.verdict.steps[0].run), /expect sonar/u);
    assert.deepEqual(ciStandardFindings({ doc: ci, file: '.github/workflows/ci.yml', scope: 'app-ci', edition }), []);
  });

  test(`${edition}: ci.imageCache registry caches the layers in the registry, deploy.platforms adds QEMU for another architecture`, () => {
    const registry = parseWorkflow(rendered(edition, { ...TWO, imageCache: 'registry' })['images']!);
    const build = registry.jobs.image.steps.find((step: Doc) => String(step.uses).startsWith('docker/build-push-action@'));
    assert.equal(build.with['cache-from'], 'type=registry,ref=${{ steps.names.outputs.repo }}:buildcache');
    assert.match(build.with['cache-to'], /type=registry,ref=\{0\}:buildcache,mode=max/u);
    const arm = parseWorkflow(rendered(edition, { ...TWO, environments: [{ ...environment('production'), platforms: ['linux/amd64', 'linux/arm64'] }] })['images']!);
    const armBuild = arm.jobs.image.steps.find((step: Doc) => String(step.uses).startsWith('docker/build-push-action@'));
    assert.equal(armBuild.with.platforms, 'linux/amd64,linux/arm64');
    assert.ok(arm.jobs.image.steps.some((step: Doc) => String(step.uses).startsWith('docker/setup-qemu-action@')));
  });
}

test('lite: sync retires the db-deploy.yml workflow; full keeps its own', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-deploy-retired-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'db-deploy.yml'), 'name: deploy database\n');
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), ['.github/workflows/db-deploy.yml']);
  assert.deepEqual(retiredFiles(root, { edition: 'full' }), []);
  assert.equal(rendered('lite', TWO)['db-deploy'], undefined);
});

test('the declaration projects deploy.auto, approval, platforms, ci.imageCache and the sealed build values into the declared stack', () => {
  const stack = declaredStack({
    ci: { imageCache: 'registry' },
    environments: {
      staging: { deploy: { auto: true, platforms: ['linux/arm64'], images: { api: { app: 'core' } } } },
      production: { deploy: { approval: 'reviewers', images: { api: { app: 'core', buildArgs: { sealed: { member: 'web', keys: ['NEXT_PUBLIC_A'] } } } } } },
      empty: {},
    },
  });
  assert.equal(stack.imageCache, 'registry');
  assert.deepEqual(stack.environments, [
    { name: 'staging', auto: true, approval: 'none', platforms: ['linux/arm64'] },
    { name: 'production', auto: false, approval: 'reviewers', platforms: ['linux/amd64'] },
  ]);
  assert.equal(stack.images.find((image) => image.service === 'api')?.sealed, true);
  assert.equal(declaredStack({}).imageCache, 'gha');
});

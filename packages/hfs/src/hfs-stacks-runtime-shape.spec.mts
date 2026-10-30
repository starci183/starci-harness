// proves: HFS_STACKS_SHAPE@lite
// proves: HFS_STACKS_SHAPE@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { stacksRuntimeFindings } from '../runtime/scripts/hfs/rules/stacks-runtime.mjs';
import { checkApplicationStacks, trackedStacksGateFindings } from '../runtime/scripts/hfs/stacks-gate.mjs';
import { applicationStackFindings } from '../runtime/scripts/hfs/starcistacks-runtime.mjs';
import { checkStarciStacks } from '../runtime/scripts/gates/starcistacks.mjs';
import type { SwarmFixture } from './helpers/swarm-stack-fixture.mjs';
import { swarmFixture, swarmService } from './helpers/swarm-stack-fixture.mjs';

const code = 'HFS_STACKS_SHAPE';
function runtimeContext(fixture: SwarmFixture, edition: string) {
  return { repoRoot: fixture.root, files: [...fixture.files], all: [...fixture.files],
    repo: { profile: 'app', edition }, isRoot: true };
}

function runtimeInput(fixture: SwarmFixture, edition: string) {
  return { repoRoot: fixture.root, files: [...fixture.files], doc: fixture.manifest, edition };
}

for (const edition of ['lite', 'full']) {
  test(`${code} ${edition}: accepts pinned Swarm runtime through the app and stack gates`, t => {
    const fixture = swarmFixture(t, edition);
    assert.deepEqual(stacksRuntimeFindings(runtimeInput(fixture, edition)), []);
    assert.deepEqual(applicationStackFindings(fixture.root), []);
    assert.deepEqual(checkApplicationStacks({ repoRoot: fixture.root, environment: 'production',
      deploymentModelFile: fixture.modelFile, repo: { edition } }).errors.filter(item => item.code === code), []);
    assert.deepEqual(trackedStacksGateFindings(runtimeContext(fixture, edition)).filter(item => item.code === code), []);
    assert.deepEqual(checkStarciStacks(fixture.root).findings.filter(item => item.code === code), []);
  });

  test(`${code} ${edition}: rejects an unpinned Swarm image through the app and stack gates`, t => {
    const fixture = swarmFixture(t, edition);
    fixture.model.services.api.image = 'registry.example.org/app:latest';
    fixture.write();
    assert.ok(stacksRuntimeFindings(runtimeInput(fixture, edition)).some(item => item.code === code));
    assert.ok(applicationStackFindings(fixture.root).some(item => item.code === code));
    assert.ok(checkApplicationStacks({ repoRoot: fixture.root, environment: 'production',
      deploymentModelFile: fixture.modelFile, repo: { edition } }).errors.some(item => item.code === code));
    assert.ok(trackedStacksGateFindings(runtimeContext(fixture, edition)).some(item => item.code === code));
    assert.ok(checkStarciStacks(fixture.root).findings.some(item => item.code === code));
  });
}

function developmentFixture(t: TestContext, edition: string, runtime: string) {
  const fixture = swarmFixture(t, edition);
  const productionModel = structuredClone(fixture.model), write = fixture.write;
  const stackFile = runtime === 'docker-swarm' ? 'infra/swarm/stack.yaml' : 'infra/compose/stack.yaml';
  const image = `registry.example.org/dependency@sha256:${'c'.repeat(64)}`;
  fixture.manifest.components.dependency = { role: 'stateful', image };
  fixture.model.services.dependency = swarmService(image);
  const spec = structuredClone(fixture.manifest.environments.production);
  spec.runtime = runtime;
  spec.composeFiles = [stackFile];
  spec.secrets = [];
  spec.components = { api: {}, ingress: {}, dependency: {} };
  fixture.manifest.environments.dev = spec;
  fixture.put('.starcistacks/dev/README.md', ['| command | purpose |', '|---|---|',
    ...['prepare', 'doctor', 'up', 'status', 'logs', 'down', 'verification'].map(command => `| ${command} | Development lifecycle |`)].join('\n'));
  fixture.write = () => {
    write();
    fixture.put(fixture.stackFile, JSON.stringify(productionModel));
    fixture.put(`.starcistacks/dev/${stackFile}`, JSON.stringify(fixture.model));
  };
  fixture.write();
  return fixture;
}

function dependencyFindings(fixture: SwarmFixture, edition: string) {
  return checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
    deploymentModelFile: fixture.modelFile, repo: { edition } }).errors
    .filter(item => item.code === code && item.path.startsWith('services.dependency'));
}

for (const [edition, runtime] of [['lite', 'docker-swarm'], ['full', 'docker-compose'], ['full', 'docker-swarm']] as [string, string][]) {
  test(`STACK-DEV ${edition} ${runtime}: the selected dependency runs in a Linux Docker service`, t => {
    const fixture = developmentFixture(t, edition, runtime);
    fixture.model.services.dependency.platform = 'linux/amd64';
    fixture.write();
    assert.deepEqual(dependencyFindings(fixture, edition), []);
  });

  test(`STACK-DEV ${edition} ${runtime}: an omitted or host-only dependency is refused`, t => {
    const fixture = developmentFixture(t, edition, runtime);
    for (const service of [undefined, {}, { command: 'redis-server' }, { external_links: ['host.docker.internal:cache'] }]) {
      if (service === undefined) delete fixture.model.services.dependency;
      else fixture.model.services.dependency = service;
      fixture.write();
      assert.ok(dependencyFindings(fixture, edition).some(item => item.path === 'services.dependency'));
    }
  });

  test(`STACK-DEV ${edition} ${runtime}: a Windows dependency container is refused`, t => {
    const fixture = developmentFixture(t, edition, runtime);
    fixture.model.services.dependency.platform = 'windows/amd64';
    fixture.write();
    assert.ok(dependencyFindings(fixture, edition).some(item => item.path === 'services.dependency.platform'));
  });

  test(`STACK-DEV ${edition} ${runtime}: free-text dependency roles still require Docker`, t => {
    const fixture = developmentFixture(t, edition, runtime);
    delete fixture.model.services.dependency;
    for (const role of ['cache', 'database', 'message-broker', 'custom-store']) {
      fixture.manifest.components.dependency = { role };
      fixture.write();
      assert.ok(dependencyFindings(fixture, edition).some(item => item.path === 'services.dependency'), role);
    }
  });
}

test('STACK-DEV full: a native application can be outside the dependency Docker model', t => {
  const fixture = developmentFixture(t, 'full', 'docker-compose');
  delete fixture.model.services.api;
  fixture.write();
  const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
    deploymentModelFile: fixture.modelFile, repo: { edition: 'full' } }).errors;
  assert.deepEqual(errors.filter(item => item.code === code), []);
});

test('STACK-DEV full: explicit app identities keep custom application roles outside the dependency Docker model', t => {
  const fixture = developmentFixture(t, 'full', 'docker-compose');
  delete fixture.model.services.api;
  for (const { component, repo } of [
    { component: { role: 'custom-application', app: 'api' }, repo: { edition: 'full' } },
    { component: { role: 'custom-application' }, repo: fixture.declaration },
    { component: { role: 'custom-application' } },
  ]) {
    fixture.manifest.components.api = component;
    fixture.write();
    const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
      deploymentModelFile: fixture.modelFile, repo }).errors;
    assert.deepEqual(errors.filter(item => item.code === code), []);
  }
});

test('STACK-DEV full: an unknown app reference cannot hide a selected dependency', t => {
  const fixture = developmentFixture(t, 'full', 'docker-compose');
  fixture.manifest.components.dependency = { role: 'service', app: 'undeclared-app' };
  delete fixture.model.services.dependency;
  fixture.write();
  const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
    deploymentModelFile: fixture.modelFile }).errors;
  assert.ok(errors.some(item => item.code === code && item.path === 'components.dependency.app'));
});

test('STACK-DEV: malformed HFS declaration cannot silently remove application identity checks', t => {
  const fixture = developmentFixture(t, 'full', 'docker-compose');
  for (const declaration of ['{ invalid JSON', 'null', '[]']) {
    fixture.put('hfs.json', declaration);
    const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
      deploymentModelFile: fixture.modelFile }).errors;
    assert.ok(errors.some(item => item.code === code && item.path === 'hfs.json'));
  }
});

test('STACK-DEV full Compose: a dependency may declare a Docker build instead of an image', t => {
  const fixture = developmentFixture(t, 'full', 'docker-compose');
  for (const build of ['.', { context: '.', dockerfile: 'Dockerfile' }]) {
    fixture.model.services.dependency = { build };
    fixture.write();
    assert.deepEqual(dependencyFindings(fixture, 'full'), []);
  }
});

for (const edition of ['lite', 'full']) {
  test(`STACK-DEV ${edition}: a host runtime cannot replace the Docker dependency runtime`, t => {
    const fixture = developmentFixture(t, edition, 'native');
    const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'dev',
      deploymentModelFile: fixture.modelFile, repo: { edition } }).errors;
    assert.ok(errors.some(item => item.code === 'runtime-invalid' && item.path === 'environments.dev.runtime'));
  });

  test(`STACK-DEV ${edition}: a hosted non-Supabase backing cannot replace Docker in dev or production`, t => {
    const fixture = developmentFixture(t, edition, 'docker-swarm');
    fixture.manifest.backing.primary = { provider: 'external-postgres', managed: true };
    fixture.write();
    for (const environment of ['dev', 'production']) {
      const errors = checkApplicationStacks({ repoRoot: fixture.root, environment,
        deploymentModelFile: fixture.modelFile, repo: { edition } }).errors;
      assert.ok(errors.some(item => item.code === 'schema-shape-invalid' && item.path === '$/backing/primary/provider'));
    }
  });
}

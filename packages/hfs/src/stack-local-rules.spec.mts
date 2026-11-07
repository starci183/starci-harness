// R372 and R373 (rules/stacks-local.mts): a lite app declares a runnable dev environment, the local block is coherent, and the dev runbook names the
// harness verb instead of docker commands. Also the least grants a compose service mounts (STACK_GRANT_<NAME>).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stacksLocalFindings } from '../runtime/scripts/hfs/rules/stacks-local.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';

const LOCAL = `    local:
      ports: {db: 54322}
      services: [{name: db, wait: healthy}]
`;
const GOOD_RUNBOOK = '# dev\n\nRun `starci app stack up --env dev --execute`.\n';

function app(t: { after: (fn: () => void) => void }, { environment = `  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n${LOCAL}`, runbook = GOOD_RUNBOOK }: { environment?: string; runbook?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stacks-local-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project: 'demo' }));
  const dev = path.join(root, '.starcistacks', 'dev');
  fs.mkdirSync(path.join(dev, 'infra', 'compose'), { recursive: true });
  fs.writeFileSync(path.join(dev, 'infra', 'compose', 'compose.yaml'), 'services:\n  db:\n    image: postgres\n');
  fs.writeFileSync(path.join(dev, 'README.md'), runbook);
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n${environment}`);
  return root;
}

const run = (root: string) => stacksLocalFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' } as never, isRoot: true });
const codes = (root: string): string[] => run(root).map((finding) => finding.code);

test('R372 a coherent dev environment with a runbook that names the verb raises nothing', (t) => {
  assert.deepEqual(codes(app(t)), []);
});

test('R372 a lite app without a docker-compose environment is STACKS_DEV_UNDECLARED, and a swarm dev is not one', (t) => {
  const swarm = app(t, { environment: '  dev:\n    status: supported\n    runtime: docker-swarm\n    composeFiles: [infra/swarm/stack.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n' });
  assert.deepEqual(codes(swarm), ['STACKS_DEV_UNDECLARED']);
});

test('R372 a docker-compose environment without a local block, or with a service the compose files lack, is STACKS_LOCAL_CONFIG_INVALID', (t) => {
  const bare = app(t, { environment: '  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n' });
  assert.deepEqual(codes(bare), ['STACKS_LOCAL_CONFIG_INVALID']);
  const ghost = app(t, { environment: `  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n    local:\n      ports: {cache: 6380}\n      services: [{name: cache, wait: tcp, port: cache}]\n` });
  const findings = run(ghost);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? '', /cache is not a service of the compose files of dev/u);
});

test('R373 a docker command in the dev runbook, or no one-command start, is STACKS_RUNBOOK_DOCKER_COMMAND', (t) => {
  const docker = app(t, { runbook: '# dev\n\n```sh\ndocker compose up -d\n```\n\nRun `starci app stack up --env dev --execute`.\n' });
  const dockerFindings = run(docker);
  assert.deepEqual(dockerFindings.map((finding) => finding.code), ['STACKS_RUNBOOK_DOCKER_COMMAND']);
  assert.match(dockerFindings[0]?.path ?? '', /README\.md:4$/u);
  const manual = app(t, { runbook: '# dev\n\nStart it by hand.\n' });
  assert.match(run(manual)[0]?.message ?? '', /does not name `starci app stack up --env dev`/u);
});

test('a grant names the keys one service reads, and an empty one is refused', () => {
  const ok = normalizeLocal({ ports: { db: 54322 }, services: [{ name: 'db', wait: 'started' }], grants: [{ name: 'agent', keys: ['OPENCLAW_BRIDGE_SECRET'] }] }, { project: 'demo', env: 'dev' });
  assert.deepEqual(ok.config?.grants, [{ name: 'agent', keys: ['OPENCLAW_BRIDGE_SECRET'] }]);
  const empty = normalizeLocal({ ports: { db: 54322 }, services: [{ name: 'db', wait: 'started' }], grants: [{ name: 'agent', keys: [] }] }, { project: 'demo', env: 'dev' });
  assert.match(empty.problems.map((item) => item.message).join('|'), /must list the keys the service reads/u);
});

test('a lite app may run its dev environment on docker-compose and a backing image in it, but not in a Swarm environment', async () => {
  const { stacksRuntimeFindings } = await import('../runtime/scripts/hfs/rules/stacks-runtime.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stacks-runtime-'));
  try {
    const doc = (swarmBinds: boolean) => ({
      backing: { db: { provider: 'postgres', component: 'db' } },
      components: { db: { role: 'stateful', image: 'demo/db:1' }, 'demo-minio': { role: 'stateful', image: 'ghcr.io/starci183/minio:RELEASE.2025-10-15T17-29-55Z-starci.1' } },
      environments: {
        dev: { runtime: 'docker-compose', composeFiles: ['infra/compose/compose.yaml'], components: { db: {}, 'demo-minio': {} }, local: { ports: { db: 54322 } } },
        production: { runtime: 'docker-swarm', composeFiles: ['infra/swarm/stack.yaml'], components: swarmBinds ? { db: {}, 'demo-minio': {} } : { db: {} } },
      },
    });
    const messages = (swarmBinds: boolean): string[] => stacksRuntimeFindings({ repoRoot: root, files: [], doc: doc(swarmBinds), edition: 'lite' }).map((finding: { message: string }) => finding.message);
    assert.ok(!messages(false).some((text) => /lite runs no backing image/u.test(text)), 'a backing image only the dev environment binds is allowed');
    assert.ok(!messages(false).some((text) => /environments\.dev lite delivery/u.test(text)), 'a docker-compose dev environment with a local block is lite delivery');
    assert.ok(messages(true).some((text) => /lite runs no backing image/u.test(text)), 'a backing image a Swarm environment binds is still refused');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

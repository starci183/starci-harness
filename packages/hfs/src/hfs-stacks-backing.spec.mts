// proves: STACKS_LITE_SELFHOSTED_DB
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backingIssues, stacksBackingFindings } from '../runtime/scripts/hfs/rules/stacks-backing.mjs';
import type { Repo } from '../runtime/scripts/hfs/rules/rule-types.mjs';

/** A component of the stack inventory (application-stacks.yaml components). */
interface Component {
  role?: string;
  app?: string;
  image?: string;
  stateful?: boolean;
  database?: { provider?: string | undefined; volume?: string };
  volumes?: string[];
}
type Mount = string | { type: string; source: string; target: string; read_only?: boolean };
/** A service of the rendered stack model. */
interface Service {
  image?: string;
  command?: string | string[];
  volumes?: Mount[];
  environment?: unknown;
}
/** The inventory, the rendered model and the repository declaration one check judges. */
interface Fixture {
  doc: {
    components: { api: Component; automation: Component; [name: string]: Component | undefined };
    environments: { production: object };
    backing: object;
  };
  spec: { runtime: string; composeFiles: string[]; components: object };
  model: {
    services: { api: Service; automation: Service; [name: string]: Service | undefined };
    volumes?: Record<string, object | null>;
  };
  environment: string;
  repo: Repo;
}

const DECLARATION = '.starcistacks/application-stacks.yaml';
const STACK_FILE = '.starcistacks/production/infra/swarm/stack.yaml';
const SQLITE_DATA_DIR = path.posix.join(path.posix.sep, 'home', 'node', '.n8n');
const pinned = (image: string) => `${image}@sha256:${'b'.repeat(64)}`;
const REDIS_IMAGE = pinned('redis:7.4.3');
const PERSISTED_REDIS = { image: REDIS_IMAGE, command: ['redis-server', '--appendonly', 'yes'], volumes: ['redis-data:/data'] };

function fixture(): Fixture {
  const spec = { runtime: 'docker-swarm', composeFiles: ['infra/swarm/stack.yaml'], components: { api: {}, automation: {} } };
  const doc = {
    components: {
      api: { role: 'service', app: 'api', image: pinned('app/api:1.0.0') },
      automation: { role: 'sidecar', stateful: true, image: pinned('n8nio/n8n:1.64.3'), database: { provider: 'sqlite', volume: 'automation-data' }, volumes: ['automation-data'] },
    },
    environments: { production: spec }, backing: { db: { provider: 'postgres', component: 'db' } },
  };
  const model = {
    services: { api: { image: pinned('app/api:1.0.0') }, automation: { image: pinned('n8nio/n8n:1.64.3'), volumes: [`automation-data:${SQLITE_DATA_DIR}`] } },
    volumes: { 'automation-data': {} },
  };
  return { doc, spec, model, environment: 'production', repo: {} };
}

const issuesFor = (value: Fixture, code: string) => backingIssues(value).filter(issue => issue.code === code);

test('STACKS_LITE_SELFHOSTED_DB: managed Supabase and SQLite sidecar pass', () => {
  assert.deepEqual(issuesFor(fixture(), 'STACKS_LITE_SELFHOSTED_DB'), []);
});

test('STACKS_LITE_SELFHOSTED_DB: Postgres and Mongo images and an undeclared Redis in inventory and rendered model fail', () => {
  for (const image of ['postgres:16.9', 'vendor/postgresql:16.9', 'redis:7.4.3', 'redis-stack-server:7.4.0', 'mongo:8.0.0', 'mongodb/mongodb-community-server:8.0.0']) {
    for (const source of ['inventory', 'rendered']) {
      const value = fixture();
      if (source === 'inventory') value.doc.components.database = { role: 'service', image: pinned(image) };
      else value.model.services.database = { image: pinned(image) };
      const issues = issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB');
      assert.equal(issues.length, 1, `${source} ${image}`);
      assert.equal(issues[0]!.at, `${source === 'inventory' ? 'components' : 'services'}.database.image`);
    }
  }
});

test('STACKS_LITE_SELFHOSTED_DB: declared Redis runs; undeclared Redis and Postgres stay refused', () => {
  const value = fixture();
  value.repo.sides = { be: { backing: ['redis'] } };
  value.doc.components.redis = { role: 'stateful', image: REDIS_IMAGE };
  value.model.services.redis = PERSISTED_REDIS;
  value.model.volumes!['redis-data'] = {};
  assert.deepEqual(issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB'), []);
  value.repo.sides!['be'].backing = [];
  assert.deepEqual(issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB').map(issue => issue.at), ['components.redis.image', 'services.redis.image']);
  value.repo.sides!['be'].backing = ['redis'];
  value.model.services.database = { image: pinned('postgres:16.9') };
  assert.equal(issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB').length, 1);
});

test('STACKS_LITE_SELFHOSTED_DB: Qdrant is admitted when declared and refused when undeclared', () => {
  for (const [backing, expected] of [[['qdrant'], []], [[], ['components.vector.image', 'services.vector.image']]] as [string[], string[]][]) {
    const value = fixture();
    value.repo.sides = { be: { backing } };
    value.doc.components.vector = { role: 'stateful', image: pinned('qdrant/qdrant:v1.12.4') };
    value.model.services.vector = { image: pinned('qdrant/qdrant:v1.12.4') };
    assert.deepEqual(issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB').map(issue => issue.at), expected);
  }
});

test('STACKS_LITE_SELFHOSTED_DB: image tags and application names do not masquerade as backing images', () => {
  const value = fixture();
  value.doc.components.api.image = pinned('app/redis-worker:1.0.0');
  value.model.services.api.image = pinned('app/api:postgres');
  assert.deepEqual(issuesFor(value, 'STACKS_LITE_SELFHOSTED_DB'), []);
});

test('R276: non-Swarm development environment retains its existing contract', () => {
  const value = fixture();
  value.spec.runtime = 'docker-compose';
  value.doc.components.database = { role: 'stateful', image: pinned('postgres:16.9') };
  assert.deepEqual(backingIssues(value), []);
});

/** What the tracked-file finder reads of an app root. */
interface FinderContext { repoRoot: string; files: string[]; repo: Repo }

function trackedFixture(value: Fixture, run: (context: FinderContext) => void) {
  const base = path.resolve(os.tmpdir());
  const repoRoot = fs.mkdtempSync(path.join(base, 'backing-spec-'));
  try {
    for (const [file, doc] of [[DECLARATION, value.doc], [STACK_FILE, value.model]] as [string, object][]) {
      const target = path.join(repoRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(doc));
    }
    run({ repoRoot, files: [DECLARATION, STACK_FILE], repo: value.repo });
  } finally {
    assert.ok(repoRoot.startsWith(`${base}${path.sep}`));
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

const finderMutations = [
  { code: 'STACKS_LITE_SELFHOSTED_DB', violate(value: Fixture) { value.model.services.cache = { image: pinned('redis:7.4.3') }; } },
];

for (const { code, violate } of finderMutations) {
  test(`${code}: tracked managed backing and SQLite sidecar pass the finder`, () => {
    trackedFixture(fixture(), context => {
      assert.deepEqual(stacksBackingFindings(context).filter(finding => finding.code === code), []);
    });
  });

  test(`${code}: tracked violating backing evidence fails the finder`, () => {
    const value = fixture();
    violate(value);
    trackedFixture(value, context => {
      assert.ok(stacksBackingFindings(context).some(finding => finding.code === code));
    });
  });
}

test('R276 HFS finder reads rendered services and reports standard lite findings', () => {
  const value = fixture();
  value.model.services.cache = { image: pinned('redis:7.4.3') };
  trackedFixture(value, context => {
    const findings = stacksBackingFindings(context);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.code, 'STACKS_LITE_SELFHOSTED_DB');
    assert.equal(findings[0]!.level, 'error');
    assert.equal(findings[0]!.path, STACK_FILE);
  });
});

test('R276 HFS finder leaves unavailable rendered evidence unaffected', () => {
  trackedFixture(fixture(), context => {
    context.files = [DECLARATION];
    assert.deepEqual(stacksBackingFindings(context), []);
  });
});

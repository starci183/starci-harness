// proves: STACKS_INGRESS_INVALID
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingressIssues, stacksIngressFindings } from '../runtime/scripts/hfs/rules/stacks-ingress.mjs';

const DECLARATION = '.starcistacks/application-stacks.yaml';
const STACK_FILE = '.starcistacks/production/infra/swarm/stack.yaml';
const pinned = (image: string) => `${image}@sha256:${'a'.repeat(64)}`;

interface Component { role?: string; image: string }
/** The shape of an ingress evidence fixture: the inventory, the environment declaration and the rendered model the ingress contract judges. */
interface Fixture {
  doc: { components: Record<string, Component>; environments: Record<string, unknown> };
  spec: { runtime: string; composeFiles: string[]; components: Record<string, object>; ingress?: { component?: string; hosts?: string[]; external?: unknown } };
  model: { services: Record<string, { image: string }> };
  environment: string;
  repo: { edition: string };
}
type Mutation = (value: Fixture) => void;
type Context = { repoRoot: string; files: string[]; repo: { edition: string } };

function fixture(edition: string, image = 'traefik:v3.6'): Fixture {
  const spec = {
    runtime: 'docker-swarm', composeFiles: ['infra/swarm/stack.yaml'],
    components: { edge: {}, api: {} }, ingress: { component: 'edge', hosts: ['app.example.test'] },
  };
  const doc = {
    components: { edge: { role: 'ingress', image: pinned(image) }, api: { role: 'service', image: pinned('app/api:1.0.0') } },
    environments: { production: spec },
  };
  const model = { services: { edge: { image: pinned(image) }, api: { image: pinned('app/api:1.0.0') } } };
  return { doc, spec, model, environment: 'production', repo: { edition } };
}

/** One finding code carries several detections; a detection is named CODE/part and told apart by its message. */
const PARTS: Record<string, (message: string) => boolean> = {
  second: message => message.includes('second ingress') || message.includes('exactly one ingress') || message.includes('must not render an ingress of its own'),
  unknown: message => message.includes('Traefik or Caddy pinned'),
  undeclared: message => !PARTS.second!(message) && !PARTS.unknown!(message),
};
const detects = (name: string, item: { code: string; message: string }) => {
  const [code, part] = name.split('/');
  return item.code === code && (part === undefined || PARTS[part]!(item.message));
};
const issuesFor = (value: Fixture, name: string) => ingressIssues(value).filter(issue => detects(name, issue));

for (const edition of ['lite'] as const) {
  test(`STACKS_INGRESS_INVALID/undeclared@${edition}: inventoried, bound and deployed ingress passes`, () => {
    assert.deepEqual(issuesFor(fixture(edition), 'STACKS_INGRESS_INVALID/undeclared'), []);
  });

  test(`STACKS_INGRESS_INVALID/undeclared@${edition}: missing declaration, inventory, ingress role, binding or service fails`, () => {
    const mutations: Mutation[] = [
      (value) => { delete value.spec.ingress; },
      (value) => { delete value.doc.components.edge; },
      (value) => { value.doc.components.edge!.role = 'service'; },
      (value) => { delete value.spec.components.edge; },
      (value) => { delete value.model.services.edge; },
    ];
    for (const mutate of mutations) {
      const value = fixture(edition);
      mutate(value);
      assert.ok(issuesFor(value, 'STACKS_INGRESS_INVALID/undeclared').length > 0);
    }
  });

  test(`STACKS_INGRESS_INVALID/unknown@${edition}: digest-pinned Traefik and Caddy both pass`, () => {
    for (const image of ['traefik:v3.6', 'caddy:2.10.2', 'registry.example.test:5000/vendor/caddy:2.10.2', 'lucaslorentz/caddy-docker-proxy:2.10.0'])
      assert.deepEqual(ingressIssues(fixture(edition, image)), []);
  });

  test(`STACKS_INGRESS_INVALID/unknown@${edition}: unknown ingress image and tag-only image fail`, () => {
    assert.ok(issuesFor(fixture(edition, 'nginx:1.28.0'), 'STACKS_INGRESS_INVALID/unknown').length > 0);
    for (const source of ['inventory', 'rendered']) {
      const value = fixture(edition);
      if (source === 'inventory') value.doc.components.edge!.image = 'traefik:v3.6';
      else value.model.services.edge!.image = 'traefik:v3.6';
      assert.ok(issuesFor(value, 'STACKS_INGRESS_INVALID/unknown').length > 0);
    }
  });

  test(`STACKS_INGRESS_INVALID/second@${edition}: one declared ingress passes`, () => {
    assert.deepEqual(issuesFor(fixture(edition), 'STACKS_INGRESS_INVALID/second'), []);
  });

  test(`STACKS_INGRESS_INVALID/second@${edition}: a second rendered Caddy is refused despite its service role`, () => {
    const value = fixture(edition);
    value.doc.components.preview = { role: 'service', image: pinned('caddy:2.10.2') };
    value.spec.components.preview = {};
    value.model.services.preview = { image: pinned('caddy:2.10.2') };
    assert.equal(issuesFor(value, 'STACKS_INGRESS_INVALID/second').length, 1);
    assert.ok(issuesFor(value, 'STACKS_INGRESS_INVALID/undeclared').length > 0);
  });

  test(`STACKS_INGRESS_INVALID/second@${edition}: unlisted rendered ingress and second declared ingress are detected`, () => {
    const value = fixture(edition);
    value.model.services.hidden = { image: pinned('docker.io/library/caddy:2.10.2') };
    assert.equal(issuesFor(value, 'STACKS_INGRESS_INVALID/second').length, 1);
    delete value.model.services.hidden;
    value.doc.components.hidden = { role: 'ingress', image: pinned('nginx:1.28.0') };
    value.spec.components.hidden = {};
    value.model.services.hidden = { image: pinned('nginx:1.28.0') };
    assert.equal(issuesFor(value, 'STACKS_INGRESS_INVALID/second').length, 1);
    assert.ok(issuesFor(value, 'STACKS_INGRESS_INVALID/unknown').length > 0);
  });
}

test('R275: non-Swarm development environment retains its existing contract', () => {
  const value = fixture('lite');
  value.spec.runtime = 'docker-compose';
  delete value.spec.ingress;
  assert.deepEqual(ingressIssues(value), []);
});

function trackedFixture(value: Fixture, run: (context: Context) => void) {
  const base = path.resolve(os.tmpdir());
  const repoRoot = fs.mkdtempSync(path.join(base, 'ingress-spec-'));
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
  { code: 'STACKS_INGRESS_INVALID/undeclared', violate(value: Fixture) { delete value.spec.ingress; } },
  { code: 'STACKS_INGRESS_INVALID/unknown', violate(value: Fixture) { value.model.services.edge!.image = pinned('nginx:1.28.0'); } },
  { code: 'STACKS_INGRESS_INVALID/second', violate(value: Fixture) { value.model.services.preview = { image: pinned('caddy:2.10.2') }; } },
];

for (const edition of ['lite'] as const) {
  for (const { code, violate } of finderMutations) {
    test(`${code}@${edition}: tracked declared digest-pinned ingress passes the finder`, () => {
      trackedFixture(fixture(edition), context => {
        assert.deepEqual(stacksIngressFindings(context).filter((finding) => detects(code, finding)), []);
      });
    });

    test(`${code}@${edition}: tracked violating ingress evidence fails the finder`, () => {
      const value = fixture(edition);
      violate(value);
      trackedFixture(value, context => {
        assert.ok(stacksIngressFindings(context).some((finding) => detects(code, finding)));
      });
    });
  }
}

test('R275 HFS finder reads the tracked model and returns standard findings for both editions', () => {
  for (const edition of ['lite'] as const) {
    const value = fixture(edition);
    delete value.spec.ingress;
    trackedFixture(value, context => {
      const findings = stacksIngressFindings(context);
      assert.ok(findings.some((finding) => detects('STACKS_INGRESS_INVALID/undeclared', finding)));
      for (const finding of findings) {
        assert.equal(finding.level, 'error');
        assert.equal(finding.path, STACK_FILE);
        assert.ok(finding.message.startsWith(`${STACK_FILE}: `));
      }
    });
  }
});

test('R275 HFS finder leaves unavailable rendered model evidence to R267', () => {
  trackedFixture(fixture('lite'), context => {
    context.files = [DECLARATION];
    assert.deepEqual(stacksIngressFindings(context), []);
  });
});

// An application whose ingress is a shared stack outside its own: `ingress.external.stack` instead of `ingress.component`.
function externalFixture(edition: string) {
  const value = fixture(edition);
  delete value.doc.components.edge;
  delete value.spec.components.edge;
  delete value.model.services.edge;
  value.spec.ingress = { external: { stack: 'ingress' }, hosts: ['app.example.test'] };
  return value;
}

for (const edition of ['lite'] as const) {
  test(`STACKS_INGRESS_INVALID/undeclared@${edition}: an external shared ingress passes when the stack renders no ingress of its own`, () => {
    assert.deepEqual(ingressIssues(externalFixture(edition)), []);
  });

  test(`STACKS_INGRESS_INVALID/undeclared@${edition}: an external ingress needs its stack name, its hosts and no component`, () => {
    const mutations: Mutation[] = [
      (value) => { value.spec.ingress!.external = {}; },
      (value) => { value.spec.ingress!.external = { stack: '  ' }; },
      (value) => { value.spec.ingress!.external = 'ingress'; },
      (value) => { delete value.spec.ingress!.hosts; },
      (value) => { value.spec.ingress!.hosts = []; },
      (value) => { value.spec.ingress!.component = 'edge'; },
    ];
    for (const mutate of mutations) {
      const value = externalFixture(edition);
      mutate(value);
      assert.ok(issuesFor(value, 'STACKS_INGRESS_INVALID/undeclared').length > 0);
    }
  });

  test(`STACKS_INGRESS_INVALID/second@${edition}: an external ingress next to an ingress rendered in the stack is refused`, () => {
    const value = externalFixture(edition);
    value.model.services.edge = { image: pinned('traefik:v3.6') };
    assert.equal(issuesFor(value, 'STACKS_INGRESS_INVALID/second').length, 1);
  });
}

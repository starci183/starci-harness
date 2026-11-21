// proves: STACKS_SECRET_NOT_EXTERNAL
// proves: STACKS_SECRET_UNVERSIONED
// proves: STACKS_SECRET_ENV_LITERAL
// proves: STACKS_PORT_PUBLISHED
// proves: STACKS_SECOND_INGRESS
// proves: STACKS_DNS_UNDECLARED
// proves: STACKS_HOST_UNROUTED
// proves: STACKS_TLS_UNDECLARED
// proves: STACKS_PLACEMENT_MISSING
// proves: STACKS_HEALTHCHECK_MISSING
// proves: STACKS_UPDATE_POLICY_MISSING
import test from 'node:test';
import type { TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { swarmFixture, swarmService } from './helpers/swarm-stack-fixture.mjs';
import type { SwarmFixture } from './helpers/swarm-stack-fixture.mjs';
import { swarmHardeningIssues, stacksSwarmFindings } from '../runtime/scripts/hfs/rules/stacks-swarm.mjs';
import { ingressIssues } from '../runtime/scripts/hfs/rules/stacks-ingress.mjs';

import { OR_TRUE, SEMI_TRUE } from './fixtures/loosening/swallows.mjs';

const DECLARATION = '.starcistacks/application-stacks.yaml';
const ROUTE = 'traefik.http.routers.api.rule';
const pinned = (image: string) => `${image}@sha256:${'a'.repeat(64)}`;

function fixture(t: TestContext, edition = 'lite') {
  const value = swarmFixture(t, edition);
  const spec = value.manifest.environments.production;
  value.manifest.components.ingress.image = pinned('traefik:v3.6');
  value.model.services.ingress.image = value.manifest.components.ingress.image;
  value.model.services.ingress.ports = [{ published: 443, target: 443, mode: 'ingress' }];
  spec.ingress = { component: 'ingress', hosts: ['app.example.test'] };
  spec.dns = [{ host: 'app.example.test', owner: 'application operator', receipt: 'docs/dns.md' }];
  spec.tls = { owner: 'application operator', receipt: 'docs/tls.md' };
  spec.secrets = [{ name: 'database-url', runtimeName: 'swarm-app-database-url-v1', version: 1 }];
  value.model.services.api.environment = { DATABASE_URL_FILE: '/run/secrets/database-url' };
  value.model.services.api.deploy.labels = { [ROUTE]: 'Host(`app.example.test`)' };
  value.write();
  return value;
}

const inputFor = (value: SwarmFixture) => ({ doc: value.manifest, spec: value.manifest.environments.production,
  model: value.model, environment: 'production', repo: value.declaration, repoRoot: value.root, files: [...value.files] });
const issuesFor = (value: SwarmFixture, code: string) => swarmHardeningIssues(inputFor(value)).filter(issue => issue.code === code);
const finderContext = (value: SwarmFixture) => ({ repoRoot: value.root, files: [...value.files], repo: value.declaration, isRoot: true });

const cases = [
  { code: 'STACKS_SECRET_NOT_EXTERNAL', violate(value: SwarmFixture) { value.model.secrets['database-url'].external = false; } },
  { code: 'STACKS_SECRET_UNVERSIONED', violate(value: SwarmFixture) { value.model.secrets['database-url'].name = 'swarm-app-database-url'; } },
  { code: 'STACKS_SECRET_ENV_LITERAL', violate(value: SwarmFixture) { value.model.services.api.environment = { API_TOKEN: 'synthetic-fixture-value' }; } },
  { code: 'STACKS_PORT_PUBLISHED', violate(value: SwarmFixture) { value.model.services.api.ports = ['3000:3000']; } },
  { code: 'STACKS_DNS_UNDECLARED', violate(value: SwarmFixture) { delete value.manifest.environments.production.dns; } },
  { code: 'STACKS_HOST_UNROUTED', violate(value: SwarmFixture) { delete value.model.services.api.deploy.labels; } },
  { code: 'STACKS_TLS_UNDECLARED', violate(value: SwarmFixture) { delete value.manifest.environments.production.tls; } },
  { code: 'STACKS_PLACEMENT_MISSING', violate(value: SwarmFixture) { value.model.services.api.volumes = ['data:/data']; } },
  { code: 'STACKS_HEALTHCHECK_MISSING', violate(value: SwarmFixture) { delete value.model.services.api.healthcheck; } },
  { code: 'STACKS_UPDATE_POLICY_MISSING', violate(value: SwarmFixture) { delete value.model.services.api.deploy.update_config; } },
];

for (const edition of ['lite'] as const) {
  for (const { code, violate } of cases) {
    test(`${code}@${edition}: declared safe Swarm service passes`, t => {
      const value = fixture(t, edition);
      assert.deepEqual(swarmHardeningIssues(inputFor(value)), []);
      assert.deepEqual(issuesFor(value, code), []);
    });

    test(`${code}@${edition}: violating rendered evidence fails`, t => {
      const value = fixture(t, edition);
      violate(value);
      assert.ok(issuesFor(value, code).length > 0);
      value.write();
      assert.ok(stacksSwarmFindings(finderContext(value)).some(finding => finding.code === code));
    });
  }

  test(`STACKS_SECOND_INGRESS@${edition}: single ingress passes and a second rendered ingress fails`, t => {
    const value = fixture(t, edition);
    assert.deepEqual(ingressIssues(inputFor(value)), []);
    value.model.services.preview = swarmService(pinned('caddy:2.10.2'));
    assert.ok(ingressIssues(inputFor(value)).some(issue => issue.code === 'STACKS_SECOND_INGRESS'));
  });

  test(`STACKS_SECRET_NOT_EXTERNAL@${edition}: embedded sources, undeclared grants and absent secrets fail`, t => {
    const value = fixture(t, edition);
    for (const key of ['file', 'environment', 'content', 'value']) {
      value.model.secrets['database-url'][key] = 'synthetic-source';
      assert.ok(issuesFor(value, 'STACKS_SECRET_NOT_EXTERNAL').length > 0);
      delete value.model.secrets['database-url'][key];
    }
    value.model.services.api.secrets = ['undeclared'];
    assert.ok(issuesFor(value, 'STACKS_SECRET_NOT_EXTERNAL').length > 0);
    delete value.model.secrets['database-url'];
    assert.ok(issuesFor(value, 'STACKS_SECRET_NOT_EXTERNAL').length > 0);
  });

  test(`STACKS_SECRET_UNVERSIONED@${edition}: declared version must match the immutable runtime name`, t => {
    const value = fixture(t, edition), declaration = value.manifest.environments.production.secrets[0];
    for (const version of [undefined, 0, -1, '1.5', 2]) {
      declaration.version = version;
      assert.ok(issuesFor(value, 'STACKS_SECRET_UNVERSIONED').length > 0);
    }
    declaration.version = 1;
    declaration.runtimeName = 'different-v1';
    assert.ok(issuesFor(value, 'STACKS_SECRET_UNVERSIONED').length > 0);
    declaration.runtimeName = 'swarm-app-database-url-v1';
    assert.deepEqual(issuesFor(value, 'STACKS_SECRET_UNVERSIONED'), []);
    value.manifest.environments.production.secrets = [];
    assert.ok(issuesFor(value, 'STACKS_SECRET_UNVERSIONED').length > 0);
  });

  test(`STACKS_SECRET_ENV_LITERAL@${edition}: granted target works and another service's file fails`, t => {
    const value = fixture(t, edition);
    value.model.services.api.secrets = [{ source: 'database-url', target: 'db-uri' }];
    value.model.services.api.environment = ['DATABASE_URL_FILE=/run/secrets/db-uri', 'LOG_LEVEL=info'];
    assert.deepEqual(issuesFor(value, 'STACKS_SECRET_ENV_LITERAL'), []);
    value.model.services.ingress.environment = { DATABASE_URL_FILE: '/run/secrets/db-uri' };
    assert.ok(issuesFor(value, 'STACKS_SECRET_ENV_LITERAL').length > 0);
    delete value.model.services.ingress.environment;
    value.model.services.api.environment = { DATABASE_URL_FILE: '/run/secrets/database-url' };
    assert.ok(issuesFor(value, 'STACKS_SECRET_ENV_LITERAL').length > 0);
  });

  test(`STACKS_SECRET_ENV_LITERAL@${edition}: sensitive names, inline credentials and inherited bindings fail`, t => {
    const value = fixture(t, edition);
    const credential = randomBytes(12).toString('hex');
    const violations = [
      { OPENAI_API_KEY: 'synthetic-fixture-value' }, { SUPABASE_SERVICE_ROLE: 'synthetic-fixture-value' },
      // The inline credentials are generated for this run, never committed.
      { DATABASE_URL: `postgres://fixture:${credential}@db.example.test/app` },
      { CONNECTION: `redis://:${credential}@cache.example.test` },
      { DATABASE_URL_FILE: `postgres://fixture:${credential}@db.example.test/app` },
      ['API_TOKEN'], { API_TOKEN_FILE: '/tmp/token' },
    ];
    for (const environment of violations) {
      value.model.services.api.environment = environment;
      assert.ok(issuesFor(value, 'STACKS_SECRET_ENV_LITERAL').length > 0);
    }
  });

  test(`STACKS_PORT_PUBLISHED@${edition}: ingress exposes only 80/443 and never host mode`, t => {
    const value = fixture(t, edition);
    value.model.services.ingress.ports = ['80:8080/tcp', '443:443/tcp'];
    assert.deepEqual(issuesFor(value, 'STACKS_PORT_PUBLISHED'), []);
    for (const ports of [['8080:80'], ['443'], [{ published: 8080, target: 80, mode: 'host' }]]) {
      value.model.services.ingress.ports = ports;
      assert.ok(issuesFor(value, 'STACKS_PORT_PUBLISHED').length > 0);
    }
  });

  test(`STACKS_PORT_PUBLISHED@${edition}: the ingress may publish 80/443 in host mode, once pinned or global, and no other service may`, t => {
    const value = fixture(t, edition), ingress = value.model.services.ingress;
    ingress.ports = [{ published: 80, target: 80, mode: 'host' }, { published: 443, target: 443, mode: 'host' }];
    ingress.deploy = { ...ingress.deploy, placement: { constraints: ['node.labels.ingress == true'] } };
    assert.deepEqual(issuesFor(value, 'STACKS_PORT_PUBLISHED'), []);
    ingress.deploy = { ...ingress.deploy, mode: 'global', placement: undefined };
    assert.deepEqual(issuesFor(value, 'STACKS_PORT_PUBLISHED'), []);
    ingress.deploy = { ...ingress.deploy, mode: 'replicated', placement: undefined };
    assert.ok(issuesFor(value, 'STACKS_PORT_PUBLISHED').length > 0, 'host mode without global mode or a placement constraint');
    ingress.ports = [{ published: 443, target: 443, mode: 'ingress' }];
    assert.deepEqual(issuesFor(value, 'STACKS_PORT_PUBLISHED'), []);
    value.model.services.api.ports = [{ published: 443, target: 3000, mode: 'host' }];
    assert.ok(issuesFor(value, 'STACKS_PORT_PUBLISHED').length > 0, 'a non-ingress service in host mode');
  });

  test(`STACKS_DNS_UNDECLARED@${edition}: each rendered route needs its own owner and receipt`, t => {
    const value = fixture(t, edition), spec = value.manifest.environments.production;
    value.model.services.api.deploy.labels[ROUTE] = 'Host(`app.example.test`, `admin.example.test`)';
    spec.ingress.hosts.push('admin.example.test');
    assert.ok(issuesFor(value, 'STACKS_DNS_UNDECLARED').length > 0);
    spec.dns.push({ host: 'admin.example.test', owner: 'operator', receipt: 'docs/admin-dns.md' });
    assert.deepEqual(issuesFor(value, 'STACKS_DNS_UNDECLARED'), []);
    delete spec.dns[1].receipt;
    assert.ok(issuesFor(value, 'STACKS_DNS_UNDECLARED').length > 0);
    spec.dns[1].receipt = 'docs/admin-dns.md';
    delete spec.dns[1].owner;
    assert.ok(issuesFor(value, 'STACKS_DNS_UNDECLARED').length > 0);
  });

  test(`STACKS_HOST_UNROUTED@${edition}: labels must bind declared hosts using the selected ingress`, t => {
    const value = fixture(t, edition);
    value.model.services.api.deploy.labels[ROUTE] = 'Host(`other.example.test`)';
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
    for (const rule of ['!Host(`app.example.test`)', '!(Host(`app.example.test`))', 'Host(`https://app.example.test/path`)']) {
      value.model.services.api.deploy.labels = { [ROUTE]: rule };
      assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
    }
    value.model.services.api.deploy.labels = { [ROUTE]: 'Host(`app.example.test`) && !Path(`/private`)' };
    assert.deepEqual(issuesFor(value, 'STACKS_HOST_UNROUTED'), []);
    value.model.services.api.deploy.labels = { caddy: 'app.example.test' };
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
    value.model.services.api.deploy.labels = { [ROUTE]: 'Host(`app.example.test`)', 'traefik.enable': 'false' };
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
  });

  test(`STACKS_TLS_UNDECLARED@${edition}: issuance receipt and owner are both required`, t => {
    const value = fixture(t, edition), spec = value.manifest.environments.production;
    for (const tls of [{ owner: 'operator' }, { receipt: 'docs/tls.md' }, { owner: '', receipt: 'docs/tls.md' }]) {
      spec.tls = tls;
      assert.ok(issuesFor(value, 'STACKS_TLS_UNDECLARED').length > 0);
    }
  });

  test(`STACKS_PLACEMENT_MISSING@${edition}: stateful components and persistent volumes pin a node`, t => {
    const value = fixture(t, edition), service = value.model.services.api;
    value.manifest.components.api.stateful = true;
    assert.ok(issuesFor(value, 'STACKS_PLACEMENT_MISSING').length > 0);
    service.deploy.placement = { constraints: ['node.labels.storage == app'] };
    assert.deepEqual(issuesFor(value, 'STACKS_PLACEMENT_MISSING'), []);
    delete value.manifest.components.api.stateful;
    service.volumes = [{ type: 'volume', source: 'app-data', target: '/data' }];
    assert.deepEqual(issuesFor(value, 'STACKS_PLACEMENT_MISSING'), []);
    service.deploy.placement.constraints = [''];
    assert.ok(issuesFor(value, 'STACKS_PLACEMENT_MISSING').length > 0);
  });

  test(`STACKS_HEALTHCHECK_MISSING@${edition}: disabled, empty and always successful probes fail`, t => {
    const value = fixture(t, edition), service = value.model.services.api;
    const healthchecks = [{ disable: true, test: ['CMD', 'curl', '-f', '/live'] }, { test: ['NONE'] },
      { test: [] }, { test: ['CMD-SHELL', 'true'] }, { test: ['CMD-SHELL', 'exit 0'] },
      { test: ['CMD-SHELL', `curl -f http://localhost/live ${OR_TRUE}`] }, { test: ['CMD', 'echo', 'ok'] },
      { test: ['CMD-SHELL', 'false; exit 0'] }, { test: ['CMD-SHELL', `curl -f http://localhost/live${SEMI_TRUE}`] }];
    for (const healthcheck of healthchecks) {
      service.healthcheck = healthcheck;
      assert.ok(issuesFor(value, 'STACKS_HEALTHCHECK_MISSING').length > 0);
    }
    service.healthcheck = { test: ['CMD', 'curl', '-f', 'http://localhost/health/live'] };
    assert.deepEqual(issuesFor(value, 'STACKS_HEALTHCHECK_MISSING'), []);
  });

  test(`STACKS_UPDATE_POLICY_MISSING@${edition}: update, rollback and restart contracts are mandatory`, t => {
    const value = fixture(t, edition), deploy = value.model.services.api.deploy;
    const valid = structuredClone(deploy);
    for (const key of ['update_config', 'rollback_config', 'restart_policy']) {
      delete deploy[key];
      assert.ok(issuesFor(value, 'STACKS_UPDATE_POLICY_MISSING').length > 0);
      Object.assign(deploy, structuredClone(valid));
    }
    for (const monitor of ['0s', '30', '-1s', '30s garbage', 0, Number.POSITIVE_INFINITY]) {
      deploy.update_config.monitor = monitor;
      assert.ok(issuesFor(value, 'STACKS_UPDATE_POLICY_MISSING').length > 0);
    }
    deploy.update_config.monitor = '1m30s';
    assert.deepEqual(issuesFor(value, 'STACKS_UPDATE_POLICY_MISSING'), []);
    deploy.update_config.failure_action = 'pause';
    assert.ok(issuesFor(value, 'STACKS_UPDATE_POLICY_MISSING').length > 0);
  });
}

test('R266 tracked finder uses renderedModel and returns standard findings for both editions', t => {
  for (const edition of ['lite'] as const) {
    const value = fixture(t, edition), renderedFile = '.starcistacks/production/infra/swarm/rendered.json';
    value.manifest.environments.production.renderedModel = 'infra/swarm/rendered.json';
    value.write();
    value.put(renderedFile, JSON.stringify(value.model));
    assert.deepEqual(stacksSwarmFindings(finderContext(value)), []);
    const rendered = structuredClone(value.model);
    delete rendered.services.api.healthcheck;
    value.put(renderedFile, JSON.stringify(rendered));
    const findings = stacksSwarmFindings(finderContext(value));
    assert.ok(findings.some(finding => finding.code === 'STACKS_HEALTHCHECK_MISSING'));
    for (const finding of findings) {
      assert.equal(finding.level, 'error');
      assert.equal(finding.path, renderedFile);
      assert.ok(finding.message.startsWith(`${renderedFile}: services.api.`));
    }
    value.files.delete(renderedFile);
    assert.deepEqual(stacksSwarmFindings(finderContext(value)), []);
  }
});

test('R266 tracked finder uses all files and runs at the app root only', t => {
  const value = fixture(t);
  delete value.model.services.api.healthcheck;
  value.write();
  const context = finderContext(value);
  assert.ok(stacksSwarmFindings({ ...context, files: [], all: [...value.files] }).length > 0);
  assert.deepEqual(stacksSwarmFindings({ ...context, isRoot: false }), []);
  assert.deepEqual(stacksSwarmFindings({ ...context, repo: { profile: 'runtime' } }), []);
  assert.deepEqual(stacksSwarmFindings({ ...context, files: [value.stackFile] }), []);
  assert.deepEqual(stacksSwarmFindings({ ...context, files: [DECLARATION] }), []);
});

test('R266 Caddy routes require a tracked config or matching docker-proxy labels', t => {
  for (const edition of ['lite'] as const) {
    const value = fixture(t, edition), ingress = value.model.services.ingress;
    ingress.image = pinned('caddy:2.10.2');
    value.manifest.components.ingress.image = ingress.image;
    delete value.model.services.api.deploy.labels;
    ingress.configs = [{ source: 'routes', target: '/etc/caddy/Caddyfile' }];
    value.model.configs = { routes: { file: './Caddyfile' } };
    const config = '.starcistacks/production/infra/swarm/Caddyfile';
    value.put(config, 'app.example.test {\n  reverse_proxy api:3000\n}\n');
    assert.deepEqual(swarmHardeningIssues(inputFor(value)), []);
    value.files.delete(config);
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
    ingress.image = pinned('lucaslorentz/caddy-docker-proxy:2.10.0');
    value.model.services.api.deploy.labels = { caddy: 'app.example.test', 'caddy.reverse_proxy': '{{upstreams 3000}}' };
    assert.deepEqual(issuesFor(value, 'STACKS_HOST_UNROUTED'), []);
  }
});

test('R266 config reads reject secret paths, parent traversal and symlinks', t => {
  const value = fixture(t), ingress = value.model.services.ingress;
  ingress.image = pinned('caddy:2.10.2');
  delete value.model.services.api.deploy.labels;
  ingress.configs = ['routes'];
  const config = '.starcistacks/production/infra/swarm/Caddyfile';
  value.put(config, 'app.example.test {\n  reverse_proxy api:3000\n}\n');
  for (const file of ['../../secrets/routes.enc', '../../../../routes', path.join(value.root, config)]) {
    value.model.configs = { routes: { file } };
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
  }
  const alias = '.starcistacks/production/infra/swarm/Caddy-alias';
  try {
    fs.symlinkSync(path.join(value.root, config), path.join(value.root, alias));
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  value.files.add(alias);
  value.model.configs = { routes: { file: './Caddy-alias' } };
  assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
});

for (const edition of ['lite'] as const) {
  test(`STACKS_HOST_UNROUTED@${edition}: an external shared ingress routes the declared hosts itself, but DNS, TLS and ports stay judged`, t => {
    const value = fixture(t, edition);
    const spec = value.manifest.environments.production;
    delete value.manifest.components.ingress;
    delete value.model.services.ingress;
    delete spec.components?.ingress;
    spec.ingress = { external: { stack: 'ingress' }, hosts: ['app.example.test'] };
    value.model.services.api.deploy.labels = {};
    assert.deepEqual(issuesFor(value, 'STACKS_HOST_UNROUTED'), []);
    assert.deepEqual(issuesFor(value, 'STACKS_DNS_UNDECLARED'), []);
    value.model.services.api.ports = [{ published: 443, target: 3000, mode: 'ingress' }];
    assert.ok(issuesFor(value, 'STACKS_PORT_PUBLISHED').length > 0, 'only the shared ingress may publish ports');
    delete spec.tls;
    assert.ok(issuesFor(value, 'STACKS_TLS_UNDECLARED').length > 0);
    spec.tls = { owner: 'application operator', receipt: 'docs/tls.md' };
    spec.dns = [];
    assert.ok(issuesFor(value, 'STACKS_DNS_UNDECLARED').length > 0);
    delete spec.ingress.external;
    spec.ingress.component = 'ingress';
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0, 'a declared component still needs a route');
  });
}

// A shared edge-traefik (ingress.kind: shared-edge): hosts are declared once, in ingress.routes; the stack file names none, its deploy renders the labels.
for (const edition of ['lite'] as const) {
  test(`STACKS_HOST_UNROUTED@${edition}: a shared edge declares its hosts once in routes, and a hostname written in the stack file is a finding`, t => {
    const value = fixture(t, edition), spec = value.manifest.environments.production;
    delete value.manifest.components.ingress;
    delete value.model.services.ingress;
    delete spec.components?.ingress;
    spec.ingress = { kind: 'shared-edge', network: 'edge', certResolver: 'letsencrypt', routes: [{ host: 'app.example.test', service: 'api', port: 3000 }] };
    value.model.services.api.deploy.labels = {};
    assert.deepEqual(ingressIssues(inputFor(value)), []);
    assert.deepEqual(swarmHardeningIssues(inputFor(value)), [], 'no label in the stack file, the host is declared once');
    value.model.services.api.deploy.labels = { [ROUTE]: 'Host(`app.example.test`)' };
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').some(issue => /names the host app\.example\.test/.test(issue.message)), 'even a declared host must not be hardcoded');
    value.model.services.api.deploy.labels = { [ROUTE]: 'Host(`other.example.test`)' };
    assert.ok(issuesFor(value, 'STACKS_HOST_UNROUTED').length > 0);
    value.model.services.api.deploy.labels = {};
    spec.dns = [];
    assert.ok(issuesFor(value, 'STACKS_DNS_UNDECLARED').length > 0, 'the DNS of each route host stays declared');
    spec.dns = [{ host: 'app.example.test', owner: 'application operator', receipt: 'docs/dns.md' }];
    for (const broken of [{ network: undefined }, { certResolver: undefined }, { routes: [] }, { routes: [{ host: 'a.example.test', service: 'api' }] }, { component: 'ingress' }, { hosts: ['x.example.test'] }]) {
      spec.ingress = { kind: 'shared-edge', network: 'edge', certResolver: 'letsencrypt', routes: [{ host: 'app.example.test', service: 'api', port: 3000 }], ...broken };
      assert.ok(ingressIssues(inputFor(value)).some(issue => issue.code === 'STACKS_INGRESS_UNDECLARED'), JSON.stringify(broken));
    }
    spec.ingress = { component: 'ingress' };
    assert.ok(ingressIssues(inputFor(value)).some(issue => issue.code === 'STACKS_INGRESS_UNDECLARED'), 'an own ingress still declares its hosts');
  });
}

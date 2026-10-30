// proves: HFS_AUTH_COOKIE_DOMAIN_MISSING@lite
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authCookieDomainIssues, commonParentDomain, publicHosts, stacksAuthCookieDomainFindings } from '../runtime/scripts/hfs/rules/stacks-auth-cookie-domain.mjs';

/** A temp tree whose files and directories are removed one by one (never recursively). */
function sandbox(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)), written: string[] = [];
  const write = (rel: string, content: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
    written.push(rel);
  };
  const dispose = () => {
    const directories = new Set<string>();
    for (const rel of written) {
      fs.unlinkSync(path.join(root, rel));
      for (let dir = path.dirname(rel); dir !== '.'; dir = path.dirname(dir)) directories.add(dir);
    }
    for (const dir of [...directories].sort((a, b) => b.length - a.length)) fs.rmdirSync(path.join(root, dir));
    fs.rmdirSync(root);
  };
  return { root, write, dispose };
}

const CODE = 'HFS_AUTH_COOKIE_DOMAIN_MISSING';
const PASSPORT = 'be/src/modules/integrations/passport/passport.config.ts';
const DECLARATION = '.starcistacks/application-stacks.yaml';
const STACK = '.starcistacks/production/infra/swarm/stack.yaml';

interface ModelOptions { web?: string | undefined; api?: string | undefined; cookieDomain?: string | undefined }
const model = ({ web = 'https://app.example.com', api = 'https://api.example.com', cookieDomain }: ModelOptions = {}) => ({
  services: {
    api: { environment: { AUTH_JWT_ISSUER: api, GOOGLE_CALLBACK_URL: `${api}/auth/google/callback`, ...(cookieDomain === undefined ? {} : { AUTH_COOKIE_DOMAIN: cookieDomain }) } },
    web: { environment: { NEXT_PUBLIC_SITE_URL: web } },
  },
});

const issues = (value: unknown, extra: { repoRoot?: string; files?: string[]; passport?: boolean } = {}) => authCookieDomainIssues({ environment: 'production', spec: {}, model: value, files: [], passport: true, ...extra });

test('different hosts without the key: one finding naming both hosts and the common parent domain', () => {
  const found = issues(model());
  assert.equal(found.length, 1);
  assert.equal(found[0]!.code, CODE);
  assert.match(found[0]!.message, /app\.example\.com/u);
  assert.match(found[0]!.message, /api\.example\.com/u);
  assert.match(found[0]!.message, /AUTH_COOKIE_DOMAIN=example\.com/u);
});

test('different hosts with the key set to the parent domain: clean', () => {
  assert.deepEqual(issues(model({ cookieDomain: 'example.com' })), []);
  assert.deepEqual(issues(model({ cookieDomain: 'Example.com' })), []);
});

test('the key set to something that is not a parent of both hosts: a finding', () => {
  for (const cookieDomain of ['other.com', 'api.example.com', 'app.example.com']) {
    const found = issues(model({ cookieDomain }));
    assert.equal(found.length, 1, cookieDomain);
    assert.match(found[0]!.message, /not a parent of/u);
  }
  assert.match(issues(model({ cookieDomain: 'api.example.com' }))[0]!.message, /set it to example\.com/u);
});

test('the key set to a value that is not a bare domain: a finding', () => {
  for (const cookieDomain of ['https://example.com', 'example.com:443', '.example.com', 'localhost'])
    assert.match(issues(model({ cookieDomain }))[0]?.message ?? '', /bare domain/u, cookieDomain);
});

test('same host (a different port or path does not matter): clean without the key', () => {
  assert.deepEqual(issues(model({ web: 'https://example.com', api: 'https://example.com/api' })), []);
  assert.deepEqual(issues(model({ web: 'http://dev.example.com:3000', api: 'http://dev.example.com:3001' })), []);
});

test('the key is provided by KEYS.md or a sealed member without a declared value: clean', () => {
  const { root, write, dispose } = sandbox('cookie-domain-');
  try {
    const roster = '.starcistacks/production/runtime/env/KEYS.md';
    const member = '.starcistacks/production/secrets/api.enc.yaml';
    write(roster, '| `AUTH_COOKIE_DOMAIN` | API cookie domain |\n');
    write(member, 'AUTH_COOKIE_DOMAIN: ENC[AES256_GCM,data:abc]\nsops:\n  age: []\n');
    assert.deepEqual(issues(model(), { repoRoot: root, files: [roster] }), []);
    assert.deepEqual(issues(model(), { repoRoot: root, files: [member] }), []);
    assert.equal(issues(model(), { repoRoot: root, files: [] }).length, 1);
    assert.equal(issues(model(), { repoRoot: root, files: ['.starcistacks/dev/secrets/api.enc.yaml'] }).length, 1);
  } finally {
    dispose();
  }
});

test('hosts: the env, the AUTH_WEB_ORIGIN and the deploy.verify.http fallbacks, a list-form environment', () => {
  assert.deepEqual(publicHosts({ model: model(), spec: {} }), { web: 'app.example.com', api: 'api.example.com' });
  const verify = { deploy: { verify: { http: [{ name: 'web up', url: 'https://app.example.org/' }, { name: 'api up', url: 'https://api.example.org/health' }] } } };
  assert.deepEqual(publicHosts({ model: { services: { api: {}, web: {} } }, spec: verify }), { web: 'app.example.org', api: 'api.example.org' });
  const listed = { services: { api: { environment: ['AUTH_JWT_ISSUER=https://api.example.net', 'AUTH_WEB_ORIGIN=https://app.example.net'] }, web: {} } };
  assert.deepEqual(publicHosts({ model: listed, spec: {} }), { web: 'app.example.net', api: 'api.example.net' });
});

test('an unknown host or a missing service is not judged; no shared parent domain is a finding without a value', () => {
  assert.deepEqual(issues({ services: { api: { environment: { AUTH_JWT_ISSUER: 'https://api.example.com' } }, web: {} } }), []);
  assert.deepEqual(issues({ services: { api: model().services.api } }), []);
  const found = issues(model({ web: 'https://app-example.com', api: 'https://api.example.org' }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /no registrable parent domain/u);
});

test('commonParentDomain: needs two labels and is not a second-level public suffix', () => {
  assert.equal(commonParentDomain('app.example.com', 'api.example.com'), 'example.com');
  assert.equal(commonParentDomain('example.com', 'api.example.com'), 'example.com');
  assert.equal(commonParentDomain('a.com', 'b.com'), undefined);
  assert.equal(commonParentDomain('a.co.uk', 'b.co.uk'), undefined);
  assert.equal(commonParentDomain('app.shop.co.uk', 'api.shop.co.uk'), 'shop.co.uk');
});

test('an app whose api does not use the skeleton passport is not judged', () => {
  assert.deepEqual(issues(model(), { passport: false }), []);
});

function app(files: string[], { web, api, cookieDomain }: ModelOptions = {}) {
  const { root, write, dispose } = sandbox('cookie-domain-app-');
  write(DECLARATION, [
    'schema: starci/application-stacks@1',
    'components:',
    '  api: {role: service, image: "app/api:1@sha256:' + 'a'.repeat(64) + '"}',
    '  web: {role: service, image: "app/web:1@sha256:' + 'a'.repeat(64) + '"}',
    'environments:',
    '  production:',
    '    runtime: docker-swarm',
    '    composeFiles: [infra/swarm/stack.yaml]',
    '    components: {api: {}, web: {}}',
    '',
  ].join('\n'));
  write(STACK, JSON.stringify(model({ web, api, cookieDomain })));
  const all = [DECLARATION, STACK, ...files];
  return { root, all, dispose };
}

test('the finder: a lite app with the skeleton passport and different hosts is reported at the stack file', () => {
  const { root, all, dispose } = app([PASSPORT]);
  try {
    const findings = stacksAuthCookieDomainFindings({ repoRoot: root, all, files: all, isRoot: true, repo: { edition: 'lite', profile: 'app' } });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.code, CODE);
    assert.equal(findings[0]!.level, 'error');
    assert.equal(findings[0]!.path, STACK);
    assert.match(findings[0]!.message, /AUTH_COOKIE_DOMAIN=example\.com/u);
  } finally {
    dispose();
  }
});

test('the finder: key set to the parent is clean; same host is clean; no passport or full edition is not judged', () => {
  const set = app([PASSPORT], { cookieDomain: 'example.com' });
  const same = app([PASSPORT], { web: 'https://example.com', api: 'https://example.com' });
  const bare = app([]);
  try {
    const context = ({ root, all }: { root: string; all: string[] }, edition = 'lite') => ({ repoRoot: root, all, files: all, isRoot: true, repo: { edition, profile: 'app' } });
    assert.deepEqual(stacksAuthCookieDomainFindings(context(set)), []);
    assert.deepEqual(stacksAuthCookieDomainFindings(context(same)), []);
    assert.deepEqual(stacksAuthCookieDomainFindings(context(bare)), []);
    assert.deepEqual(stacksAuthCookieDomainFindings(context({ root: bare.root, all: [...bare.all, PASSPORT] }, 'full')), []);
  } finally {
    for (const { dispose } of [set, same, bare]) dispose();
  }
});

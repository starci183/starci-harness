// proves: HFS_BACKING_UNDECLARED@lite
// proves: HFS_BACKING_UNUSED@lite
// ruling:R212/case-10 and owner:lite-vector-is-pgvector: lite admits declared Redis; vector search uses Supabase pgvector.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { editionFindings } from '../runtime/scripts/hfs/rules/edition.mjs';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { ruleParamsProblems } from '../runtime/scripts/hfs/rule-params-shape.mjs';
import type { Resolver } from '../runtime/scripts/hfs/rules/rule-types.mjs';

// reason: the edition rule only reads `slots()` of the resolver; a full Resolver is not needed to prove it.
const NO_SLOTS = { slots: () => [] } as unknown as Resolver;
const CODES = ['HFS_BACKING_UNDECLARED', 'HFS_BACKING_UNUSED', 'HFS_DECLARATION_INVALID'];

interface BackingFinding { code: string; file: string; name?: string; service?: string; level: string }

function judge(t: TestContext, { edition = 'lite', be = {}, dependencies = {} }: { edition?: string; be?: Record<string, unknown>; dependencies?: Record<string, string> }): BackingFinding[] {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-backing-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const declaration = {
    hfs: 3, kind: 'app', project: 'demo', edition,
    sides: { be: { apps: [{ name: 'api', kind: 'api' }], ...be }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
  };
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ dependencies }));
  return checkRepo({ repoRoot, declaration, files: ['package.json'], tree: false }).findings
    .filter((finding) => CODES.includes(finding.code))
    .map(({ code, path: file, name, service, level }): BackingFinding => ({ code, file: file as string, ...(name ? { name: name as string } : {}), ...(service ? { service: service as string } : {}), level }));
}

test('HFS_BACKING_UNDECLARED (lite): a client library of an undeclared service is refused', (t) => {
  const findings = judge(t, { dependencies: { bullmq: '6.3.11', '@qdrant/js-client-rest': '1.12.0' } });
  assert.deepEqual(findings.sort((left, right) => left.name!.localeCompare(right.name!)), [
    { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', name: '@qdrant/js-client-rest', service: 'qdrant', level: 'error' },
    { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', name: 'bullmq', service: 'redis', level: 'error' },
  ]);
});

test('HFS_BACKING_UNDECLARED (lite): every Redis client library is refused without a declared redis, the legacy queue and cache stores included', (t) => {
  const clients = ['bull', '@nestjs/bull', '@keyv/redis', 'cache-manager-redis-yet', 'cache-manager-ioredis-yet'];
  const findings = judge(t, { dependencies: Object.fromEntries(clients.map((name) => [name, '1.0.0'])) });
  assert.deepEqual(findings.map(({ code, name, service }) => `${code} ${name} ${service}`).sort(),
    clients.map((name) => `HFS_BACKING_UNDECLARED ${name} redis`).sort());
  assert.deepEqual(judge(t, { be: { backing: ['redis'] }, dependencies: { '@keyv/redis': '1.0.0' } }), [], 'a declared redis with one of them is legal');
});

test('HFS_BACKING_UNDECLARED (lite): a declared queue pattern needs a declared redis', (t) => {
  assert.deepEqual(judge(t, { be: { patterns: ['queue'] } }), [
    { code: 'HFS_BACKING_UNDECLARED', file: 'hfs.json', service: 'redis', level: 'error' },
  ]);
});

test('HFS_BACKING_UNUSED (lite): a declared service needs a consuming dependency', (t) => {
  assert.deepEqual(judge(t, { be: { backing: ['redis'] } }), [
    { code: 'HFS_BACKING_UNUSED', file: 'hfs.json', service: 'redis', level: 'error' },
  ]);
});

test('HFS_BACKING_UNUSED (lite): a standalone back end reads its own package.json; a side scope of an app is not judged twice', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-backing-be-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const judgeBe = (dependencies: Record<string, string>, withDeclaration = true) => {
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ dependencies }));
    const repo = { profile: 'be', edition: 'lite', apps: [{ name: 'api', kind: 'api' }], backing: ['redis'] };
    return editionFindings({ repoRoot, files: ['package.json'], repo, resolver: NO_SLOTS, manifest: loadSlotManifest(), withDeclaration })
      .map(({ code, service }) => ({ code, service }));
  };
  assert.deepEqual(judgeBe({}), [{ code: 'HFS_BACKING_UNUSED', service: 'redis' }]);
  assert.deepEqual(judgeBe({ ioredis: '5.4.1' }), []);
  assert.deepEqual(judgeBe({}, false), []);
});

test('lite: a declared redis with its queue client and pattern is legal', (t) => {
  assert.deepEqual(judge(t, { be: { patterns: ['queue'], backing: ['redis'] }, dependencies: { bullmq: '6.3.11' } }), []);
});

test('HFS_BACKING_UNDECLARED (lite): the realtime hub Redis clients (ioredis, the socket.io adapter) need a declared redis', (t) => {
  const findings = judge(t, { dependencies: { ioredis: '5.11.1', '@socket.io/redis-adapter': '8.3.0' } });
  assert.deepEqual(findings.sort((left, right) => left.name!.localeCompare(right.name!)), [
    { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', name: '@socket.io/redis-adapter', service: 'redis', level: 'error' },
    { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', name: 'ioredis', service: 'redis', level: 'error' },
  ]);
});

test('lite: a declared redis with the realtime hub clients is legal', (t) => {
  assert.deepEqual(
    judge(t, { be: { backing: ['redis'] }, dependencies: { ioredis: '5.11.1', '@socket.io/redis-adapter': '8.3.0', pg: '8.16.3' } }),
    [],
    'the Redis hub (ioredis, sharded adapter) and the Postgres hub (pg) on the declared Redis are legal',
  );
});

test('lite: a backing name outside ruleParams.be.backing is an invalid declaration', (t) => {
  assert.deepEqual(judge(t, { be: { backing: ['mongo'] } }).map(({ code }) => code), ['HFS_DECLARATION_INVALID']);
});

test('lite: Qdrant is refused even with a declared consumer; pgvector needs no backing service declaration', (t) => {
  for (const name of ['@qdrant/js-client-rest', '@qdrant/qdrant-js']) {
    assert.deepEqual(judge(t, { be: { backing: ['qdrant'] }, dependencies: { [name]: '1.12.0' } }).map(({ code }) => code), ['HFS_DECLARATION_INVALID']);
    assert.deepEqual(judge(t, { dependencies: { [name]: '1.12.0' } }), [
      { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', name, service: 'qdrant', level: 'error' },
    ]);
  }
  assert.deepEqual(judge(t, { be: { backing: ['qdrant'] } }).map(({ code }) => code), ['HFS_DECLARATION_INVALID']);
  assert.deepEqual(judge(t, { dependencies: { pg: '8.13.1', pgvector: '0.2.1' } }), []);
});

test('HFS_BACKING_UNDECLARED (lite): a raw side declaration cannot admit a Qdrant client', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-backing-unadmitted-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ dependencies: { '@qdrant/js-client-rest': '1.12.0' } }));
  const findings = editionFindings({
    repoRoot, files: ['package.json'], repo: { profile: 'be', edition: 'lite', backing: ['qdrant'] },
    resolver: NO_SLOTS, manifest: loadSlotManifest(),
  });
  assert.deepEqual(findings.map(({ code, path: file, service }) => ({ code, file, service })), [
    { code: 'HFS_BACKING_UNDECLARED', file: 'hfs.json', service: 'qdrant' },
    { code: 'HFS_BACKING_UNDECLARED', file: 'package.json', service: 'qdrant' },
  ]);
});

test('backing service editions must be nonempty, unique known edition names', () => {
  const base = loadSlotManifest();
  assert.deepEqual(ruleParamsProblems(base), []);
  for (const editions of [[], ['other'], ['full', 'full'], 'full', null]) {
    const manifest = structuredClone(base);
    manifest.ruleParams.be.backing.qdrant.editions = editions;
    assert.ok(ruleParamsProblems(manifest).some((problem) => problem.startsWith('ruleParams.be.backing must map')), JSON.stringify(editions));
  }
});

test('full: Qdrant with its declared client remains admitted, including the default edition', (t) => {
  assert.deepEqual(judge(t, { edition: 'full', be: { backing: ['qdrant'] }, dependencies: { '@qdrant/js-client-rest': '1.12.0' } }), []);
  for (const edition of ['full', undefined]) {
    const declaration = {
      hfs: 3, kind: 'app', project: 'demo', ...(edition ? { edition } : {}),
      sides: { be: { apps: [{ name: 'api', kind: 'api' }], backing: ['qdrant'] }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
    };
    assert.deepEqual(resolveRepoDeclaration(loadSlotManifest(), declaration).sides?.be?.backing, ['qdrant']);
  }
});

test('full: its backing topology is the stack declaration, so no backing finding applies', (t) => {
  assert.deepEqual(judge(t, { edition: 'full', be: { patterns: ['queue'] }, dependencies: { bullmq: '6.3.11', ioredis: '5.4.1' } }), []);
});

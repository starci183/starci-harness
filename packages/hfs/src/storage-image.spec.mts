// proves: STACK_STORAGE_MISSING@lite
// proves: STACK_STORAGE_MISSING@full
// proves: STACK_STORAGE_UNUSED@lite
// proves: STACK_STORAGE_UNUSED@full
// proves: STACK_STORAGE_IMAGE_UNUSED@lite
// proves: STACK_STORAGE_IMAGE_UNUSED@full
// proves: STACK_STORAGE_IMAGE_SHAPE@lite
// proves: STACK_STORAGE_IMAGE_SHAPE@full
// R440 and the storage condition (rules/storage-image.mts, scripts/lib/storage-need.mts): a project ships its own MinIO when it has statics/ or its back end needs storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storageImageFindings } from '../runtime/scripts/hfs/rules/storage-image.mjs';
import { storageNeed } from '../runtime/scripts/lib/storage-need.mjs';

// reason: stack declarations and compose services are YAML-shaped trees the assertions build and judge.
type Json = any;
const OVERRIDE = '.starcistacks/images/storage/Dockerfile';
const DIR = '.starcistacks/dev/infra/compose';

const goodService = (): Json => ({
  build: { context: '../../../..', dockerfile: OVERRIDE },
  image: 'demo-storage:local',
  environment: { STATICS_BUCKET: 'demo-dev', STATICS_PREFIX: 'statics', STATICS_PUBLIC: 'download' },
  healthcheck: { test: ['CMD-SHELL', 'test -f /tmp/statics-ready && wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live'] },
});
const stack = (custody: Json[] = [{ member: 'storage', key: 'STORAGE_ACCESS_KEY_ID' }], production: Json = undefined): Json => ({
  environments: {
    dev: { runtime: 'docker-compose', composeFiles: ['infra/compose/compose.yaml'], local: { services: [{ name: 'db' }, { name: 'storage' }], custody } },
    ...(production === undefined ? {} : { production: { runtime: 'docker-swarm', deploy: production } }),
  },
});
const judge = (options: { stack?: Json; packageJson?: Json; staticsFiles?: string[]; service?: Json | null }): string[] => storageImageFindings({
  stack: options.stack ?? stack(), packageJson: options.packageJson ?? {}, project: 'demo', staticsFiles: options.staticsFiles ?? [],
  compose: () => (options.service === null ? [{ name: 'db', service: {}, dir: DIR }] : [{ name: 'storage', service: options.service ?? goodService(), dir: DIR }]),
}).map((finding) => `${finding.code}:${finding.level}`);

test('the condition: statics/ besides the starter, the storage package, a storage member or a sealed storage secret', () => {
  assert.equal(storageNeed({}).needed, false);
  assert.equal(storageNeed({ staticsFiles: ['statics/.gitkeep'] }).needed, false);
  assert.deepEqual(storageNeed({ staticsFiles: ['statics/art/a.png'] }), { statics: true, backend: false, needed: true });
  assert.equal(storageNeed({ packageJson: { dependencies: { '@starci/object-storage': '1.0.0' } } }).backend, true);
  assert.equal(storageNeed({ stack: stack() }).backend, true);
  assert.equal(storageNeed({ stack: { environments: { production: { secrets: [{ name: 'storage-secret-access-key' }] } } } }).backend, true);
  assert.equal(storageNeed({ stack: { environments: { dev: { local: { custody: [{ member: 'db' }] } } } } }).needed, false);
});

for (const edition of ['lite'] as const) {
  test(`${edition}: a service built from the override with its statics environment is clean`, () => {
    assert.deepEqual(judge({ staticsFiles: ['statics/.gitkeep', 'statics/art/a.png'] }), []);
  });

  test(`${edition}: STACK_STORAGE_MISSING is a project that needs storage and declares no storage service`, () => {
    const bare: Json = { environments: { dev: { runtime: 'docker-compose', composeFiles: ['infra/compose/compose.yaml'], local: { services: [{ name: 'db' }] } } } };
    assert.deepEqual(judge({ stack: bare, staticsFiles: ['statics/art/a.png'], service: null }), ['STACK_STORAGE_MISSING:error']);
    assert.deepEqual(judge({ stack: bare, packageJson: { dependencies: { '@starci/object-storage': '1' } }, service: null }), ['STACK_STORAGE_MISSING:error']);
    assert.deepEqual(judge({ stack: bare, service: null }), []);
  });

  test(`${edition}: STACK_STORAGE_UNUSED is a storage service nothing needs, a warning`, () => {
    const unneeded = stack([{ member: 'db', key: 'POSTGRES_PASSWORD' }]);
    assert.deepEqual(judge({ stack: unneeded, staticsFiles: ['statics/.gitkeep'] }), ['STACK_STORAGE_UNUSED:warning']);
    assert.deepEqual(judge({ stack: unneeded, staticsFiles: ['statics/art/a.png'] }), []);
  });

  test(`${edition}: STACK_STORAGE_IMAGE_UNUSED is statics media with a storage service that does not build the override`, () => {
    const stock = { image: 'ghcr.io/starci183/minio:RELEASE.2025-10-15T17-29-55Z-starci.1@sha256:ec6d' };
    assert.deepEqual(judge({ staticsFiles: ['statics/art/a.png'], service: stock }), ['STACK_STORAGE_IMAGE_UNUSED:error']);
    assert.deepEqual(judge({ staticsFiles: ['statics/.gitkeep'], service: stock }), []);
  });

  test(`${edition}: STACK_STORAGE_IMAGE_SHAPE is a storage service that builds the override and breaks its shape`, () => {
    const shaped = (mutate: (service: Json) => void): string[] => { const service = goodService(); mutate(service); return judge({ staticsFiles: ['statics/art/a.png'], service }); };
    const refused = ['STACK_STORAGE_IMAGE_SHAPE:error'];
    assert.deepEqual(shaped((service) => { service.build.context = '../../../images/storage'; }), refused);
    assert.deepEqual(shaped((service) => { service.image = 'demo-minio:local'; }), refused);
    assert.deepEqual(shaped((service) => { delete service.environment.STATICS_BUCKET; }), refused);
    assert.deepEqual(shaped((service) => { service.environment.STATICS_PREFIX = 'Static Files'; }), refused);
    assert.deepEqual(shaped((service) => { service.environment.STATICS_PUBLIC = 'upload'; }), refused);
    assert.deepEqual(shaped((service) => { service.healthcheck = { test: ['CMD', 'wget', 'http://127.0.0.1:9000/minio/health/live'] }; }), refused);
    assert.deepEqual(shaped((service) => { service.environment = ['STATICS_BUCKET=demo-dev', 'STATICS_PREFIX=statics/art', 'STATICS_PUBLIC=none']; }), []);
    assert.deepEqual(judge({ staticsFiles: [], service: goodService() }), ['STACK_STORAGE_IMAGE_SHAPE:error']);
  });
}

test('lite production: the deploy builds the storage image when the project needs storage', () => {
  const needing = (images: Json): Json => stack(undefined, { images });
  assert.deepEqual(judge({ stack: needing({ api: { app: 'api' } }), staticsFiles: ['statics/art/a.png'] }), ['STACK_STORAGE_MISSING:error']);
  assert.deepEqual(judge({ stack: needing({ api: { app: 'api' }, storage: { app: 'storage' } }), staticsFiles: ['statics/art/a.png'] }), []);
  assert.deepEqual(judge({ stack: needing({ storage: { app: 'minio' } }), staticsFiles: ['statics/art/a.png'] }), ['STACK_STORAGE_IMAGE_SHAPE:error']);
  const unneeded = stack([{ member: 'db' }], { images: { storage: { app: 'storage' } } });
  assert.deepEqual(judge({ stack: unneeded, service: null }), ['STACK_STORAGE_UNUSED:warning', 'STACK_STORAGE_UNUSED:warning']);
});

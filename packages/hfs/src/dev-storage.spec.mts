// The dev object store of the starters and the compose ports of the base port (R389, PROJECT-STACKS-10): both editions' dev compose run the StarCi
// MinIO as the `storage` service, pinned once in contexts/stack/pins.yaml and held equal to the harness images/sources.json; every host port of the
// rendered starters follows the role table; and `starci app sync` brings an existing app to that shape (sync/dev-services.mts), touching nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { basePortProblems, literalPublishes } from '../runtime/scripts/hfs/stack-base-port.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { scaffoldPorts } from '../scaffold/app.mjs';
import { devServicesUpgrade, STORAGE_IMAGE } from '../sync/dev-services.mjs';
import { upgradeEdits } from '../sync/index.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const TEMPLATES = path.join(import.meta.dirname, '..', 'templates', 'app');
const pins = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).images;
const sources = JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'images', 'sources.json'), 'utf8'));
const render = (text: string, base: number): string => Object.entries(scaffoldPorts(base)).reduce((out, [name, port]) => out.replaceAll(`{{${name}}}`, port), text)
  .replaceAll('{{project}}', 'demo').replaceAll('{{stackSidesNote}}', 'This project has a back end (be) and a front end (fe).').replaceAll('{{stackSides}}', '{be: true, fe: true, packages: false}')
  .replaceAll('{{sonarGate}}', 'gate').replaceAll('{{registryVisibility}}', 'public');
const starter = (skeleton: string, compose: string, base = 3000) => {
  const read = (...parts: string[]): string => render(fs.readFileSync(path.join(TEMPLATES, skeleton, '.starcistacks', ...parts), 'utf8'), base);
  return { stacks: parseYaml(read('application-stacks.yaml')), compose: parseYaml(read('dev', 'infra', 'compose', compose)) };
};
const STARTERS = [['lite', 'skeleton-lite', 'compose.yaml'], ['full', 'skeleton', 'stack.yaml']] as const;

test('one MinIO reference: the pin is the published StarCi build of images/sources.json, and both starters and the sync upgrade run it', () => {
  const reference = `ghcr.io/starci183/minio:${String(pins.minio.version)}`;
  assert.equal(reference, sources.minio.published.reference);
  assert.match(reference, /@sha256:[0-9a-f]{64}$/u);
  assert.equal(STORAGE_IMAGE, reference);
  for (const [edition, skeleton, compose] of STARTERS) assert.equal(starter(skeleton, compose).compose.services.storage.image, reference, edition);
});

for (const [edition, skeleton, compose] of STARTERS) {
  test(`the ${edition} starter runs the storage service from the storage member's keys, on loopback, waited on its health`, () => {
    const { stacks, compose: file } = starter(skeleton, compose);
    const storage = file.services.storage;
    assert.deepEqual(storage.ports, ['127.0.0.1:${STACK_PORT_STORAGE}:9000', '127.0.0.1:${STACK_PORT_STORAGE_CONSOLE}:9001']);
    assert.deepEqual(storage.environment, { MINIO_ROOT_USER_FILE: '/run/secrets/STORAGE_ACCESS_KEY_ID', MINIO_ROOT_PASSWORD_FILE: '/run/secrets/STORAGE_SECRET_ACCESS_KEY' });
    assert.ok(storage.volumes.includes('${STACK_GRANT_STORAGE}:/run/secrets:ro'));
    assert.equal(storage.build, undefined);
    assert.ok(Object.hasOwn(file.volumes, 'storage-data'));
    const { config, problems } = normalizeLocal(stacks.environments.dev.local, { project: 'demo', env: 'dev' });
    assert.deepEqual(problems, []);
    assert.deepEqual(config?.services.find((service) => service.name === 'storage'), { name: 'storage', wait: 'healthy', port: null });
    assert.deepEqual(config?.grants.find((grant) => grant.name === 'storage'), { name: 'storage', keys: ['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'] });
    assert.deepEqual(config?.custody.filter((entry) => entry.member === 'storage').map((entry) => entry.key), ['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY']);
    assert.ok(config?.ready.some((probe) => probe.name === 'storage-live' && probe.url.endsWith(':${port.storage}/minio/health/live')));
  });

  test(`every host port of the ${edition} starter follows the role table and no compose port is a literal`, () => {
    const { stacks, compose: file } = starter(skeleton, compose, edition === 'lite' ? 4300 : 3000);
    const { config } = normalizeLocal(stacks.environments.dev.local, { project: 'demo', env: 'dev' });
    assert.ok(config);
    assert.deepEqual(basePortProblems(config), []);
    assert.deepEqual(literalPublishes(file.services), []);
    assert.equal(config.ports.storage, config.basePort! + 93);
    assert.equal(config.ports['storage-console'], config.basePort! + 94);
  });
}

test('the lite api reaches the storage service on its derived port: no 9000, which the host Sonar holds', () => {
  const { stacks } = starter('skeleton-lite', 'compose.yaml', 4300);
  const api = stacks.environments.dev.local.processes.find((process: { name: string }) => process.name === 'api');
  assert.equal(api.env.STORAGE_ENDPOINT, 'http://127.0.0.1:${port.storage}');
  assert.deepEqual([stacks.environments.dev.local.ports.db, stacks.environments.dev.local.ports.mail, stacks.environments.dev.local.ports.storage], [4390, 4391, 4393]);
  assert.ok(!JSON.stringify(stacks.environments.dev.local).includes(':9000'));
});

// An app the lite starter wrote before the compose roles: db 54322, Mailpit on 1025 and 8025, no object store, the api pointed at 9000.
const OLD_STACKS = `schema: starci/application-stacks@1
environments:
  dev:
    runtime: docker-compose
    composeFiles: [infra/compose/compose.yaml]
    local:
      # The project base port.
      basePort: 3400
      ports:
        db: 54322
        api: 3401
        web: 3400
        mail: 1025
        mailui: 8025
      services:
        - {name: db, wait: healthy}
        - {name: mail, wait: healthy}
      database:
        service: db
        port: db
        urlEnv: PRIMARY_DB_URL
        password: {member: db, key: DB_OWNER_PASSWORD}
        adminPassword: {member: db, key: POSTGRES_PASSWORD}
      grants:
        - {name: db, keys: [POSTGRES_PASSWORD]}
      custody:
        - {member: db, key: POSTGRES_PASSWORD, kind: password}
        - {member: storage, key: STORAGE_ACCESS_KEY_ID, kind: hex, bytes: 12}
        - {member: storage, key: STORAGE_SECRET_ACCESS_KEY, kind: hex}
      processes:
        - name: api
          argv: [node, main.js]
          port: api
          env:
            MAIL_PORT: "\${port.mail}"
            STORAGE_ENDPOINT: "http://127.0.0.1:9000"
        - {name: web, argv: [npm, run, dev], port: web}
      ready:
        - {name: api-live, url: "http://localhost:\${port.api}/health/live"}
      origins:
        - {name: mail, url: "http://localhost:\${port.mailui}"}
  production:
    runtime: docker-swarm
`;
const OLD_COMPOSE = `# The dev dependencies.
name: demo-dev
services:
  db:
    image: postgres
    ports:
      - "127.0.0.1:\${STACK_PORT_DB}:5432"
  mail:
    image: mailpit
    ports:
      - "127.0.0.1:\${STACK_PORT_MAIL}:1025"
volumes:
  db-data: {}
`;

function oldApp(t: { after: (fn: () => void) => void }, stacks = OLD_STACKS, compose = OLD_COMPOSE): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-dev-services-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), stacks);
  fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose', 'compose.yaml'), compose);
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project: 'demo', sides: { be: {}, fe: {} } }));
  return root;
}

test('sync upgrades an old app: db, mail and mailui move to their slots and the storage service is declared and composed; a second run finds nothing', (t) => {
  const root = oldApp(t);
  const { edits, notices } = devServicesUpgrade(root);
  assert.deepEqual(notices, []);
  assert.deepEqual(edits.map((edit) => edit.path), ['.starcistacks/application-stacks.yaml', '.starcistacks/dev/infra/compose/compose.yaml']);
  for (const edit of edits) fs.writeFileSync(path.join(root, edit.path), edit.content);
  const stacks = parseYaml(fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8'));
  const local = stacks.environments.dev.local;
  assert.deepEqual(local.ports, { db: 3490, api: 3401, web: 3400, mail: 3491, mailui: 3492, storage: 3493, 'storage-console': 3494 });
  assert.deepEqual(local.services.at(-1), { name: 'storage', wait: 'healthy' });
  assert.deepEqual(local.grants.at(-1), { name: 'storage', keys: ['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'] });
  assert.equal(local.processes[0].env.STORAGE_ENDPOINT, 'http://127.0.0.1:${port.storage}');
  assert.equal(local.processes[0].env.MAIL_PORT, '${port.mail}', 'the api reads the moved mail port through its name');
  assert.deepEqual(local.ready.at(-1), { name: 'storage-live', url: 'http://localhost:${port.storage}/minio/health/live' });
  assert.deepEqual(local.origins.at(-1), { name: 'storage', url: 'http://localhost:${port.storage-console}' });
  const { config, problems } = normalizeLocal(local, { project: 'demo', env: 'dev' });
  assert.deepEqual(problems, []);
  assert.deepEqual(basePortProblems(config!), []);
  const text = fs.readFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'utf8');
  assert.ok(text.includes('      # The project base port.\n') && text.endsWith('  production:\n    runtime: docker-swarm\n'), 'comments and the other environments stay');
  const compose = parseYaml(fs.readFileSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose', 'compose.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(compose.services), ['db', 'mail', 'storage']);
  assert.equal(compose.services.storage.image, STORAGE_IMAGE);
  assert.deepEqual(compose.services.mail, { image: 'mailpit', ports: ['127.0.0.1:${STACK_PORT_MAIL}:1025'] }, 'the mail service already publishes from its port name');
  assert.deepEqual(compose.volumes, { 'db-data': {}, 'storage-data': {} });
  assert.deepEqual(devServicesUpgrade(root), { edits: [], notices: [] });
});

test('sync leaves an app it cannot upgrade as it is and says why: no base port, an object store already running, a taken slot, no storage member', (t) => {
  const unbased = oldApp(t, OLD_STACKS.replace('      basePort: 3400\n', ''));
  assert.deepEqual(devServicesUpgrade(unbased).edits, []);
  assert.match(devServicesUpgrade(unbased).notices.join('\n'), /environments\.dev\.local declares no basePort: its compose ports are not derived/u);
  const minio = oldApp(t, OLD_STACKS, OLD_COMPOSE.replace('volumes:', '  app-minio:\n    image: ghcr.io/starci183/minio:RELEASE.x@sha256:00\nvolumes:'));
  const upgrade = devServicesUpgrade(minio);
  assert.deepEqual(upgrade.edits.map((edit) => edit.path), ['.starcistacks/application-stacks.yaml'], 'the ports still move');
  assert.match(upgrade.notices.join('\n'), /already runs an object store \(the compose service app-minio \(ghcr\.io\/starci183\/minio:RELEASE\.x\)\): no storage service is added/u);
  const taken = oldApp(t, OLD_STACKS.replace('        web: 3400\n', '        web: 3400\n        relay: 3491\n'));
  assert.match(devServicesUpgrade(taken).notices.join('\n'), /ports\.mail stays 1025: its slot 3491 \(basePort \+ 91\) is the port of relay/u);
  const keyless = oldApp(t, OLD_STACKS.replaceAll(/ {8}- \{member: storage.*\n/gu, ''));
  assert.match(devServicesUpgrade(keyless).notices.join('\n'), /declares no `storage` member/u);
});

test('the sync dry run chains the sides edit and the dev services edit of one declaration into one write', (t) => {
  const root = oldApp(t);
  const { edits } = upgradeEdits(root);
  const stack = edits.filter((edit) => edit.path === '.starcistacks/application-stacks.yaml');
  assert.equal(stack.length, 1);
  assert.match(stack[0]?.content ?? '', /^sides: \{be: true, fe: true, packages: false\}$/mu);
  assert.match(stack[0]?.content ?? '', /^ {8}storage: 3493$/mu);
  assert.match(stack[0]?.reason ?? '', /sides field.*; the dev ports follow the role table/u);
});

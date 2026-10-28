// scaffold-standalone.spec.mjs - `npx starci-harness app scaffold` works from the published packages alone: the Sonar exclusions come from the
// jest preset copy @starci/hfs ships (bundledPresets), and a new path is git-initialised with an unborn main before any file is written.
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { swarmHardeningIssues } from '../runtime/scripts/hfs/rules/stacks-swarm.mjs';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { renderRelease } from '../stack/render.mjs';
import { stackConfigModels } from './helpers/stack-compose.mjs';

/** The CLI that runs the scaffold: its version is the starci-harness the new app pins. */
const HARNESS = { version: '1.1.0-alpha.3' };
const BUNDLED = new URL('../runtime/packages/jest-preset/sonar-exclusions.cjs', import.meta.url);
const tempRoot = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-scaffold-standalone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const lockedOk = (root) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** Exercise managed rendering with synthetic custody and a Docker seam; no real credentials or daemon are used. */
async function renderedOverride(root, spec, model) {
  const envDir = path.join(root, '.starcistacks', 'production');
  const normalized = normalizeDeploy(spec.deploy, { project: 'demo', probe: {
    exists: relative => fs.existsSync(path.join(envDir, relative)), services: new Set(Object.keys(model.services)),
    members: new Set(spec.secrets.map(member => member.name)),
  } });
  assert.deepEqual(normalized.problems, []);
  const config = { ...normalized.config, repoRoot: root, envDir, secretsDir: path.join(envDir, 'secrets'),
    stackFile: path.join(envDir, 'infra', 'swarm', 'stack.yaml') };
  const fixtureMembers = {
    'primary-db-url': { PRIMARY_DB_URL: 'postgresql://fixture.invalid/database' },
    'postgres-password': { POSTGRES_PASSWORD: 'fixture-admin-value' },
    'primary-db-password': { PRIMARY_DB_PASSWORD: 'fixture-app-value' },
    'supabase-service-role-key': { SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-value' },
  };
  let override, configName;
  const result = await renderRelease({ env: { STARCI_SECRET_VERSION_KEY: 'fixture-version-value' }, now: () => 0,
    sops: { decrypt: file => fixtureMembers[path.basename(file, '.enc')] },
    spawn: (command, args, options) => {
      assert.equal(command, 'docker');
      assert.deepEqual(args.slice(0, 2), ['stack', 'config']);
      override = stackConfigModels(args)[1];
      configName = options.env.POSTGRES_INIT_CONFIG;
      return { status: 0, stdout: JSON.stringify(override), stderr: '' };
    },
  }, config, { sourceSha: 'b'.repeat(40), out: path.join(root, 'render-proof'),
    images: Object.fromEntries(Object.keys(config.images).map(service => [service, `registry.example/${service}@sha256:${'a'.repeat(64)}`])),
  });
  assert.equal(result.ok, true);
  return { override, configName, release: JSON.parse(fs.readFileSync(path.join(result.data.out, 'release.json'), 'utf8')) };
}

test('bundledPresets answers the jest preset exclusions @starci/hfs ships', () => {
  const list = createRequire(import.meta.url)(fileURLToPath(BUNDLED));
  assert.ok(list.length > 0 && list.every((glob) => typeof glob === 'string'));
  assert.deepEqual(bundledPresets(), { sonarExclusions: list.join(',') });
});

test('a new path is git-initialised with an unborn main before the app files are written', (t) => {
  const into = tempRoot(t);
  const calls = [];
  const initGit = (root, options) => {
    calls.push({ root, options, hadFiles: fs.readdirSync(root).length });
    return init(root, options);
  };
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { root, options: { branch: 'main' }, hadFiles: 0 });
  assert.equal(fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
  assert.ok(files.includes('hfs.json') && fs.existsSync(path.join(root, 'hfs.json')));
  assert.match(fs.readFileSync(path.join(root, 'sonar-project.properties'), 'utf8'), /\*\*\/\*\.spec\.ts/);
});

test('the full ui package pins react-dom beside react, the peer @heroui/react needs, so a later install never resolves a newer react-dom', (t) => {
  const into = tempRoot(t);
  const { root } = scaffoldApp({ name: 'demo', harness: HARNESS, into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit: init });
  const ui = JSON.parse(fs.readFileSync(path.join(root, 'fe', 'packages', 'demo-ui', 'package.json'), 'utf8'));
  assert.ok(ui.dependencies['@heroui/react'], 'the ui package declares @heroui/react');
  assert.equal(ui.dependencies['react-dom'], ui.dependencies.react, 'react-dom is pinned at the react version');
});

test('the full starter runs PostgreSQL in Docker for dev and in Swarm with persisted data and separate secret grants for production', async (t) => {
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit: init });
  const yaml = file => parseYaml(fs.readFileSync(path.join(root, '.starcistacks', ...file.split('/')), 'utf8'));
  const stacks = yaml('application-stacks.yaml');
  const model = yaml('production/infra/swarm/stack.yaml');
  const dev = yaml('dev/infra/compose/stack.yaml');
  const spec = stacks.environments.production;
  assert.equal(dev.services.postgres.image, stacks.components.postgres.image);
  assert.equal(model.services.postgres.image, stacks.components.postgres.image);
  assert.equal(yaml('production/infra/swarm/releases/images.lock.yaml').images.postgres, model.services.postgres.image);
  assert.equal(spec.runtime, 'docker-swarm');
  assert.deepEqual(spec.components.postgres, { replicas: 1, port: 5432 });
  assert.deepEqual(model.services.postgres.volumes, ['postgres-data:/var/lib/postgresql/data']);
  assert.deepEqual(model.volumes['postgres-data'], { external: true, name: 'demo-production-postgres-data' });
  assert.ok(spec.deploy.volumes.includes(model.volumes['postgres-data'].name));
  assert.ok(spec.backup.some(entry => entry.component === 'postgres' && entry.restoreProof));
  assert.deepEqual(model.services.postgres.networks, ['backing']);
  assert.ok(model.services.core.networks.includes('backing'));
  assert.equal(model.networks.backing.internal, true);
  assert.equal(model.services.postgres.ports, undefined);
  assert.equal(model.services.postgres.environment.POSTGRES_HOST_AUTH_METHOD, undefined);
  assert.equal(model.services.postgres.tty, false, 'psql password prompts read the supplied stdin pipe without a controlling terminal');
  assert.equal(model.services.postgres.environment.POSTGRES_PASSWORD_FILE, undefined);
  assert.equal(model.services.postgres.environment.PRIMARY_DB_PASSWORD_FILE, undefined);
  assert.deepEqual(model.services.postgres.healthcheck.test, ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'demo']);
  assert.deepEqual(spec.deploy.secrets.grants, [
    { service: 'core', filePointers: true, from: [{ member: 'primary-db-url' }] },
    { service: 'postgres', filePointers: true, from: [{ member: 'postgres-password' }, { member: 'primary-db-password' }] },
  ]);
  assert.equal(model.services.postgres.secrets, undefined, 'the managed deploy grant is the sole source of runtime mounts');
  assert.equal(model.services.core.secrets, undefined);
  assert.equal(model.services.core.environment.PRIMARY_DB_URL_FILE, undefined);
  assert.deepEqual(model.configs['postgres-init'], { external: true, name: '${POSTGRES_INIT_CONFIG}' });
  assert.deepEqual(spec.deploy.configs, [{ name: 'postgres-init', file: 'infra/swarm/postgres-init.sh', env: 'POSTGRES_INIT_CONFIG' }]);
  assert.deepEqual(model.services.postgres.configs.map(({ source, target }) => ({ source, target })), [
    { source: 'postgres-init', target: '/docker-entrypoint-initdb.d/10-app-role.sh' },
  ]);
  assert.equal(model.services.postgres.configs[0].mode, 0o555);
  assert.ok(files.includes('.starcistacks/production/infra/swarm/postgres-init.sh'));
  assert.deepEqual(swarmHardeningIssues({ doc: stacks, spec, model, environment: 'production', repoRoot: root, files,
    repo: JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) }), []);
  const { override, configName, release } = await renderedOverride(root, spec, model);
  assert.equal(override.version, model.version);
  assert.match(configName, /^demo-production-postgres-init-c[0-9a-f]{10}$/);
  assert.deepEqual(release.configs, [{ logical: 'postgres-init', name: configName }]);
  for (const [service, keys] of Object.entries({ core: ['PRIMARY_DB_URL'], postgres: ['POSTGRES_PASSWORD', 'PRIMARY_DB_PASSWORD'] })) {
    assert.deepEqual(override.services[service].secrets.map(secret => secret.target).sort(), [...keys].sort());
    for (const key of keys) {
      assert.equal(override.services[service].environment[`${key}_FILE`], `/run/secrets/${key}`);
      assert.ok(override.services[service].secrets.some(secret => secret.source === key && secret.target === key));
      assert.equal(override.secrets[key].external, true);
    }
  }
});

test('the lite starter keeps its vector backing in Supabase without a Qdrant declaration, client or container', async (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init,
    emitTypes: () => 'export type Database = Record<string, never>\n' });
  const read = file => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
  const declaration = JSON.parse(read('hfs.json'));
  const pkg = JSON.parse(read('package.json'));
  const stacks = parseYaml(read('.starcistacks/application-stacks.yaml'));
  assert.equal(declaration.sides.be.connections[0].provider, 'supabase');
  assert.deepEqual(declaration.sides.be.backing ?? [], []);
  assert.ok(!Object.keys(pkg.dependencies).some(name => name.startsWith('@qdrant/')));
  assert.deepEqual(stacks.backing, { supabase: { provider: 'supabase', managed: true } });
  for (const env of ['dev', 'production']) {
    const model = parseYaml(read(`.starcistacks/${env}/infra/swarm/stack.yaml`));
    assert.ok(!Object.values(model.services).some(service => service.image.includes('qdrant')));
  }
  const model = parseYaml(read('.starcistacks/production/infra/swarm/stack.yaml'));
  const { override } = await renderedOverride(root, stacks.environments.production, model);
  assert.equal(override.version, model.version);
  assert.deepEqual(Object.keys(override.services).sort(), ['api', 'web']);
});

test('full and lite scaffolds leave Compose versions to the runtime default', (t) => {
  for (const edition of ['full', 'lite']) {
    const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), edition, presets: bundledPresets(), lock: lockedOk, initGit: init,
      emitTypes: () => 'export type Database = Record<string, never>\n' });
    const composeFiles = files.filter(file => /^\.starcistacks\/[^/]+\/infra\/(?:swarm|compose)\/[^/]+\.ya?ml$/u.test(file));
    assert.ok(composeFiles.length > 0, `${edition} has stack sources`);
    for (const file of composeFiles) {
      const model = parseYaml(fs.readFileSync(path.join(root, ...file.split('/')), 'utf8'));
      assert.equal(Object.hasOwn(model, 'version'), false, `${edition}: ${file}`);
    }
  }
});

test('a failed git init refuses before any app file is written', (t) => {
  const into = tempRoot(t);
  const initGit = () => ({ ok: false, stderr: 'git: not found' });
  assert.throws(
    () => scaffoldApp({ name: 'demo', harness: HARNESS, into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit }),
    (error) => error.code === 'HFS_SCAFFOLD_GIT_INIT_FAILED' && /git: not found/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(into, 'demo', 'hfs.json')), false);
});

test('an existing empty unborn main repository is scaffolded without a second git init', (t) => {
  const into = tempRoot(t);
  const root = path.join(into, 'demo');
  fs.mkdirSync(root);
  assert.equal(init(root, { branch: 'main' }).ok, true);
  const initGit = () => assert.fail('an existing repository must not be initialised again');
  scaffoldApp({ name: 'demo', harness: HARNESS, into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit });
  assert.ok(fs.existsSync(path.join(root, 'hfs.json')));
});

test('the root devDependencies pin starci-harness at the version of the CLI that runs the scaffold', (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: { version: '9.9.9-alpha.9' }, into: tempRoot(t), edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit: init });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['starci-harness'], '9.9.9-alpha.9');
});

test('without the CLI that runs it the scaffold refuses before git init, since no starci-harness version is known', (t) => {
  const into = tempRoot(t);
  const initGit = () => assert.fail('a refused scaffold initialises nothing');
  assert.throws(
    () => scaffoldApp({ name: 'demo', into, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit }),
    (error) => error.code === 'HFS_SCAFFOLD_PIN_MISSING' && /starci-harness/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(into, 'demo')), false);
});

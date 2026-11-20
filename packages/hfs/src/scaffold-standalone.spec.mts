// scaffold-standalone.spec.mts - `npx starci-harness app scaffold` works from the published packages alone: the Sonar exclusions come from the
// jest preset copy @starci/hfs ships (bundledPresets), and a new path is git-initialised with an unborn main before any file is written.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { spawnSync } from 'node:child_process';
import { scaffoldApp, settleScaffoldBranches } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { add } from '../runtime/scripts/api/git/add.mjs';
import { commit } from '../runtime/scripts/api/git/commit.mjs';
import { switchBranch } from '../runtime/scripts/api/git/switch.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { renderRelease } from '../stack/render.mjs';
import type { StackContext } from '../stack/context.mjs';

import { stackConfigModels } from './helpers/stack-compose.mjs';

/** The CLI that runs the scaffold: its version is the starci-harness the new app pins. */
const HARNESS = { version: '1.1.0-alpha.3' };
const BUNDLED = new URL('../runtime/packages/jest-preset/sonar-exclusions.cjs', import.meta.url);
const tempRoot = (t: TestContext): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-scaffold-standalone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The docker stack config override the render proof reads (the fields this spec asserts on). */
interface RenderedOverride {
  version: unknown;
  services: Record<string, { secrets: Array<{ source: string; target: string }>; environment: Record<string, string> }>;
  secrets: Record<string, { external: boolean }>;
}

/** Exercise managed rendering with synthetic custody and a Docker seam; no real credentials or daemon are used. */
// reason: `spec` and `model` are parsed YAML of the scaffolded stack; the helper reads only the fields typed below.
async function renderedOverride(root: string, spec: any, model: any): Promise<{ override: RenderedOverride; configName: string; release: { configs: unknown } }> {
  const envDir = path.join(root, '.starcistacks', 'production');
  const services = new Set<string>(Object.keys(model.services));
  const members = new Set<string>(spec.secrets.map((member: { name: string }) => member.name));
  const normalized = normalizeDeploy(spec.deploy, { project: 'demo', probe: { exists: (relative: string) => fs.existsSync(path.join(envDir, relative)), services, members } });
  assert.deepEqual(normalized.problems, []);
  const config = { ...normalized.config!, env: 'production', project: 'demo', members, services, repoRoot: root, envDir, secretsDir: path.join(envDir, 'secrets'),
    stackFile: path.join(envDir, 'infra', 'swarm', 'stack.yaml') };
  const fixtureMembers = {
    'primary-db-url': { PRIMARY_DB_URL: 'postgresql://fixture.invalid/database' },
    'postgres-password': { POSTGRES_PASSWORD: 'fixture-admin-value' },
    'primary-db-password': { PRIMARY_DB_PASSWORD: 'fixture-app-value' },
    'db-password': { POSTGRES_PASSWORD: 'fixture-db-value' },
    'google-client-secret': { GOOGLE_CLIENT_SECRET: 'fixture-google-value' },
    'auth-jwt-private-key': { AUTH_JWT_PRIVATE_KEY: 'fixture-key-value' },
    'storage-access-key-id': { STORAGE_ACCESS_KEY_ID: 'fixture-access-value' },
    'storage-secret-access-key': { STORAGE_SECRET_ACCESS_KEY: 'fixture-storage-value' },
  };
  // reason: the render only reads env, now, sops.decrypt and spawn of the stack context; the doubles below carry just those.
  let override: RenderedOverride | undefined;
  let configName: string | undefined;
  const result = await renderRelease({ env: { STARCI_SECRET_VERSION_KEY: 'fixture-version-value' }, now: () => 0,
    sops: { decrypt: (file: string) => fixtureMembers[path.basename(file, '.enc') as keyof typeof fixtureMembers] },
    spawn: (command: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv | undefined }) => {
      assert.equal(command, 'docker');
      assert.deepEqual(args.slice(0, 2), ['stack', 'config']);
      override = stackConfigModels(args)[1] as unknown as RenderedOverride;
      configName = options?.env?.POSTGRES_INIT_CONFIG;
      return { status: 0, stdout: JSON.stringify(override), stderr: '' };
    },
  } as unknown as StackContext, config, { sourceSha: 'b'.repeat(40), out: path.join(root, 'render-proof'),
    images: Object.fromEntries(Object.keys(config.images).map((service) => [service, `registry.example/${service}@sha256:${'a'.repeat(64)}`])),
  });
  assert.equal(result.ok, true);
  return { override: override!, configName: configName!, release: JSON.parse(fs.readFileSync(path.join(result.data!.out as string, 'release.json'), 'utf8')) };
}

test('bundledPresets answers the jest preset exclusions @starci/hfs ships', () => {
  const list = createRequire(import.meta.url)(fileURLToPath(BUNDLED));
  assert.ok(list.length > 0 && list.every((glob: unknown) => typeof glob === 'string'));
  assert.deepEqual(bundledPresets(), { sonarExclusions: list.join(',') });
});

test('a new path is git-initialised with an unborn main before the app files are written', (t) => {
  const into = tempRoot(t);
  const calls: Array<{ root: string; options: { branch: string }; hadFiles: number }> = [];
  const initGit = (root: string, options: { branch: string }) => {
    calls.push({ root, options, hadFiles: fs.readdirSync(root).length });
    return init(root, options);
  };
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { root, options: { branch: 'main' }, hadFiles: 0 });
  assert.equal(fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
  assert.ok(files.includes('hfs.json') && fs.existsSync(path.join(root, 'hfs.json')));
  assert.match(fs.readFileSync(path.join(root, 'sonar-project.properties'), 'utf8'), /\*\*\/\*\.spec\.ts/);
});

test('the starter keeps its vector backing in its db service without a Qdrant declaration, client or container', async (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), presets: bundledPresets(), lock: lockedOk, initGit: init });
  const read = (file: string) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
  const declaration = JSON.parse(read('hfs.json'));
  const pkg = JSON.parse(read('package.json'));
  const stacks = parseYaml(read('.starcistacks/application-stacks.yaml'));
  assert.equal(declaration.sides.be.connections[0].provider, 'postgres');
  assert.deepEqual(declaration.sides.be.backing ?? [], []);
  assert.ok(!Object.keys(pkg.dependencies).some((name: string) => name.startsWith('@qdrant/')));
  assert.deepEqual(stacks.backing, { db: { provider: 'postgres', component: 'db' } });
  for (const file of ['dev/infra/compose/compose.yaml', 'production/infra/swarm/stack.yaml']) {
    const model = parseYaml(read(`.starcistacks/${file}`));
    assert.ok(!Object.values<{ image: string }>(model.services).some((service) => service.image.includes('qdrant')));
  }
  const model = parseYaml(read('.starcistacks/production/infra/swarm/stack.yaml'));
  const { override } = await renderedOverride(root, stacks.environments.production, model);
  assert.equal(override.version, model.version);
  assert.deepEqual(Object.keys(override.services).sort(), ['api', 'db', 'storage', 'web']);
});

test('the scaffold leaves Compose versions to the runtime default', (t) => {
  const { root, files } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), presets: bundledPresets(), lock: lockedOk, initGit: init });
  const composeFiles = files.filter((file) => /^\.starcistacks\/[^/]+\/infra\/(?:swarm|compose)\/[^/]+\.ya?ml$/u.test(file));
  assert.ok(composeFiles.length > 0, 'the starter has stack sources');
  for (const file of composeFiles) {
    const model = parseYaml(fs.readFileSync(path.join(root, ...file.split('/')), 'utf8'));
    assert.equal(Object.hasOwn(model, 'version'), false, file);
  }
});

test('a failed git init refuses before any app file is written', (t) => {
  const into = tempRoot(t);
  const initGit = () => ({ ok: false, stderr: 'git: not found' });
  assert.throws(
    () => scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit }),
    (error: { code?: string; message: string }) => error.code === 'HFS_SCAFFOLD_GIT_INIT_FAILED' && /git: not found/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(into, 'demo', 'hfs.json')), false);
});

test('an existing empty unborn main repository is scaffolded without a second git init', (t) => {
  const into = tempRoot(t);
  const root = path.join(into, 'demo');
  fs.mkdirSync(root);
  assert.equal(init(root, { branch: 'main' }).ok, true);
  const initGit = () => assert.fail('an existing repository must not be initialised again');
  scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit });
  assert.ok(fs.existsSync(path.join(root, 'hfs.json')));
});

test('the scaffold settles git on PROJECT-BRANCH-1: the app is the first commit of main and dev is checked out at it', (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), presets: bundledPresets(), lock: lockedOk, initGit: init });
  const identity = { ...process.env, GIT_AUTHOR_NAME: 'scaffold spec', GIT_AUTHOR_EMAIL: 'spec@example.invalid', GIT_COMMITTER_NAME: 'scaffold spec', GIT_COMMITTER_EMAIL: 'spec@example.invalid' };
  const settled = settleScaffoldBranches(root, 'demo', { add, switchBranch, commit: (args, options) => commit(args, { ...options, env: identity }) });
  assert.deepEqual(settled, { committed: true, branch: 'dev', detail: '' });
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'dev');
  assert.equal(git('rev-parse', 'main'), git('rev-parse', 'dev'), 'main and dev start at one commit');
  assert.equal(git('status', '--porcelain'), '', 'every scaffolded file is in the commit');
  assert.ok(git('ls-files').split('\n').includes('hfs.json'));
});

test('a commit git refuses leaves every file staged on unborn main and says why', (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: HARNESS, into: tempRoot(t), presets: bundledPresets(), lock: lockedOk, initGit: init });
  const refused = { status: 128, stdout: '', stderr: 'Author identity unknown\n*** Please tell me who you are.', pid: 0, output: [], signal: null };
  const settled = settleScaffoldBranches(root, 'demo', { add, commit: () => refused, switchBranch: () => assert.fail('no switch without a commit') });
  assert.deepEqual(settled, { committed: false, branch: 'main', detail: 'git commit: Author identity unknown' });
  assert.equal(fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
  assert.ok(spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').includes('hfs.json'), 'the files are staged');
});

test('the root devDependencies pin starci-harness at the version of the CLI that runs the scaffold', (t) => {
  const { root } = scaffoldApp({ name: 'demo', harness: { version: '9.9.9-alpha.9' }, into: tempRoot(t), presets: bundledPresets(), lock: lockedOk, initGit: init });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['starci-harness'], '9.9.9-alpha.9');
});

test('without the CLI that runs it the scaffold refuses before git init, since no starci-harness version is known', (t) => {
  const into = tempRoot(t);
  const initGit = () => assert.fail('a refused scaffold initialises nothing');
  assert.throws(
    () => scaffoldApp({ name: 'demo', harness: undefined, into, presets: bundledPresets(), lock: lockedOk, initGit }),
    (error: { code?: string; message: string }) => error.code === 'HFS_SCAFFOLD_PIN_MISSING' && /starci-harness/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(into, 'demo')), false);
});

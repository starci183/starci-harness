// module-package.spec.mts - `starci app add module <name>` writes a module package of the product's agent SDK and registers it; `remove module` reverses
// every step; the registry package is managed (sync renders it, a hand edit is drift); the module packages enter the sonar, codecov and test scope.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { LockResult } from '../scaffold/app.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { addModule, removeModule } from '../scaffold/add-module.mjs';
import { appSource, bundledPresets, checkTargets, renderTargets } from '../sync/index.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A fresh app of the edition with a stub agent SDK workspace package, the one thing a module is built on. */
function appWithSdk(t: TestContext, edition: string): string {
  const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, `starci-module-${edition}-`), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
  fs.mkdirSync(path.join(root, 'packages', 'agent-sdk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'agent-sdk', 'package.json'), '{"name":"@demo/agent-sdk","version":"0.0.0","private":true}\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces: string[] };
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ ...manifest, workspaces: [...manifest.workspaces, 'packages/*'] }, null, 2)}
`);
  return root;
}

const text = (root: string, relative: string): string => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
const json = (root: string, relative: string): { workspaces?: string[]; dependencies?: Record<string, string> } => JSON.parse(text(root, relative));
const tree = (root: string, folder = ''): string[] =>
  fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.git' ? [] : tree(root, relative);
    return [`${relative}\n${text(root, relative)}`];
  }).sort();
const feApps = (root: string): string[] => fs.readdirSync(path.join(root, 'fe', 'apps')).map((name) => `fe/apps/${name}/package.json`);
const rendered = (root: string) => renderTargets(JSON.parse(text(root, 'hfs.json')), bundledPresets(), { source: appSource(root) });
const registryChecks = (root: string) => checkTargets(root, rendered(root).filter((target) => target.path.startsWith('packages/modules/')));

for (const edition of ['lite', 'full']) {
  test(`${edition}: add module writes the package, registers it and renders the registry`, (t) => {
    const root = appWithSdk(t, edition);
    const result = addModule({ root, name: 'loyalty-points' });
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.build.workbench.json', 'jest.config.js', 'src/index.ts', 'src/manifest/declaration.ts', 'src/manifest/declaration.spec.ts', 'src/public/index.ts',
      'src/template/loyalty-points.template.ts', 'src/template/loyalty-points.template.spec.ts', 'src/workbench/components/LoyaltyPointsWorkbenchView.tsx']) assert.ok(result.created.includes(`packages/module-loyalty-points/${file}`), file);
    const manifest = JSON.parse(text(root, 'packages/module-loyalty-points/package.json'));
    assert.equal(manifest.name, '@demo/module-loyalty-points');
    assert.deepEqual(manifest.dependencies, { '@demo/agent-sdk': '*' });
    assert.match(text(root, 'packages/module-loyalty-points/src/template/loyalty-points.template.ts'), /LOYALTY_POINTS_SERVER/);
    assert.match(text(root, 'packages/module-loyalty-points/src/workbench/components/LoyaltyPointsWorkbenchView.tsx'), /@starci\/grammar\/common/);
    assert.ok(json(root, 'package.json').workspaces?.includes('packages/*'));
    assert.equal(json(root, 'package.json').dependencies?.['@demo/modules'], '*');
    for (const app of feApps(root)) {
      assert.equal(json(root, app).dependencies?.['@demo/modules'], '*', app);
      assert.equal(json(root, app).dependencies?.['@demo/module-loyalty-points'], '*', app);
    }
    assert.match(text(root, 'packages/modules/src/template/index.ts'), /import \{ LOYALTY_POINTS_SERVER \} from "@demo\/module-loyalty-points\/template"/);
    assert.match(text(root, 'packages/modules/src/manifest/index.ts'), /\[LOYALTY_POINTS_WORKBENCH\]/);
    assert.equal(json(root, 'packages/modules/package.json').dependencies?.['@demo/module-loyalty-points'], '*');
  });

  test(`${edition}: the registry is managed: sync renders it in step, a hand edit is drift`, (t) => {
    const root = appWithSdk(t, edition);
    addModule({ root, name: 'loyalty' });
    addModule({ root, name: 'booking' });
    assert.match(text(root, 'packages/modules/src/template/index.ts'), /\[BOOKING_SERVER, LOYALTY_SERVER\]/);
    assert.deepEqual(registryChecks(root).map((check) => check.status), Array(6).fill('ok'));
    fs.appendFileSync(path.join(root, 'packages/modules/src/index.ts'), '// edited\n');
    assert.deepEqual(registryChecks(root).filter((check) => check.status !== 'ok').map((check) => check.path), ['packages/modules/src/index.ts']);
  });

  test(`${edition}: remove module reverses add exactly, and add after remove renders the same tree`, (t) => {
    const root = appWithSdk(t, edition);
    const before = tree(root);
    addModule({ root, name: 'loyalty' });
    const once = tree(root);
    const removed = removeModule({ root, name: 'loyalty' });
    assert.ok(removed.removed.includes('packages/module-loyalty'));
    assert.ok(removed.removed.includes('packages/modules'));
    assert.deepEqual(tree(root), before);
    addModule({ root, name: 'loyalty' });
    assert.deepEqual(tree(root), once);
  });

  test(`${edition}: removing one of two modules keeps the registry and the other module`, (t) => {
    const root = appWithSdk(t, edition);
    addModule({ root, name: 'loyalty' });
    addModule({ root, name: 'booking' });
    removeModule({ root, name: 'loyalty' });
    assert.ok(!fs.existsSync(path.join(root, 'packages/module-loyalty')));
    assert.ok(fs.existsSync(path.join(root, 'packages/module-booking/package.json')));
    assert.doesNotMatch(text(root, 'packages/modules/src/template/index.ts'), /LOYALTY/);
    assert.match(text(root, 'packages/modules/src/template/index.ts'), /BOOKING_SERVER/);
    for (const app of feApps(root)) assert.equal(json(root, app).dependencies?.['@demo/module-loyalty'], undefined, app);
    assert.ok(json(root, 'package.json').workspaces?.includes('packages/*'));
  });
}

test('add module refuses a missing agent SDK, a bad name, a second add and an unknown remove', (t) => {
  const root = appWithSdk(t, 'lite');
  assert.throws(() => addModule({ root, name: 'Bad Name' }), { code: 'HFS_ADD_NAME_INVALID' });
  assert.throws(() => removeModule({ root, name: 'absent' }), { code: 'HFS_REMOVE_NOT_FOUND' });
  addModule({ root, name: 'loyalty' });
  assert.throws(() => addModule({ root, name: 'loyalty' }), { code: 'HFS_ADD_EXISTS' });
  fs.rmSync(path.join(root, 'packages', 'agent-sdk'), { recursive: true });
  assert.throws(() => addModule({ root, name: 'booking' }), { code: 'HFS_ADD_MODULE_SDK_MISSING' });
  assert.ok(!fs.existsSync(path.join(root, 'packages/module-booking')));
});

test('the module noun of addKind registers the package, and the module packages enter the sonar, codecov and test scope', (t) => {
  const root = appWithSdk(t, 'lite');
  const noun = addKind({ repoRoot: root, noun: 'module', name: 'loyalty' });
  assert.ok(noun.created.includes('packages/module-loyalty/package.json'));
  const targets = rendered(root);
  const body = (file: string): string => targets.find((target) => target.path === file)?.content ?? '';
  assert.match(body('sonar-project.properties'), /packages\/module-loyalty\/src/);
  assert.match(body('sonar-project.properties'), /packages\/module-loyalty\/src\/workbench\/\*\*/);
  assert.match(body('codecov.yml'), /packages\/module-loyalty\/src\/template\/\*\*/);
  const scripts = targets.find((target) => target.path === 'package.json')?.scripts as Record<string, string>;
  assert.equal(scripts['build:modules'], 'turbo run build --filter=./packages/*');
  assert.match(scripts['test'] ?? '', /npm run test:modules$/);
  assert.match(scripts['typecheck'] ?? '', /^npm run build:modules --silent && /);
});

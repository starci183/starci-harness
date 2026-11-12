// module-package.spec.mts - `starci app add module <name>` writes a module package of the product's agent SDK and registers it; `remove module` reverses
// every step; the registry package is managed (sync renders it, a hand edit is drift) unless the app keeps its modules as data; the module packages
// enter the sonar, codecov and test scope.
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
  fs.mkdirSync(path.join(root, 'packages', 'sdk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'sdk', 'package.json'), '{"name":"@demo/sdk","version":"0.0.0","private":true}\n');
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
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.build.workbench.json', 'src/index.ts', 'src/manifest/declaration.ts', 'src/manifest/declaration.spec.ts', 'src/public/index.ts',
      'src/template/loyalty-points.template.ts', 'src/template/loyalty-points.template.spec.ts', 'src/workbench/components/LoyaltyPointsWorkbenchView.tsx']) assert.ok(result.created.includes(`packages/module-loyalty-points/${file}`), file);
    assert.ok(!result.created.includes('packages/module-loyalty-points/jest.config.js'), 'its specs run in the unit run of the back end, never a jest of its own');
    const manifest = JSON.parse(text(root, 'packages/module-loyalty-points/package.json'));
    assert.equal(manifest.name, '@demo/module-loyalty-points');
    assert.equal(manifest.scripts?.test, undefined);
    assert.equal(manifest.devDependencies?.jest, undefined);
    assert.deepEqual(manifest.dependencies, { '@demo/sdk': '*' });
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
  fs.rmSync(path.join(root, 'packages', 'sdk'), { recursive: true });
  assert.throws(() => addModule({ root, name: 'booking' }), { code: 'HFS_ADD_MODULE_SDK_MISSING' });
  assert.ok(!fs.existsSync(path.join(root, 'packages/module-booking')));
});

test('an app that declares modules: "data" has no rendered registry, its own packages/modules is no drift, and the module verbs refuse', (t) => {
  const root = appWithSdk(t, 'lite');
  addModule({ root, name: 'loyalty' });
  const declaration = JSON.parse(text(root, 'hfs.json')) as Record<string, unknown>;
  fs.writeFileSync(path.join(root, 'hfs.json'), `${JSON.stringify({ ...declaration, modules: 'data' }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'packages', 'modules', 'src', 'index.ts'), 'export { MODULE_SERVERS } from "./module-servers"\n');
  assert.deepEqual(rendered(root).filter((target) => target.path.startsWith('packages/modules/')), []);
  assert.ok(rendered(root).some((target) => target.path === 'eslint.config.mjs'), 'the module packages are still root packages, linted and measured');
  assert.throws(() => addModule({ root, name: 'booking' }), { code: 'HFS_MODULES_ARE_DATA' });
  assert.throws(() => removeModule({ root, name: 'loyalty' }), { code: 'HFS_MODULES_ARE_DATA' });
  assert.ok(fs.existsSync(path.join(root, 'packages', 'module-loyalty')));
  fs.writeFileSync(path.join(root, 'hfs.json'), `${JSON.stringify({ ...declaration, modules: 'packages' }, null, 2)}\n`);
  assert.throws(() => rendered(root), /modules is `"data"`/);
});

test('the module noun of addKind registers the package, and the root packages enter the sonar, codecov and unit-run scope', (t) => {
  const root = appWithSdk(t, 'lite');
  fs.mkdirSync(path.join(root, 'packages', 'sdk', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'sdk', 'src', 'index.ts'), 'export {}\n');
  // an install folder the workspaces leave under packages/ is no package
  fs.mkdirSync(path.join(root, 'packages', 'node_modules', '.bin'), { recursive: true });
  const noun = addKind({ repoRoot: root, noun: 'module', name: 'loyalty' });
  assert.ok(noun.created.includes('packages/module-loyalty/package.json'));
  const targets = rendered(root);
  const body = (file: string): string => targets.find((target) => target.path === file)?.content ?? '';
  for (const folder of ['packages/sdk', 'packages/module-loyalty']) {
    assert.match(body('sonar-project.properties'), new RegExp(`${folder}/src[,\\n]`));
    for (const unmeasured of ['src/workbench/**', 'src/public/**', 'src/client/**', 'src/**/index.ts', 'src/**/*.types.ts', 'src/**/*-types.ts']) assert.ok(body('sonar-project.properties').includes(`${folder}/${unmeasured}`), `${folder}/${unmeasured}`);
    assert.ok(body('codecov.yml').includes(`"${folder}/src/**"`), folder);
  }
  assert.ok(!body('sonar-project.properties').includes('packages/node_modules'));
  assert.equal(body('be/jest.config.js'), `module.exports = require("@starci/jest-preset").starciJestConfig({
    coverage: ${/coverage: (\{[\s\S]*?\n {4}\}),/u.exec(body('be/jest.config.js'))?.[1]},
    packages: {
        folders: ["packages/sdk", "packages/module-loyalty"],
        files: ["packages/sdk/src/**/*.ts", "packages/module-loyalty/src/**/*.ts"],
        excludes: [
            "packages/sdk/src/workbench/**",
            "packages/sdk/src/public/**",
            "packages/sdk/src/client/**",
            "packages/sdk/src/**/index.ts",
            "packages/sdk/src/**/*.types.ts",
            "packages/sdk/src/**/*-types.ts",
            "packages/module-loyalty/src/workbench/**",
            "packages/module-loyalty/src/public/**",
            "packages/module-loyalty/src/client/**",
            "packages/module-loyalty/src/**/index.ts",
            "packages/module-loyalty/src/**/*.types.ts",
            "packages/module-loyalty/src/**/*-types.ts",
        ],
    },
})
`, 'the unit run of the back end runs the specs of the root packages and measures their logic');
  const scripts = targets.find((target) => target.path === 'package.json')?.scripts as Record<string, string>;
  assert.equal(scripts['build:modules'], 'turbo run build --filter=./packages/*');
  assert.match(scripts['test'] ?? '', /^npm run build:modules --silent && cd be && jest --selectProjects unit --coverage$/, 'the unit run finds the packages built, and jest keeps the arguments npm test passes');
  assert.match(scripts['build:be'] ?? '', /^npm run build:modules --silent && cd be && tsc /);
  assert.equal(scripts['test:modules'], undefined, 'no second test run: the unit run and its CI shards hold the packages');
  assert.doesNotMatch(body('.github/workflows/ci.yml'), /test:modules/);
  assert.match(body('.github/workflows/ci.yml'), /^ {8}side: \[be, fe, packages\]$/m, 'the root packages lint in a job of their own');
  assert.match(body('.github/workflows/ci.yml'), /const files = \['reports\/lint\.be\.sonar\.json', 'reports\/lint\.fe\.sonar\.json', 'reports\/lint\.packages\.sonar\.json'\];/);
  assert.match(scripts['typecheck'] ?? '', /^npm run build:modules --silent && /);
});

test('an app whose only root package is the agent SDK builds it first and runs its specs, and an app without one keeps the back-end config alone', (t) => {
  const root = appWithSdk(t, 'full');
  const bare = rendered(root).find((target) => target.path === 'be/jest.config.js')?.content ?? '';
  assert.doesNotMatch(bare, /packages:/, 'a folder with no src is no root package');
  const ci = rendered(root).find((target) => target.path === '.github/workflows/ci.yml')?.content ?? '';
  assert.match(ci, /^ {8}side: \[be, fe\]$/m);
  assert.match(ci, /const files = \['reports\/lint\.be\.sonar\.json', 'reports\/lint\.fe\.sonar\.json'\];/);
  fs.mkdirSync(path.join(root, 'packages', 'sdk', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'sdk', 'src', 'index.ts'), 'export {}\n');
  const targets = rendered(root);
  assert.match(targets.find((target) => target.path === 'be/jest.config.js')?.content ?? '', /folders: \["packages\/sdk"\]/);
  const scripts = targets.find((target) => target.path === 'package.json')?.scripts as Record<string, string>;
  assert.equal(scripts['build:modules'], 'turbo run build --filter=./packages/*');
  assert.match(scripts['test'] ?? '', /^npm run build:modules --silent && /);
});

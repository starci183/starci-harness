// lint-canon-scope.spec.mts - the lint scope `starci app check --gate lint` reads (canonScope) must accept the real built flat config of both
// canons, as an app's be, fe and packages eslint.config compose it. canonScope refuses a negated selector, so a canon block that narrows
// itself with `ignores: ['**/*', '!**/*.spec.ts']` ended every app lint in "unsupported canon ignores selectors" and linted nothing.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonScope } from '../lint/run.mjs';
import { starterDeclaration } from '../scaffold/app.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

type Dynamic = any;

const PACKAGES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** An app root holding only its declaration: the folder the canons' `loadHfs` and `loadPackagesHfs` read, as the app's own eslint.config would. */
const appRoot = (t: TestContext): string => {
  const root = mkdtemp(t, 'starci-canon-scope-');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(starterDeclaration('demo'), null, 2));
  return root;
};
const configUrl = (...parts: string[]): string => pathToFileURL(path.join(...parts, 'eslint.config.mjs')).href;
const load = async (name: string): Promise<Dynamic> => import(pathToFileURL(path.join(PACKAGES, name, 'dist', 'index.js')).href);

test('the built be canon config (app and packages) is a lint scope that holds a source file and a spec file', async (t) => {
  const root = appRoot(t);
  const be = await load('eslint-canon-be');
  const configs: Record<string, Dynamic[]> = {
    'be/': await be.starciBeConfig({ hfs: be.loadHfs(configUrl(root, 'be')) }),
    'packages/': await be.starciBePackagesConfig({ hfs: be.loadPackagesHfs(configUrl(root)) }),
  };
  const files: Record<string, { source: string; spec: string }> = {
    'be/': { source: 'src/orders/order.service.ts', spec: 'src/orders/order.service.spec.ts' },
    'packages/': { source: 'packages/kit/src/kit.service.ts', spec: 'packages/kit/src/kit.service.spec.ts' },
  };
  for (const [scope, config] of Object.entries(configs)) {
    const lintScope = canonScope(config);
    assert.equal(lintScope.source(files[scope]!.source), true, `${scope} source file`);
    assert.equal(lintScope.source(files[scope]!.spec), true, `${scope} spec file`);
    assert.equal(lintScope.source('README.md'), false, `${scope} non-source file`);
  }
});

test('the built fe canon config (app, packages and plain source) is a lint scope that holds a source file and a spec file', async (t) => {
  const root = appRoot(t);
  const fe = await load('eslint-canon-fe');
  const cases: { scope: string; config: Dynamic[]; source: string; spec: string }[] = [
    { scope: 'fe/', config: fe.starciFeConfig({ hfs: fe.loadHfs(configUrl(root, 'fe')) }), source: 'apps/web/src/modules/home/home.tsx', spec: 'apps/web/src/modules/home/home.spec.tsx' },
    { scope: 'packages/', config: fe.starciFePackagesConfig({ hfs: fe.loadPackagesHfs(configUrl(root)) }), source: 'packages/kit/src/views/panel.tsx', spec: 'packages/kit/src/views/panel.spec.tsx' },
    { scope: 'plain src/', config: fe.starciPlainSourceConfig({ root }), source: 'src/panel.tsx', spec: 'src/panel.spec.tsx' },
  ];
  for (const { scope, config, source, spec } of cases) {
    const lintScope = canonScope(config);
    assert.equal(lintScope.source(source), true, `${scope} source file`);
    assert.equal(lintScope.source(spec), true, `${scope} spec file`);
    assert.equal(lintScope.source('README.md'), false, `${scope} non-source file`);
  }
});

test('canonScope refuses the negated spec selector the canons used to write', () => {
  assert.throws(() => canonScope([{ files: ['**/*.ts'] }, { files: ['**/*.ts'], ignores: ['**/*', '!**/*.spec.ts'] }]), /unsupported canon ignores selectors/);
});

test('canonScope reads a files entry that is a list of globs as all of them', () => {
  const scope = canonScope([{ files: [['packages/kit/src/views/**', '**/*.{ts,tsx}']], ignores: ['packages/kit/src/views/contract/**'] }]);
  assert.equal(scope.source('packages/kit/src/views/panel.ts'), true);
  assert.equal(scope.source('packages/kit/src/views/panel.css'), false, 'one glob of the list does not match');
  assert.equal(scope.source('packages/kit/src/node/panel.ts'), false);
  assert.equal(scope.source('packages/kit/src/views/contract/panel.ts'), false, 'the block ignores it');
  assert.throws(() => canonScope([{ files: [['**/*.ts', '!**/*.spec.ts']] }]), /unsupported canon files selectors/);
});

test('the built canons hand the slots a project declares lint fe to the front end, and know no folder of a package', async (t) => {
  const root = appRoot(t);
  const be = await load('eslint-canon-be');
  const fe = await load('eslint-canon-fe');
  const scopes = async (): Promise<{ be: ReturnType<typeof canonScope>; fe: ReturnType<typeof canonScope> }> => ({
    be: canonScope(await be.starciBePackagesConfig({ hfs: be.loadPackagesHfs(configUrl(root)) })),
    fe: canonScope(fe.starciFePackagesConfig({ hfs: fe.loadPackagesHfs(configUrl(root)) })),
  });
  fs.mkdirSync(path.join(root, 'packages', 'kit'), { recursive: true });
  const undeclared = await scopes();
  for (const file of ['packages/kit/src/workbench/panel.ts', 'packages/kit/src/public/page.ts', 'packages/kit/src/client/api.ts', 'packages/kit/src/views/panel.ts']) {
    assert.equal(undeclared.be.source(file), true, `${file} is back end: no folder name is the front end's`);
    assert.equal(undeclared.fe.source(file), false, file);
  }
  assert.equal(undeclared.fe.source('packages/kit/src/views/Panel.tsx'), true, 'every .tsx file belongs to the front end');
  fs.mkdirSync(path.join(root, 'ext'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ext', 'manifest.json'), JSON.stringify({ schema: 'starci/project-ext@1', api: 1, packages: { 'packages/kit': { closed: false, slots: [
    { id: 'contract', path: 'src/views/contract/**' },
    { id: 'views', path: 'src/views/**', lint: 'fe', coverage: { none: "front-end views, proven by the front end's own gates" } },
  ] } } }));
  const declared = await scopes();
  assert.equal(declared.fe.source('packages/kit/src/views/panel.ts'), true);
  assert.equal(declared.be.source('packages/kit/src/views/panel.ts'), false);
  assert.equal(declared.be.source('packages/kit/src/views/contract/shape.ts'), true, 'a back-end slot declared before the views stays back end');
  assert.equal(declared.fe.source('packages/kit/src/views/contract/shape.ts'), false);
  assert.equal(declared.be.source('packages/kit/src/node/kit.service.ts'), true);
});

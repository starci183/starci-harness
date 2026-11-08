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
    { scope: 'packages/', config: fe.starciFePackagesConfig({ hfs: fe.loadPackagesHfs(configUrl(root)) }), source: 'packages/kit/src/workbench/panel.tsx', spec: 'packages/kit/src/workbench/panel.spec.tsx' },
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

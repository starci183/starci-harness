import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { archFixture, runArch, ts } from './helpers/hfs-arch-fixture.mjs';
import type { FileMap, Side } from './helpers/hfs-arch-fixture.mjs';
import { loadArchitectureConfig } from '../runtime/scripts/hfs/architecture/config.mjs';
import { buildTypeScriptContext } from '../runtime/scripts/hfs/architecture/typescript.mjs';
import { withTypeScriptProgramRun } from '../runtime/scripts/hfs/typescript-programs.mjs';

// An app's ROOT workspace packages (packages/<name>: the agent SDK, a block library, a module package, the managed packages/modules) lie outside both side
// folders, and both sides import them by their package name. The import graph reads them as first-party packages: an import through a
// package entry point (an `exports` subpath) is not an import that leaves the side and never stops the graph; an import into the
// package's source stays refused (ARCH_INTERNAL_IMPORT_OUTSIDE). An app's `@fixture/sdk/workbench` crashed the front-end lint run, and
// `@fixture/sdk` the back end's, because a tsconfig path alias sends the name to packages/sdk/src.

const SDK_EXPORTS = {
  '.': { types: './dist/index.d.ts', default: './dist/index.js' },
  './node': { types: './dist/node/index.d.ts', default: './dist/node/index.js' },
  './workbench': { types: './dist/esm/workbench/index.d.ts', default: './dist/esm/workbench/index.js' },
};

const packageFiles = (name: string, exports: object): FileMap => ({
  [`../packages/${name}/package.json`]: JSON.stringify({ name: `@fixture/${name}`, version: '0.1.0', private: true, exports }),
  [`../packages/${name}/tsconfig.json`]: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true }, include: ['src'] }),
  [`../packages/${name}/src/index.ts`]: 'export const sdk = 1;\n',
  [`../packages/${name}/src/node/index.ts`]: 'export const node = 1;\n',
  [`../packages/${name}/src/workbench/index.ts`]: 'export const SlotView = 1;\n',
  [`../packages/${name}/src/internal/secret.ts`]: 'export const secret = 1;\n',
});

const tsconfig = (extra: object = {}) => JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', allowJs: true, skipLibCheck: true, noEmit: true, experimentalDecorators: true, baseUrl: '.',
    paths: {
      '@fixture/sdk': ['../packages/sdk/src/index.ts'],
      '@fixture/sdk/*': ['../packages/sdk/src/*'],
      '@fixture/module-loyalty/*': ['../packages/module-loyalty/src/*'],
      ...extra,
    },
  },
  include: ['src/**/*', 'apps/**/*'],
});

const WORKSPACES = ['fe/apps/*', 'packages/*'];
const SOURCE: Record<Side, string> = { be: 'apps/core/src/uses.ts', fe: 'apps/web/src/uses.ts' };

/** The graph errors of a side that imports `lines` and sits beside the root packages. */
const graphErrors = (t: Parameters<typeof archFixture>[0], side: Side, lines: string[], files: FileMap = {}, workspaces: string[] | null = WORKSPACES) => {
  const root = archFixture(t, {
    profile: side,
    files: {
      '../package.json': JSON.stringify({ name: 'fixture', private: true, ...(workspaces ? { workspaces } : {}) }),
      'tsconfig.json': tsconfig(),
      ...packageFiles('sdk', SDK_EXPORTS),
      ...packageFiles('module-loyalty', { './workbench': { default: './dist/workbench/index.js' } }),
      [SOURCE[side]]: `${lines.join('\n')}\nexport const used = 1;\n`,
      ...files,
    },
  });
  const config = loadArchitectureConfig(root);
  const context = withTypeScriptProgramRun(() => buildTypeScriptContext(config, ts));
  return { config, errors: context.errors, root };
};

test('the root workspace packages of the app are read as first-party packages from the package.json workspaces', (t) => {
  const { config } = graphErrors(t, 'fe', []);
  assert.deepEqual((config.rootPackages ?? []).map(item => [item.name, item.relative]), [['@fixture/module-loyalty', 'packages/module-loyalty'], ['@fixture/sdk', 'packages/sdk']]);
});

test('the slots app.packages and app.module-registry name root packages that the workspaces forgot to list', (t) => {
  const { config } = graphErrors(t, 'be', [], packageFiles('modules', { '.': { default: './dist/index.js' } }), ['fe/apps/*']);
  assert.deepEqual((config.rootPackages ?? []).map(item => item.name), ['@fixture/module-loyalty', '@fixture/modules', '@fixture/sdk']);
});

test('a block library is a root package by any name: the workspaces list it, and app.packages places it when they do not', (t) => {
  const blocks = packageFiles('ui-kit', { '.': { default: './dist/index.js' } });
  const listed = graphErrors(t, 'fe', [], blocks);
  assert.deepEqual((listed.config.rootPackages ?? []).map(item => item.relative), ['packages/module-loyalty', 'packages/sdk', 'packages/ui-kit']);
  const placed = graphErrors(t, 'be', [], blocks, ['fe/apps/*']);
  assert.deepEqual((placed.config.rootPackages ?? []).map(item => item.relative), ['packages/module-loyalty', 'packages/sdk', 'packages/ui-kit']);
});

test('a front-end import of a package entry point (@scope/pkg/workbench) neither leaves the side nor stops the graph', (t) => {
  const { errors } = graphErrors(t, 'fe', ["import { SlotView } from '@fixture/sdk/workbench';", 'void SlotView;']);
  assert.deepEqual(errors, []);
});

test('a back-end import of the package root (@scope/pkg) neither leaves the side nor stops the graph', (t) => {
  const { errors } = graphErrors(t, 'be', ["import { sdk } from '@fixture/sdk';", "import { node } from '@fixture/sdk/node';", 'void sdk; void node;']);
  assert.deepEqual(errors, []);
});

test('an entry point is read the same when the package is not an npm workspace of the manifest but a slot places it', (t) => {
  const { errors } = graphErrors(t, 'fe', ["import { SlotView } from '@fixture/sdk/workbench';", 'void SlotView;'], {}, null);
  assert.deepEqual(errors, []);
});

test('an import into the package source past its entry points stays refused, whatever alias reaches it', (t) => {
  const { errors } = graphErrors(t, 'fe', ["import { secret } from '@fixture/sdk/internal/secret';", 'void secret;']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.ruleId, 'ARCH_INTERNAL_IMPORT_OUTSIDE');
  assert.equal(errors[0]?.specifier, '@fixture/sdk/internal/secret');
  assert.match(errors[0]?.message ?? '', /past its package entry points; import @fixture\/sdk, @fixture\/sdk\/node, @fixture\/sdk\/workbench instead/);
});

test('a subpath the package does not export is refused even when a source file of that name exists', (t) => {
  const { errors } = graphErrors(t, 'be', ["import { SlotView } from '@fixture/module-loyalty/workbench';", "import { secret } from '@fixture/module-loyalty/src/index';", 'void SlotView; void secret;']);
  assert.deepEqual(errors.map(item => [item.ruleId, item.specifier]), [['ARCH_INTERNAL_IMPORT_OUTSIDE', '@fixture/module-loyalty/src/index']]);
});

test('a relative import into the package source leaves the side as before', (t) => {
  const { errors } = graphErrors(t, 'fe', ["import { secret } from '../../../../packages/sdk/src/internal/secret';", 'void secret;']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.ruleId, 'ARCH_INTERNAL_IMPORT_OUTSIDE');
  assert.match(errors[0]?.message ?? '', /leaves the fe side for packages\/sdk\/src\/internal\/secret\.ts/);
});

test('an entry point that a path alias sends outside its package is judged by the ordinary boundary', (t) => {
  const { errors, root } = graphErrors(t, 'fe', ["import { SlotView } from '@fixture/sdk/workbench';", 'void SlotView;'], {
    'tsconfig.json': tsconfig({ '@fixture/sdk/workbench': ['../elsewhere/workbench.ts'] }),
    '../elsewhere/workbench.ts': 'export const SlotView = 1;\n',
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.ruleId, 'ARCH_INTERNAL_IMPORT_OUTSIDE');
  assert.match(errors[0]?.message ?? '', /leaves the fe side for elsewhere\/workbench\.ts/);
  assert.equal(path.basename(root), 'fe');
});

test('the whole machine builds the graph of a side that imports a package entry point (the build that stopped the lint run)', (t) => {
  const { root } = graphErrors(t, 'fe', ["import { SlotView } from '@fixture/sdk/workbench';", 'void SlotView;']);
  const report = runArch(root);
  assert.deepEqual(report.errors, []);
  const refused = graphErrors(t, 'fe', ["import { secret } from '@fixture/sdk/internal/secret';", 'void secret;']);
  assert.deepEqual(runArch(refused.root).errors.map(item => item.ruleId), ['ARCH_INTERNAL_IMPORT_OUTSIDE']);
});

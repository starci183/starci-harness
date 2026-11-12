import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { eslintRepository } from '../lint/run.mjs';
import type { LinterRunner, LinterSpec } from '../lint/run.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { renderRepo } from '../sync/index.mjs';
import { PRESETS } from './helpers/hfs-cli-fixture.mjs';

// No config of a side reaches `packages/` (ESLint ignores a file outside the base path of the config), so the code of an app's root workspace
// packages was never linted. The managed `eslint.config.mjs` of the app root selects `packages/<pkg>/src/**` by subpath, and `app check --gate lint`
// runs it as a third scope beside be/ and fe/: from the app root, over the package sources, its findings app-relative.

const rootConfig = [
  "export default [",
  "  { ignores: ['**/node_modules/**', '**/dist/**'] },",
  "  { files: ['packages/*/src/**/*.{ts,mts}'], ignores: ['packages/*/src/workbench/**'] },",
  "  { files: ['packages/*/src/workbench/**/*.{ts,tsx}'] },",
  "];",
  '',
].join('\n');

function appWithPackages(context: TestContext, { config = true }: { config?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-packages-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write('hfs.json', JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] } } }));
  write('package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }));
  if (config) write('eslint.config.mjs', rootConfig);
  write('packages/sdk/package.json', JSON.stringify({ name: '@fixture/sdk', private: true }));
  write('packages/sdk/src/index.ts', 'export const sdk = 1;\n');
  write('packages/sdk/src/node/index.ts', 'export const node = 1;\n');
  write('packages/sdk/src/workbench/View.tsx', 'export const View = 1;\n');
  write('packages/sdk/dist/index.ts', 'export const built = 1;\n');
  write('packages/sdk/node_modules/dep/index.ts', 'export const dep = 1;\n');
  return root;
}

/** A runner that answers every file of the run with a clean result, and one finding for `src/node/index.ts`. */
function recorder(root: string, specs: LinterSpec[]): LinterRunner {
  return async (spec) => {
    specs.push(spec);
    const files = ['packages/sdk/src/index.ts', 'packages/sdk/src/node/index.ts', 'packages/sdk/src/workbench/View.tsx'];
    return { results: files.map((file) => ({
      filePath: path.join(root, file),
      messages: file.endsWith('node/index.ts') ? [{ ruleId: 'starci-be/explicit-export-surface', severity: 2, line: 1, column: 14, message: '[HFS_EXPLICIT_EXPORT_SURFACE] `node` is exported with an inferred type' }] : [],
    })) };
  };
}

const app = (root: string) => readRepoDeclaration(loadSlotManifest(), root);

test('the packages are a lint scope of the app root: run from the root over packages/, the sources chosen by the root config', async (t) => {
  const root = appWithPackages(t);
  const specs: LinterSpec[] = [];
  const result = await eslintRepository({ repoRoot: root, app: app(root), opts: { side: 'packages' }, run: recorder(root, specs) });
  assert.deepEqual(result.errors, []);
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.cwd, root);
  assert.deepEqual(specs[0]?.args, ['--format', 'json', 'packages']);
  assert.equal(specs[0]?.files, 3, 'the build output, the installed packages and nothing else are left out of the scope');
  assert.deepEqual(result.engine.sides, { packages: { files: 3 } });
  assert.deepEqual(result.findings.map((finding) => [finding.path, finding.code, finding.rule, finding.line]), [['packages/sdk/src/node/index.ts', 'HFS_EXPLICIT_EXPORT_SURFACE', 'starci-be/explicit-export-surface', 1]]);
});

test('without the root config an app has no packages scope: the sides are the whole lint', async (t) => {
  const root = appWithPackages(t, { config: false });
  const specs: LinterSpec[] = [];
  const result = await eslintRepository({ repoRoot: root, app: app(root), opts: { side: 'packages' }, run: recorder(root, specs) });
  assert.deepEqual(specs, []);
  assert.deepEqual(result.engine.sides, {});
  assert.deepEqual(result.findings, []);
});

test('a changed list reaches the packages scope by its app-relative files only', async (t) => {
  const root = appWithPackages(t);
  const specs: LinterSpec[] = [];
  const quiet = await eslintRepository({ repoRoot: root, app: app(root), opts: { side: 'packages' }, changed: ['be/src/a.ts'], existing: ['be/src/a.ts'], run: recorder(root, specs) });
  assert.deepEqual(quiet.engine.sides, { packages: { files: 0, skipped: 'no changed source file' } });
  assert.equal(specs.length, 0);
  const seen: LinterSpec[] = [];
  const listed = await eslintRepository({ repoRoot: root, app: app(root), opts: { side: 'packages' }, changed: ['packages/sdk/src/node/index.ts'], existing: ['packages/sdk/src/node/index.ts'], run: async (spec) => { seen.push(spec); return { results: [{ filePath: path.join(root, 'packages/sdk/src/node/index.ts'), messages: [] }] }; } });
  assert.deepEqual(listed.errors, []);
  assert.deepEqual(seen[0]?.list, ['packages/sdk/src/node/index.ts']);
  assert.equal(seen[0]?.cwd, root);
});

test('sync renders the root config for an app with root packages, selecting the family of the app, and none for an app without', async (t) => {
  const root = appWithPackages(t, { config: false });
  const rendered = await renderRepo(root, { presets: PRESETS });
  const target = rendered.targets.find((item) => item.path === 'eslint.config.mjs');
  assert.ok(target, 'an app with a root package gets the managed root eslint config');
  assert.equal(target.scope, 'app');
  assert.match(target.content, /import \{ loadPackagesHfs as loadBePackages, starciBePackagesConfig \} from "@starci\/eslint-canon-be"/);
  assert.match(target.content, /import \{ loadPackagesHfs as loadFePackages, starciFePackagesConfig \} from "@starci\/eslint-canon-fe"/);
  assert.match(target.content, /export default \[\n {4}\.\.\.\(await starciBePackagesConfig\(\{ hfs: be \}\)\),\n {4}\.\.\.starciFePackagesConfig\(\{ hfs: fe \}\),\n {4}\.\.\.coreGrammarPackagesConfig\(\{ hfs: fe \}\),\n\]/, 'laid out as the canon config prints it (src/sync-prettier.spec.mts)');
  fs.rmSync(path.join(root, 'packages'), { recursive: true });
  const bare = await renderRepo(root, { presets: PRESETS });
  assert.equal(bare.targets.some((item) => item.path === 'eslint.config.mjs'), false);
});

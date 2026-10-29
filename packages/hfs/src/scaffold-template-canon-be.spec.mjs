// scaffold-template-canon-be.spec.mjs - the skeleton's platform capabilities, code and specs, pass the back-end canon they ship with.
// An app copies a platform capability byte-identical, so a skeleton file the canon refuses is a finding every app inherits
// and cannot fix. Each edition is scaffolded into a temp folder and every file under its src/modules/platform is linted, typed, with the
// starci-be rules of @starci/eslint-canon-be (the sibling package's source, the factory the rendered be/eslint.config.mjs
// calls). The parser reads a tsconfig that extends the app's own and adds only where this package's installs live, so the
// rules judge the real types of Nest, undici, node and the kit; the kit is copied to node_modules/@starci/jest-preset,
// where a rule recognises a kit double by its declaring package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { loadHfs, starciBeConfig } from '../../eslint-canon-be/src/index.ts';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const HFS = path.resolve(import.meta.dirname, '..');
const KIT = path.resolve(HFS, '..', 'jest-preset');
/** Where the types a skeleton file imports are installed: this package's dev dependencies and the kit's (jest's globals). */
const INSTALLS = [path.join(HFS, 'node_modules'), path.join(KIT, 'node_modules')];

const lockedOk = (root) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The canon's flat config with only its own starci-be rules on: the canon-be laws, not the stock rules it composes. */
const canonRulesOnly = (config) => config.map((block) => (block.rules === undefined ? block : {
  ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => id.startsWith('starci-be/'))),
}));

/** A tsconfig beside the app's that resolves every package from the installs above; the app's own tsconfig stays as rendered. */
const lintProject = (be) => {
  const { paths } = JSON.parse(fs.readFileSync(path.join(be, 'tsconfig.json'), 'utf8')).compilerOptions;
  const file = path.join(be, 'tsconfig.canon.json');
  fs.writeFileSync(file, JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
    typeRoots: INSTALLS.map((dir) => path.join(dir, '@types')), types: ['node', 'jest'],
    paths: { ...paths, '*': INSTALLS.map((dir) => path.join(dir, '*')) },
  } }));
  return file;
};

/** The kit, built, where an app installs it. */
const installKit = (root) => {
  for (const part of ['package.json', 'dist']) fs.cpSync(path.join(KIT, part), path.join(root, 'node_modules', '@starci', 'jest-preset', part), { recursive: true });
};

for (const edition of ['full', 'lite']) {
  test(`the ${edition} skeleton's platform capabilities pass the starci-be canon`, { timeout: 300_000 }, async (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-template-canon-be-'), harness: { version: '1.1.0-alpha.3' }, edition, authCallback: edition === 'lite',
      presets: bundledPresets(), lock: lockedOk, initGit: init, emitTypes: () => 'export type Database = Record<string, never>\n' });
    gitAdd(installTypeScript(root));
    installKit(root);
    const be = path.join(root, 'be');
    const project = lintProject(be);
    const config = canonRulesOnly(await starciBeConfig({ hfs: loadHfs(pathToFileURL(path.join(be, 'eslint.config.mjs'))) }));
    assert.ok(config.some((block) => Object.keys(block.rules ?? {}).includes('starci-be/http-needs-timeout')), 'the canon rules are on');
    const eslint = new ESLint({ cwd: be, overrideConfigFile: true, errorOnUnmatchedPattern: false, overrideConfig: [
      ...config, { files: ['**/*.ts'], languageOptions: { parserOptions: { projectService: false, project, tsconfigRootDir: be } } },
    ] });
    const results = await eslint.lintFiles(['src/modules/platform/**/*.ts']);
    const linted = results.map((result) => path.relative(be, result.filePath).split(path.sep).join('/'));
    assert.ok(linted.includes('src/modules/platform/http/fetch-http-client.client.ts'), 'the client is linted');
    assert.ok(linted.includes('src/modules/platform/http/fetch-http-client.client.spec.ts'), 'its spec is linted');
    const findings = results.flatMap((result) => result.messages.map((message) => `${path.relative(be, result.filePath).split(path.sep).join('/')}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`));
    assert.deepEqual(findings, []);
  });
}

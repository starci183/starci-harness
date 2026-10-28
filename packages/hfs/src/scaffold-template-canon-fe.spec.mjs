// scaffold-template-canon-fe.spec.mjs - every front-end file `starci app scaffold` writes passes the universal front-end canon.
// The fe skeleton is not sync-managed, so a new app keeps whatever the templates render: a template the canon refuses is a
// defect every new app inherits. Each edition is scaffolded into a temp folder and its fe sources are linted, typed, with the
// starci-fe rules of @starci/eslint-canon-fe (the sibling package's source, the factory the rendered fe/eslint.config.mjs calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { loadHfs, starciFeConfig } from '../../eslint-canon-fe/src/index.ts';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const lockedOk = (root) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The canon's flat config with only its own starci-fe rules on: the canon-fe laws, not the stock rules it composes. */
const canonRulesOnly = (config) => config.map((block) => (block.rules === undefined ? block : {
  ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => id.startsWith('starci-fe/'))),
}));

for (const edition of ['full', 'lite']) {
  test(`every fe file the ${edition} scaffold writes passes the starci-fe canon`, { timeout: 300_000 }, async (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-template-canon-'), harness: { version: '1.1.0-alpha.3' }, edition, authCallback: edition === 'lite',
      presets: bundledPresets(), lock: lockedOk, initGit: init, emitTypes: () => 'export type Database = Record<string, never>\n' });
    gitAdd(installTypeScript(root));
    const fe = path.join(root, 'fe');
    const config = canonRulesOnly(starciFeConfig({ hfs: loadHfs(pathToFileURL(path.join(fe, 'eslint.config.mjs'))) }));
    assert.ok(config.some((block) => Object.keys(block.rules ?? {}).includes('starci-fe/base-props-atom')), 'the canon rules are on');
    const eslint = new ESLint({ cwd: fe, overrideConfigFile: true, overrideConfig: config, errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles(['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']);
    assert.ok(results.some((result) => result.filePath.endsWith(path.join('blocks', 'SignInForm', 'component.tsx'))), 'the skeleton blocks are linted');
    const findings = results.flatMap((result) => result.messages.map((message) => `${path.relative(fe, result.filePath).split(path.sep).join('/')}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`));
    assert.deepEqual(findings, []);
  });
}

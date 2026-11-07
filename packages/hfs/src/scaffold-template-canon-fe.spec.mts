// scaffold-template-canon-fe.spec.mts - every front-end file `starci app scaffold` writes passes the universal front-end canon.
// The fe skeleton is not sync-managed, so a new app keeps whatever the templates render: a template the canon refuses is a
// defect every new app inherits. Each edition is scaffolded into a temp folder and its fe sources are linted, typed, with the
// config of @starci/eslint-canon-fe as the rendered fe/eslint.config.mjs builds it (shippedCanon) (the sibling package's source): its starci-fe laws and
// the stock rules it composes alike, so a template and the canon it ships with never contradict each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { loadHfs, starciFeConfig } from '../../eslint-canon-fe/src/index.ts';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/**
 * The typescript-eslint rules whose verdict is the installed type graph: this fixture installs no React, Next or Grammar, so their types
 * read as unresolved here and these rules would judge the fixture, not the template. An app installs everything and its own lint runs them.
 */
const TYPE_GRAPH_RULES = new Set(['@typescript-eslint/no-unsafe-assignment', '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-call', '@typescript-eslint/no-unsafe-return', '@typescript-eslint/no-unsafe-argument']);

/** The canon's flat config as the rendered fe/eslint.config.mjs builds it, all of it but TYPE_GRAPH_RULES. */
const shippedCanon = (config: Linter.Config[]): Linter.Config[] => config.map((block) => (block.rules === undefined ? block : {
  ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => !TYPE_GRAPH_RULES.has(id))),
}));

for (const edition of ['full', 'lite']) {
  test(`every fe file the ${edition} scaffold writes passes the starci-fe canon`, { timeout: 300_000 }, async (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-template-canon-'), harness: { version: '1.1.0-alpha.3' }, edition,
      presets: bundledPresets(), lock: lockedOk, initGit: init });
    gitAdd(installTypeScript(root));
    const fe = path.join(root, 'fe');
    const config = shippedCanon(starciFeConfig({ hfs: loadHfs(pathToFileURL(path.join(fe, 'eslint.config.mjs'))) }));
    assert.ok(config.some((block) => Object.keys(block.rules ?? {}).includes('starci-fe/base-props-atom')), 'the canon rules are on');
    assert.ok(config.some((block) => Object.keys(block.rules ?? {}).some((id) => id.startsWith('@typescript-eslint/'))), 'the borrowed rules are on');
    const eslint = new ESLint({ cwd: fe, overrideConfigFile: true, overrideConfig: config, errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles(['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']);
    assert.ok(results.some((result) => result.filePath.endsWith(path.join('blocks', 'SignInForm', 'component.tsx'))), 'the skeleton blocks are linted');
    const findings = results.flatMap((result) => result.messages.map((message) => `${path.relative(fe, result.filePath).split(path.sep).join('/')}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`));
    assert.deepEqual(findings, []);
  });
}

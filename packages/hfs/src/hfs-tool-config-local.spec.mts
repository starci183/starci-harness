// proves: HFS_TOOL_CONFIG_LOCAL@lite
// proves: HFS_TOOL_CONFIG_LOCAL@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTargets, writeTargets } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

const synced = (context: TestContext, edition: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const declaration = structuredClone(APP);
  declaration.edition = edition;
  if (edition === 'lite') declaration.sides.be.connections = [
    { name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' },
  ];
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const targets = renderTargets(declaration, PRESETS);
  writeTargets(root, targets);
  const tracked = ['hfs.json', ...targets.map(target => target.path)];
  return { root, tracked, findings: () => managedFindings({ repoRoot: root, tracked, presets: PRESETS }) };
};

for (const edition of ['lite', 'full']) {
  test(`${edition}: a tool config override fails and a plain lint command passes`, async context => {
    const { root, tracked, findings } = synced(context, edition);
    const relative = 'scripts/lint.mjs';
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    tracked.push(relative);
    fs.writeFileSync(file, 'export const lint = "eslint src";\n');
    assert.deepEqual(await findings(), []);
    fs.writeFileSync(file, 'export const lint = "eslint --config local.mjs src";\n');
    const found = await findings();
    assert.deepEqual(found.map(finding => [finding.code, finding.path, finding.level]), [
      ['HFS_TOOL_CONFIG_LOCAL', relative, 'error'],
    ]);
    assert.match(found[0]!.message, /--config/);
    fs.writeFileSync(file, 'export const lint = "eslint src";\n');
    assert.deepEqual(await findings(), []);
  });
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: direct managed findings reject an override and accept the plain tool command`, async (context) => {
    const { root, tracked } = synced(context, edition);
    const relative = 'scripts/coverage-lint.mjs';
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    tracked.push(relative);
    fs.writeFileSync(file, 'export const lint = "eslint src";\n');
    assert.deepEqual(await managedFindings({ repoRoot: root, tracked, presets: PRESETS }), []);
    fs.writeFileSync(file, 'export const lint = "eslint --config local.mjs src";\n');
    assert.deepEqual((await managedFindings({ repoRoot: root, tracked, presets: PRESETS }))
      .map((finding) => [finding.code, finding.path]), [['HFS_TOOL_CONFIG_LOCAL', relative]]);
    fs.writeFileSync(file, 'export const lint = "eslint src";\n');
    assert.deepEqual(await managedFindings({ repoRoot: root, tracked, presets: PRESETS }), []);
  });
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: a lint rule the project's extension manifest declares is the project's law; the same file undeclared, or anywhere else, is a local rule`, async (context) => {
    const { root, tracked } = synced(context, edition);
    const rule = 'export default { meta: { type: "problem", schema: [] }, create: (context) => ({}) };\n';
    const write = (relative: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), text);
      if (!tracked.includes(relative)) tracked.push(relative);
    };
    const manifest = (files: string[]): string => JSON.stringify({ schema: 'starci/project-ext@1', api: 1, rules: files.map((file, at) => ({ id: `ACME-LINT-${String(at + 1)}`, code: `ACME_LINT_${String(at + 1)}`, severity: 'error', doc: 'https://example.invalid/acme', appliesTo: ['be/src/**/*.ts'], lint: { tool: 'eslint', file } })) });
    write('ext/lint/no-thing.mjs', rule);
    write('ext/manifest.json', manifest(['no-thing.mjs']));
    assert.deepEqual(await managedFindings({ repoRoot: root, tracked, presets: PRESETS }), [], 'a declared rule of ext/lint/ is loaded by the canon factories, so it is no local rule');
    write('ext/lint/stray.mjs', rule);
    write('scripts/rules/no-thing.mjs', rule);
    assert.deepEqual((await managedFindings({ repoRoot: root, tracked, presets: PRESETS })).map((finding) => [finding.code, finding.path]).sort(), [
      ['HFS_TOOL_CONFIG_LOCAL', 'ext/lint/stray.mjs'],
      ['HFS_TOOL_CONFIG_LOCAL', 'scripts/rules/no-thing.mjs'],
    ]);
    write('ext/manifest.json', '{ not json');
    assert.ok((await managedFindings({ repoRoot: root, tracked, presets: PRESETS })).some((finding) => finding.path === 'ext/lint/no-thing.mjs'), 'an unreadable manifest declares nothing');
  });
}

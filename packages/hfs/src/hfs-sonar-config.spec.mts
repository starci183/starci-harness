// proves: HFS_SONAR_CONFIG@lite
// proves: HFS_SONAR_CONFIG@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTargets, sonarScope, writeTargets } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

const propertiesOf = (text: string) => new Map<string, string[]>(text.split('\n').filter((line: string) => /^sonar\.[\w.]+=/.test(line)).map((line: string): [string, string[]] => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).split(',')]));

// The harness gate (cli/src/core/check/sonar-properties.ts) reads a `sonar.exclusions` entry as no widening only when it names a
// build or dependency folder, or when it moves a test pattern `sonar.test.inclusions` also names out of the sources while
// `sonar.tests` covers every source folder: Sonar refuses a file indexed as both source and test, so the move is required.
for (const edition of ['lite', 'full']) {
  test(`${edition}: the render excludes only tests it analyses as tests and build or dependency folders`, () => {
    const declaration = structuredClone(APP);
    declaration.edition = edition;
    if (edition === 'lite') declaration.sides.be.connections = [
      { name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' },
    ];
    const target = renderTargets(declaration, PRESETS).find(item => item.path === 'sonar-project.properties');
    const properties = propertiesOf(target!.content);
    const tests = properties.get('sonar.test.inclusions')!;
    assert.deepEqual(properties.get('sonar.tests'), properties.get('sonar.sources'));
    assert.deepEqual(tests, sonarScope(PRESETS).tests);
    assert.ok(tests.length > 0 && tests.every(glob => !glob.endsWith('/**')));
    for (const glob of properties.get('sonar.exclusions')!) {
      assert.ok(tests.includes(glob) || /^\*\*\/(?:node_modules|\.next|dist|coverage)\/\*\*$/.test(glob), `${glob} is a test or a build or dependency folder`);
    }
    assert.ok(!properties.get('sonar.exclusions')!.includes('supabase/types/**'), 'generated row types are analysed');
    const lines = target!.content.split('\n');
    const coverage = lines.findIndex(line => line.startsWith('sonar.coverage.exclusions='));
    assert.match(lines[coverage - 1]!, /^# starci:sonar-scope begin /);
    assert.match(lines[coverage + 1]!,/^sonar\.cpd\.exclusions=/);
    assert.equal(lines[coverage + 2], '# starci:sonar-scope end');
  });
}

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
  test(`${edition}: changing a noncoverage Sonar setting fails and its render passes`, async context => {
    const { root, findings } = synced(context, edition);
    const file = path.join(root, 'sonar-project.properties');
    const rendered = fs.readFileSync(file, 'utf8');
    assert.deepEqual(await findings(), []);
    const changed = rendered.replace('sonar.sourceEncoding=UTF-8', 'sonar.sourceEncoding=UTF-16');
    assert.notEqual(changed, rendered);
    fs.writeFileSync(file, changed);
    assert.deepEqual((await findings()).map(finding => [finding.code, finding.path, finding.level]), [
      ['HFS_SONAR_CONFIG', 'sonar-project.properties', 'error'],
    ]);
    fs.writeFileSync(file, rendered);
    assert.deepEqual(await findings(), []);
  });
}

// Direct checker calls also expose these real mutation cases to the coverage proof analysis.
for (const edition of ['lite', 'full']) {
  test(`${edition}: an injected Sonar host URL is invalid and restoring its render passes`, async context => {
    const { root, tracked } = synced(context, edition);
    const input = { repoRoot: root, tracked, presets: PRESETS };
    const file = path.join(root, 'sonar-project.properties');
    const rendered = fs.readFileSync(file, 'utf8');
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), []);
    fs.writeFileSync(file, `${rendered}sonar.host.url=https://sonar.example.test\n`);
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), ['HFS_SONAR_CONFIG']);
    fs.writeFileSync(file, rendered);
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), []);
  });
}

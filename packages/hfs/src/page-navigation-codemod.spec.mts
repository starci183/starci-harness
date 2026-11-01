import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { migratePageNavigation, pageNavigationMarkdown, transformPageNavigation } from '../codemod/page-navigation.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string) => transformPageNavigation({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file: 'fe/component.tsx' });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);

test('1. PrimaryRailLayout becomes Grid kind main-rail and the old import goes', () => {
  const result = run('PrimaryRailLayout, Text', 'const A = () => <PrimaryRailLayout primary={<Text>a</Text>} rail={<Text>b</Text>} railWidth="wide" />;');
  assert.equal(result.text, `import { Text, Grid } from '${GRAMMAR}';\nconst A = () => <Grid kind="main-rail" primary={<Text>a</Text>} rail={<Text>b</Text>} railWidth="wide" />;`);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.changes.map(change => [change.code, change.from, change.to]), [['PRIMARY_RAIL_LAYOUT_GRID', 'PrimaryRailLayout', 'Grid kind="main-rail"']]);
});

test('1. FormGrid with children becomes Grid kind form, keeping columns and reusing a Grid import', () => {
  const result = run('FormGrid, Grid, Input', 'const A = () => <><FormGrid columns={1}><Input /></FormGrid><Grid kind="cards">x</Grid></>;');
  assert.equal(result.text, `import { Grid, Input } from '${GRAMMAR}';\nconst A = () => <><Grid kind="form" columns={1}><Input /></Grid><Grid kind="cards">x</Grid></>;`);
  assert.deepEqual(result.findings, []);
});

test('1. a namespace member is rewritten to the namespace Grid', () => {
  const result = transformPageNavigation({ ts, text: `import * as G from '${GRAMMAR}';\nconst A = () => <G.FormGrid><G.Input /></G.FormGrid>;`, file: 'fe/component.tsx' });
  assert.equal(result.text, `import * as G from '${GRAMMAR}';\nconst A = () => <G.Grid kind="form"><G.Input /></G.Grid>;`);
  assert.deepEqual(result.findings, []);
});

test('1. a className or a spread blocks the rewrite and is reported', () => {
  const result = run('PrimaryRailLayout, FormGrid', 'const A = () => <><PrimaryRailLayout className="x" primary={a} /><FormGrid {...p}>f</FormGrid></>;');
  assert.deepEqual(codes(result).sort(), ['FORM_GRID_GRID', 'LAYOUT_CLASS_NAME', 'PRIMARY_RAIL_LAYOUT_GRID', 'SPREAD_PROPS'].sort());
  assert.match(result.text, /<PrimaryRailLayout className="x" primary=\{a\} \/><FormGrid \{\.\.\.p\}>f<\/FormGrid>/);
});

test('1. a Grid bound to another module is a conflict, not a rewrite', () => {
  const result = transformPageNavigation({ ts, text: `import { FormGrid } from '${GRAMMAR}';\nimport { Grid } from './grid';\nconst A = () => <FormGrid>f</FormGrid>;`, file: 'fe/component.tsx' });
  assert.ok(codes(result).includes('IMPORT_NAME_CONFLICT'));
  assert.match(result.text, /<FormGrid>f<\/FormGrid>/);
});

test('2. the page parts are left for a person with the way to Page', () => {
  const result = run('PageHeader, PageContainer, Breadcrumbs, FillViewport', 'const A = () => <><PageHeader title="t" /><PageContainer>c</PageContainer></>;');
  assert.deepEqual(codes(result), ['PAGE_HEADER_LOOSE', 'PAGE_CONTAINER_LOOSE', 'BREADCRUMBS_LOOSE', 'FILL_VIEWPORT_PAGE']);
  assert.match(result.findings[0]?.reason ?? '', /header/);
  assert.match(result.text, /<PageHeader title="t" \/>/);
});

test('3. Rail, NavigationFeatureNav, Subnav, BottomNav and their types are reported', () => {
  const result = run('Rail, NavigationFeatureNav, Subnav, BottomNav, type BottomNavItem, type PageHeaderProps', 'const A = () => null;');
  assert.deepEqual(codes(result), ['RAIL_GRID', 'NAVIGATION_FEATURE_NAV_TOP_BAR', 'REMOVED_COMPONENT', 'REMOVED_COMPONENT', 'REMOVED_COMPONENT', 'PAGE_HEADER_LOOSE']);
  assert.match(result.findings[1]?.reason ?? '', /subnavigation/);
});

test('3. a removed member of a namespace import is reported on the member', () => {
  const result = transformPageNavigation({ ts, text: `import * as G from '${GRAMMAR}';\nconst A = () => <G.PageContainer><G.Text /></G.PageContainer>;`, file: 'fe/component.tsx' });
  assert.deepEqual(codes(result), ['PAGE_CONTAINER_LOOSE']);
});

test('4. a file with no grammar import, or a syntax error, is not touched', () => {
  const plain = transformPageNavigation({ ts, text: 'const A = () => <FormGrid />;', file: 'fe/component.tsx' });
  assert.deepEqual([plain.changes, plain.findings], [[], []]);
  const broken = run('FormGrid', 'const A = () => <FormGrid>;');
  assert.deepEqual(codes(broken), ['PARSE_ERROR']);
});

function fixture(t: TestContext, body = 'export const View = () => <><PrimaryRailLayout primary={a} /><PageHeader title="t" /></>;') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-navigation-codemod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'fe/apps/web/src'), { recursive: true });
  const file = path.join(root, 'fe/apps/web/src/component.tsx');
  const text = `import { PrimaryRailLayout, PageHeader } from '${GRAMMAR}';\n${body}`;
  fs.writeFileSync(file, text);
  return { root, file, text };
}

test('dry run writes nothing, --execute writes the safe rewrites, and a second run finds nothing to change', t => {
  const { root, file, text } = fixture(t);
  const preview = migratePageNavigation({ root, ts });
  assert.equal(preview.schema, 'starci/page-navigation-report@1');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(preview.filesChanged, ['fe/apps/web/src/component.tsx']);
  const written = migratePageNavigation({ root, write: true, ts });
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(migrated, /<Grid kind="main-rail" primary=\{a\} \/><PageHeader title="t" \/>/);
  assert.match(migrated, /^import \{ PageHeader, Grid \} from/);
  assert.deepEqual(written.findings.map(finding => finding.code), ['PAGE_HEADER_LOOSE']);
  const again = migratePageNavigation({ root, write: true, ts });
  assert.deepEqual([again.changes, again.filesChanged], [[], []]);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);
  assert.match(pageNavigationMarkdown(written), /PAGE_HEADER_LOOSE/);
});

test('codemodMain page-navigation exits 1 while findings remain and 0 when none do', t => {
  const { root, file } = fixture(t);
  const output: string[] = [];
  const io = { cwd: root, stdout: (value: string) => output.push(value) };
  assert.ok(CODEMODS.includes('page-navigation'));
  assert.equal(codemodMain(['page-navigation', '--json'], io), 1);
  assert.equal(JSON.parse(output.pop() ?? '{}').write, false);
  assert.match(fs.readFileSync(file, 'utf8'), /PrimaryRailLayout/);
  assert.equal(codemodMain(['page-navigation', '--execute', '--out', 'report.json', '--format', 'json'], io), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')).changes.length, 1);
  fs.writeFileSync(file, `import { Grid } from '${GRAMMAR}';\nexport const View = () => <Grid kind="cards">x</Grid>;`);
  assert.equal(codemodMain(['page-navigation'], io), 0);
  assert.match(output.pop() ?? '', /0 left for a person/);
  assert.throws(() => codemodMain(['page-navigation', '--bogus'], io), /unknown codemod option/);
  assert.throws(() => codemodMain(['page-navigation', '--out', 'x.txt'], io), /report file/);
});

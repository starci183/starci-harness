import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { GAP_ROLES, migrateSpacingRoles, spacingRolesMarkdown, transformSpacingRoles } from '../codemod/spacing-roles.mjs';
import { codemodMain, spacingRolesArguments } from '../codemod/main.mjs';

const PREFIX = `import { SurfaceCard } from '@starci/grammar/core';\n`;
const transform = (text: string) => transformSpacingRoles({ ts, text: PREFIX + text, file: 'fe/apps/web/src/components/blocks/View/index.tsx' });

test('maps the gap steps to roles as the doctrine does, gap-8 marked for review', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(GAP_ROLES).map(([step, entry]) => [step, entry.role])), { 1: 'identity', 2: 'inline', 3: 'row', 4: 'section', 6: 'region', 8: 'region' });
  assert.ok(GAP_ROLES['8']?.review);
});

test('a plain flex column or row whose only spacing is one gap becomes Stack or Cluster, bound from the file\'s own family', () => {
  const result = transform(`export const View = () => <div className="flex flex-col gap-4"><SurfaceCard label="a">x</SurfaceCard><div className="flex flex-wrap items-center gap-2" key="k"><b /></div><div className="flex items-center gap-1" /></div>;`);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.changes.map((change) => change.to), ['<Stack gap="section">', '<Cluster gap="inline">', '<Cluster gap="identity" wrap={false}>']);
  assert.match(result.text, /^import \{ SurfaceCard, Cluster, Stack \} from '@starci\/grammar\/core';/);
  assert.match(result.text, /<Stack gap="section"><SurfaceCard label="a">x<\/SurfaceCard><Cluster gap="inline" key="k"><b \/><\/Cluster><Cluster gap="identity" wrap=\{false\} \/><\/Stack>/);
  assert.deepEqual(result.counts, { gap: 3 });
  assert.equal(transformSpacingRoles({ ts, text: result.text }).text, result.text, 'a second run changes nothing');
});

test('every case that needs a person stays in the report with the role it suggests', () => {
  const input = [
    `export const A = () => <section className="flex flex-col gap-3" />;`,
    `export const B = () => <div className="flex flex-col gap-3" role="list" />;`,
    `export const C = () => <div className="grid grid-cols-2 gap-4" />;`,
    `export const D = () => <div className="flex flex-col gap-5" />;`,
    `export const E = () => <div className="flex gap-6" />;`,
    `export const F = () => <div className="px-4 py-3" />;`,
    `export const HEAD_CLASS_NAME = "shrink-0 px-4 pt-3 -mt-1 space-y-2";`,
  ].join('\n');
  const result = transform(input);
  assert.deepEqual(result.changes, []);
  assert.equal(result.text, PREFIX + input);
  const codes = result.findings.map((finding) => `${finding.utility}:${finding.code}`);
  assert.deepEqual(codes, ['gap-3:layout-element', 'gap-3:layout-element', 'gap-4:layout-element', 'gap-5:layout-element', 'gap-6:layout-element', 'px-4:layout-element', 'py-3:layout-element', 'px-4:class-string', 'pt-3:class-string', '-mt-1:class-string', 'space-y-2:class-string']);
  assert.equal(result.findings.find((finding) => finding.utility === 'gap-6')?.reason, 'a cluster never holds regions; a region gap belongs to a Stack or a Grid');
  assert.equal(result.findings.find((finding) => finding.utility === 'gap-4')?.suggestion, 'gap="section" on a Stack or Cluster');
  assert.equal(result.findings.find((finding) => finding.utility === '-mt-1')?.suggestion, "the parent's gap role");
  assert.deepEqual(result.counts, { gap: 5, padding: 4, margin: 1, space: 1 });
});

test('a file with no Grammar import is reported, never given an import it did not choose', () => {
  const result = transformSpacingRoles({ ts, text: `export const V = () => <div className="flex flex-col gap-2" />;`, file: 'fe/x.tsx' });
  assert.deepEqual(result.changes, []);
  assert.equal(result.findings[0]?.reason, 'the file imports no Grammar family to bind the primitive from');
});

test('the dry run writes nothing and reports; --execute writes only the rewrites', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spacing-roles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fe', 'apps', 'web', 'src', 'View.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = `${PREFIX}export const V = () => <div className="flex flex-col gap-3"><div className="p-4" /></div>;\n`;
  fs.writeFileSync(file, original);
  const dry = migrateSpacingRoles({ root, ts });
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(dry.filesChanged, ['fe/apps/web/src/View.tsx']);
  assert.equal(dry.changes.length, 1);
  assert.equal(dry.findings.length, 1);
  assert.match(spacingRolesMarkdown(dry), /Dry run: 1 rewrites in 1 files of 1; 1 utilities left for a person\./);
  const out: string[] = [];
  assert.equal(codemodMain(['spacing-roles', '--execute', '--json'], { cwd: root, stdout: (text) => out.push(text) }), 1);
  assert.match(fs.readFileSync(file, 'utf8'), /<Stack gap="row"><div className="p-4" \/><\/Stack>/);
  assert.equal(JSON.parse(out.join('')).schema, 'starci/spacing-roles-codemod@1');
});

test('the arguments refuse what the verb does not take', () => {
  assert.deepEqual(spacingRolesArguments([]), { write: false, format: 'markdown' });
  assert.deepEqual(spacingRolesArguments(['--format', 'json', '--out', 'r.json']), { write: false, format: 'json', out: 'r.json' });
  assert.throws(() => spacingRolesArguments(['--format=xml']), /json or markdown/);
  assert.throws(() => spacingRolesArguments(['--nope']), /unknown codemod option/);
  assert.throws(() => codemodMain(['other'], { cwd: '.', stdout: () => undefined }), /button-intent or spacing-roles/);
});

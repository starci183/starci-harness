import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { migrateSectionFrame, sectionFrameMarkdown, transformSectionFrame } from '../codemod/section-frame.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string) => transformSectionFrame({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file: 'fe/component.tsx' });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);

test('1. Region with a SectionHeader first in it becomes one Section; the head props move, the label and the id of the head go', () => {
  const result = run('Region, SectionHeader, Text', 'const A = () => (\n  <Region labelledBy={id} spacing="spaced">\n    <SectionHeader id={id} level={3} title={t.title} description={t.fact} count={2} />\n    <Text>x</Text>\n  </Region>\n);');
  assert.equal(result.text, `import { Text, Section } from '${GRAMMAR}';\nconst A = () => (\n  <Section title={t.title} description={t.fact} count={2} headingLevel={3}>\n    <Text>x</Text>\n  </Section>\n);`);
  assert.deepEqual(result.findings, []);
});

test('1. a head of rank 2 adds no headingLevel, and its anchor id moves to the Section when the Region had no id', () => {
  const result = run('Region, SectionHeader', 'const A = () => <Region label="Main"><SectionHeader id="top" level={2} title="Main" action={a} meta="m" isSkeleton /><b /></Region>;');
  assert.equal(result.text, `import { Section } from '${GRAMMAR}';\nconst A = () => <Section title="Main" action={a} meta="m" isSkeleton id="top"><b /></Section>;`);
});

test('1. a Region whose head is wrapped, carries other props or spreads is reported and kept', () => {
  const wrapped = run('Region, SectionHeader', 'const A = () => <Region label="a"><div><SectionHeader title="a" /></div></Region>;');
  assert.deepEqual(codes(wrapped), ['SECTION_NEW_VISIBLE_TITLE', 'SECTION_HEADER_FREE']);
  const props = run('Region', 'const A = () => <Region label="a" className="x"><b /></Region>;');
  assert.deepEqual(codes(props), ['REGION_PROPS']);
  assert.match(props.text, /<Region label="a" className="x">/);
  const spreadRegion = run('Region', 'const A = () => <Region {...p}><b /></Region>;');
  assert.deepEqual(codes(spreadRegion), ['SPREAD_PROPS']);
});

test('2. a head with an eyebrow, a context-intro, rank 1 or a className is reported and the Region is kept', () => {
  for (const attribute of ['eyebrow="E"', 'composition="context-intro"', 'level={1}', 'className="c"', 'level={n}']) {
    const result = run('Region, SectionHeader', `const A = () => <Region label="a"><SectionHeader title="a" ${attribute} /><b /></Region>;`);
    assert.deepEqual(codes(result), ['SECTION_HEADER_KEPT'], attribute);
    assert.match(result.text, /<Region label="a"><SectionHeader/, attribute);
  }
});

test('3. a Region with only a label becomes a Section with that title, and says the heading is new', () => {
  const result = run('Region, Text', 'const A = () => <Region label={labels.title} spacing="spaced"><Text>x</Text></Region>;');
  assert.equal(result.text, `import { Text, Section } from '${GRAMMAR}';\nconst A = () => <Section title={labels.title}><Text>x</Text></Section>;`);
  assert.deepEqual(codes(result), ['SECTION_NEW_VISIBLE_TITLE']);
  const labelled = run('Region', 'const A = () => <Region labelledBy={h}><b /></Region>;');
  assert.deepEqual(codes(labelled), ['REGION_WITHOUT_HEAD']);
});

test('4. a SectionHeader leading a plain wrapper makes that wrapper a Section; any other place is reported', () => {
  const wrapped = run('SectionHeader', 'const A = () => <div>\n  <SectionHeader title="T" level={4} />\n  <b />\n</div>;');
  assert.equal(wrapped.text, `import { Section } from '${GRAMMAR}';\nconst A = () => <Section title="T" headingLevel={4}>\n  <b />\n</Section>;`);
  const fragment = run('SectionHeader', 'const A = () => <><SectionHeader title="T" /><b /></>;');
  assert.equal(fragment.text, `import { Section } from '${GRAMMAR}';\nconst A = () => <Section title="T"><b /></Section>;`);
  const styled = run('SectionHeader', 'const A = () => <div className="x"><SectionHeader title="T" /><b /></div>;');
  assert.deepEqual(codes(styled), ['SECTION_HEADER_FREE']);
  const alone = run('SectionHeader', 'const A = () => <SectionHeader title="T" />;');
  assert.deepEqual(codes(alone), ['SECTION_HEADER_FREE']);
  const last = run('SectionHeader', 'const A = () => <div><b /><SectionHeader title="T" /></div>;');
  assert.deepEqual(codes(last), ['SECTION_HEADER_FREE']);
});

test('5. the placement providers become fragments and their import goes', () => {
  const result = run('CollectionItem, ItemActions, ToolbarActions, Button', 'const A = () => <><CollectionItem><Button /></CollectionItem><ItemActions><Button /></ItemActions><ToolbarActions><Button /></ToolbarActions></>;');
  assert.equal(result.text, `import { Button } from '${GRAMMAR}';\nconst A = () => <><><Button /></><><Button /></><><Button /></></>;`);
  assert.deepEqual(result.findings, []);
});

test('6. List, ListItem, LeadingNumber, Label and their types are reported, never rewritten', () => {
  const result = run('List, ListItem, LeadingNumber, Label, type RegionProps', 'const A = () => <List label="m"><ListItem><LeadingNumber position={1} />x</ListItem><Label>l</Label></List>;');
  assert.deepEqual(codes(result).sort(), ['LABEL_REMOVED', 'LEADING_NUMBER_REMOVED', 'LIST_REMOVED', 'LIST_REMOVED', 'SECTION_TYPES']);
  assert.match(result.text, /<List label="m"><ListItem>/);
});

test('7. Text weight becomes isStrong; normal is dropped; a dynamic weight is reported', () => {
  const result = run('Text', 'const A = () => <><Text as="span" weight="medium">a</Text><Text as="span" weight="semibold" size="sm">b</Text><Text as="span" weight="normal">c</Text><Text as="span" weight={w}>d</Text></>;');
  assert.equal(result.text, `import { Text } from '${GRAMMAR}';\nconst A = () => <><Text as="span" isStrong>a</Text><Text as="span" isStrong size="sm">b</Text><Text as="span">c</Text><Text as="span" weight={w}>d</Text></>;`);
  assert.deepEqual(codes(result), ['TEXT_WEIGHT_DYNAMIC']);
});

test('7. the removed Text values are reported and kept', () => {
  const result = run('Text', 'const A = () => <><Text size="metric-lead">1</Text><Text tone="accent">2</Text><Text parentEmphasis="accent-soft">3</Text></>;');
  assert.deepEqual(codes(result), ['TEXT_METRIC_LEAD', 'TEXT_TONE_ACCENT', 'TEXT_PARENT_EMPHASIS']);
});

test('8. a strong block Text that heads a group is a heading fake and is reported after it becomes isStrong', () => {
  const fake = run('Text, Button', 'const A = () => <div><Text weight="semibold">Group</Text><Button /><Button /></div>;');
  assert.match(fake.text, /<Text isStrong>Group<\/Text>/);
  assert.deepEqual(codes(fake), ['TEXT_HEADING_FAKE']);
  const inline = run('Text, Button', 'const A = () => <div><Text as="span" weight="semibold">Group</Text><Button /></div>;');
  assert.deepEqual(inline.findings, []);
  const value = run('Text', 'const A = () => <div><Text>name</Text><Text weight="medium">value</Text></div>;');
  assert.deepEqual(value.findings, []);
});

test('names resolve through an alias and a namespace import', () => {
  const result = transformSectionFrame({ ts, text: `import { Region as R, SectionHeader as H } from '${GRAMMAR}';\nimport * as G from '@starci/grammar/offset-pop';\nconst A = () => <><R label="a"><H title="a" /><b /></R><G.Text weight="medium">t</G.Text></>;` });
  assert.match(result.text, /<G\.Text isStrong>t<\/G\.Text>/);
  assert.match(result.text, /<G\.Section title="a"><b \/><\/G\.Section>|<Section title="a"><b \/><\/Section>/);
});

test('same names from another module are untouched', () => {
  const text = `import { Region, SectionHeader, Text, List } from 'another-ui';\nconst A = () => <><Region label="a"><SectionHeader title="a" /></Region><Text weight="medium">t</Text><List /></>;`;
  const result = transformSectionFrame({ ts, text });
  assert.equal(result.text, text);
  assert.deepEqual([result.changes, result.findings], [[], []]);
});

test('a parse error keeps the file and reports PARSE_ERROR', () => {
  const result = run('Region', 'const A = () => <Region>');
  assert.deepEqual(codes(result), ['PARSE_ERROR']);
});

function fixture(t: TestContext, body = 'export const View = () => <Region labelledBy={h}><SectionHeader id={h} title="T" /><Text weight="medium">x</Text><List /></Region>;') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'section-frame-codemod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'fe/apps/web/src'), { recursive: true });
  const file = path.join(root, 'fe/apps/web/src/component.tsx');
  const text = `import { Region, SectionHeader, Text, List } from '${GRAMMAR}';\n${body}`;
  fs.writeFileSync(file, text);
  return { root, file, text };
}

test('dry run writes nothing, --execute writes the safe rewrites, and a second run finds nothing to change', t => {
  const { root, file, text } = fixture(t);
  const preview = migrateSectionFrame({ root, ts });
  assert.equal(preview.schema, 'starci/section-frame-report@1');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(preview.filesChanged, ['fe/apps/web/src/component.tsx']);
  const written = migrateSectionFrame({ root, write: true, ts });
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(migrated, /<Section title="T"><Text isStrong>x<\/Text><List \/><\/Section>/);
  assert.match(migrated, /^import \{ Text, List, Section \} from/);
  assert.deepEqual(written.findings.map(finding => finding.code), ['LIST_REMOVED']);
  const again = migrateSectionFrame({ root, write: true, ts });
  assert.deepEqual([again.changes, again.filesChanged], [[], []]);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);
  assert.match(sectionFrameMarkdown(written), /LIST_REMOVED/);
});

test('codemodMain section-frame exits 1 while findings remain and 0 when none do', t => {
  const { root, file } = fixture(t);
  const output: string[] = [];
  const io = { cwd: root, stdout: (value: string) => output.push(value) };
  assert.ok(CODEMODS.includes('section-frame'));
  assert.equal(codemodMain(['section-frame', '--json'], io), 1);
  assert.equal(JSON.parse(output.pop() ?? '{}').write, false);
  assert.match(fs.readFileSync(file, 'utf8'), /Region/);
  fs.writeFileSync(file, `import { Region, SectionHeader } from '${GRAMMAR}';\nexport const View = () => <Region labelledBy={h}><SectionHeader id={h} title="T" /><b /></Region>;`);
  assert.equal(codemodMain(['section-frame', '--execute'], io), 0);
  assert.match(fs.readFileSync(file, 'utf8'), /<Section title="T"><b \/><\/Section>/);
  assert.match(output.pop() ?? '', /0 left for a person/);
  assert.throws(() => codemodMain(['section-frame', '--bogus'], io), /unknown codemod option/);
});

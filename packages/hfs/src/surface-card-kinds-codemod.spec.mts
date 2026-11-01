import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { migrateSurfaceCardKinds, surfaceCardKindsMarkdown, transformSurfaceCardKinds } from '../codemod/surface-card-kinds.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string) => transformSurfaceCardKinds({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file: 'fe/component.tsx' });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);

test('1. a list card of direct ListRows becomes kind="list" with items, and the old imports go', () => {
  const result = run('SurfaceListCard, ListRow', 'const A = () => <SurfaceListCard label="Rules" depth="nested" isLoading={x}><ListRow key="a" title="One" description="d" state="negative" /><ListRow key="b" title={t} /></SurfaceListCard>;');
  assert.equal(result.text, `import { SurfaceCard } from '${GRAMMAR}';\nconst A = () => <SurfaceCard kind="list" label="Rules" isSkeleton={x} empty={null} items={[{ id: "a", title: "One", description: "d", state: "negative" }, { id: "b", title: t }]} />;`);
  assert.deepEqual(codes(result), ['LIST_EMPTY']);
});

test('1. an existing SurfaceCard import is reused and an empty prop is kept', () => {
  const result = run('SurfaceCard, SurfaceListCard, ListRow', 'const A = () => <SurfaceListCard label="Rules" empty={<b />}>{rules.map((rule) => <ListRow key={rule.id} title={rule.title} verdict="success" />)}</SurfaceListCard>;');
  assert.equal(result.text, `import { SurfaceCard } from '${GRAMMAR}';\nconst A = () => <SurfaceCard kind="list" label="Rules" empty={<b />} items={rules.map((rule) => ({ id: rule.id, title: rule.title, verdict: "success" }))} />;`);
  assert.deepEqual(result.findings, []);
});

test('1. StaticStateRow items become list items with label as title', () => {
  const result = run('SurfaceListCard, StaticStateRow', 'const A = () => <SurfaceListCard ariaLabel="Checks"><StaticStateRow item={{ id: "a", label: "Email", state: "affirmative" }} /></SurfaceListCard>;');
  assert.match(result.text, /items=\{\[\{ id: "a", title: "Email", state: "affirmative" \}\]\}/);
});

test('1. a ListRow with leading, badges, actions or children keeps its source and is reported', () => {
  const result = run('SurfaceListCard, ListRow', 'const A = () => <SurfaceListCard label="Rules"><ListRow key="a" title="One" badges={b} /></SurfaceListCard>;');
  assert.deepEqual(codes(result).sort(), ['LIST_ROW_SHAPE', 'REMOVED_COMPONENT', 'REMOVED_COMPONENT']);
  assert.match(result.text, /<SurfaceListCard label="Rules"><ListRow key="a" title="One" badges=\{b\} \/><\/SurfaceListCard>/);
  const children = run('SurfaceListCard, ListRow', 'const A = () => <SurfaceListCard label="Rules"><ListRow key="a" title="One"><Editor /></ListRow></SurfaceListCard>;');
  assert.ok(codes(children).includes('LIST_ROW_SHAPE'));
});

test('2. a stat strip alone in a card becomes kind="figures" and description becomes value', () => {
  const result = run('SurfaceCard, DescriptionList', 'const A = () => <SurfaceCard ariaLabel="Usage" composition="joined"><DescriptionList layout="stat-strip" isLoading={l} items={[{ id: "a", term: "Revenue", description: "1,200", unit: "usd" }]} /></SurfaceCard>;');
  assert.equal(result.findings.some(finding => finding.code === 'FIGURES_BY_HAND'), true, 'composition="joined" with a strip is left for a person');
  const plain = run('SurfaceCard, DescriptionList', 'const A = () => <SurfaceCard ariaLabel="Usage"><DescriptionList layout="stat-strip" isLoading={l} items={[{ id: "a", term: "Revenue", description: "1,200", unit: "usd" }]} /></SurfaceCard>;');
  assert.equal(plain.text, `import { SurfaceCard } from '${GRAMMAR}';\nconst A = () => <SurfaceCard kind="figures" ariaLabel="Usage" isSkeleton={l} items={[{ id: "a", term: "Revenue", value: "1,200", unit: "usd" }]} />;`.replace(`import { SurfaceCard } from`, `import { SurfaceCard, DescriptionList } from`));
});

test('3. default-valued dropped props are removed; real ones are reported', () => {
  const result = run('SurfaceCard', 'const A = () => <><SurfaceCard label="a" composition="single" placement="floating" height="auto">x</SurfaceCard><SurfaceCard label="b" placement="panel" isScrollable>y</SurfaceCard></>;');
  assert.match(result.text, /<SurfaceCard label="a">x<\/SurfaceCard>/);
  assert.deepEqual(codes(result), ['PANEL_CARD', 'CARD_SCROLL']);
});

test('4. an accordion card, a nested card and labelled cards repeated in a grid are reported and not rewritten', () => {
  const result = run('SurfaceCard, SurfaceAccordionCard, Grid', 'const A = () => <><SurfaceAccordionCard label="a" items={i} /><SurfaceCard label="o"><SurfaceCard label="i">x</SurfaceCard></SurfaceCard><Grid kind="cards"><SurfaceCard label="a" /><SurfaceCard label="b" /></Grid></>;');
  assert.deepEqual(codes(result).sort(), ['ACCORDION_BY_HAND', 'LABEL_IN_GRID', 'NESTED_CARD', 'REMOVED_COMPONENT']);
});

test('5. a file without a grammar import, and a parse error, are left alone', () => {
  assert.deepEqual(transformSurfaceCardKinds({ ts, text: 'const A = () => <SurfaceListCard />;', file: 'fe/a.tsx' }).changes, []);
  assert.deepEqual(codes(transformSurfaceCardKinds({ ts, text: `import { SurfaceCard } from '${GRAMMAR}'; const A = () => <SurfaceCard`, file: 'fe/a.tsx' })), ['PARSE_ERROR']);
});

test('6. the app run is a dry run by default, --execute writes, and findings exit 1', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-card-kinds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fe', 'component.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = `import { SurfaceListCard, ListRow } from '${GRAMMAR}';\nexport const A = () => <SurfaceListCard label="Rules" empty={null}><ListRow key="a" title="One" /></SurfaceListCard>;\n`;
  fs.writeFileSync(file, original);
  const dry = migrateSurfaceCardKinds({ root, ts });
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(dry.filesChanged, ['fe/component.tsx']);
  assert.match(surfaceCardKindsMarkdown(dry), /1 rewrites, 0 left for a person/);
  assert.ok(CODEMODS.includes('surface-card-kinds'));
  let out = '';
  assert.equal(codemodMain(['surface-card-kinds', '--execute'], { cwd: root, stdout: text => { out += text; } }), 0);
  assert.match(fs.readFileSync(file, 'utf8'), /<SurfaceCard kind="list" label="Rules" empty=\{null\} items=\{\[\{ id: "a", title: "One" \}\]\} \/>/);
  assert.match(out, /surface-card-kinds/);
});

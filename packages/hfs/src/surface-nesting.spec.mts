// proves: FE_SURFACE_NESTING@lite FE_SURFACE_NESTING@full
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { checkSurfaceNesting } from '../runtime/scripts/hfs/architecture/surface-nesting.mjs';
import { checkRenderPropAcrossServer } from '../runtime/scripts/hfs/architecture/render-prop-across-server.mjs';
import type { HfsGraph } from '../runtime/scripts/hfs/architecture/hfs-graph.mjs';

/** A program of source texts by path; a relative import resolves to `X.tsx` or `X/index.tsx` under the importing file's folder. */
function program(sources: Record<string, string>): { graph: HfsGraph; context: { ts: typeof ts } } {
  const files = new Map<string, { rel: string; slot: string | null; sourceFile: ts.SourceFile }>();
  for (const [rel, text] of Object.entries(sources)) files.set(rel, { rel, slot: null, sourceFile: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });
  const edges: { from: string; to: string; specifier: string }[] = [];
  for (const [from, { sourceFile }] of files) {
    const dir = from.split('/').slice(0, -1).join('/');
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        const specifier = node.moduleSpecifier.text;
        const base = `${dir}/${specifier.slice(2)}`;
        const to = [`${base}.tsx`, `${base}/index.tsx`, `${base}.ts`].find((candidate) => files.has(candidate));
        if (to) edges.push({ from, to, specifier });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  // reason: the check reads graph.files (rel, sourceFile) and graph.edges (from, to, specifier) only; the full graph is built by the machine from a repository.
  return { graph: { files, edges } as unknown as HfsGraph, context: { ts } };
}

const kinds = (sources: Record<string, string>): string[] => checkSurfaceNesting(program(sources)).violations.map((v) => `${String(v['kind'])}@${String(v.path)}`).sort();
const G = "import { SurfaceCard, DataTable, Dialog, Pane, PaneGrid, Page, Grid, Section, Heading } from '@starci/grammar/core';\n";

test('a card drawn in a card across files is found at the inner card, with the file of each', () => {
  const result = checkSurfaceNesting(program({
    'a/Shell.tsx': `${G}export const Shell = ({ children }) => <SurfaceCard label="Outer">{children}</SurfaceCard>;`,
    'a/Inner.tsx': `${G}export const Inner = () => <SurfaceCard label="Inner" />;`,
    'a/Screen.tsx': `${G}import { Shell } from './Shell';\nimport { Inner } from './Inner';\nexport const Screen = () => <Shell><Inner /></Shell>;`,
  }));
  assert.deepEqual(result.violations.map((v) => [v['kind'], v.path, v['crossFile']]), [['card-in-card', 'a/Inner.tsx', true]]);
});

test('a component that never places children does not draw them, and a card beside a card is fine', () => {
  assert.deepEqual(kinds({
    'a/Shell.tsx': `${G}export const Shell = ({ children }) => <SurfaceCard label="Outer" />;`,
    'a/Inner.tsx': `${G}export const Inner = () => <SurfaceCard label="Inner" />;`,
    'a/Screen.tsx': `${G}import { Shell } from './Shell';\nimport { Inner } from './Inner';\nexport const Screen = () => <><Shell><Inner /></Shell><Inner /></>;`,
  }), []);
});

test('imports resolve through a barrel with a star re-export, and children through the props object', () => {
  assert.deepEqual(kinds({
    'a/Shell/index.tsx': `${G}export const Shell = (props) => <SurfaceCard label="Outer">{props.children}</SurfaceCard>;`,
    'a/Inner/Inner.tsx': `${G}export const Inner = () => <SurfaceCard label="Inner" />;`,
    'a/Inner/index.tsx': `export * from './Inner';`,
    'a/Screen.tsx': `${G}import { Shell } from './Shell';\nimport { Inner } from './Inner';\nexport const Screen = () => <Shell><Inner /></Shell>;`,
  }), ['card-in-card@a/Inner/Inner.tsx']);
});

test('a slot prop is drawn where the component places it', () => {
  assert.deepEqual(kinds({
    'a/Frame.tsx': `${G}export const Frame = ({ aside }) => <SurfaceCard label="Outer">{aside}</SurfaceCard>;`,
    'a/Screen.tsx': `${G}import { Frame } from './Frame';\nexport const Screen = () => <Frame aside={<SurfaceCard label="Inner" />} />;`,
  }), ['card-in-card@a/Screen.tsx']);
});

test('a card in Pane surface or in an overlay is found, a card in a plain Pane is not', () => {
  assert.deepEqual(kinds({
    'a/Row.tsx': `${G}export const Row = () => <SurfaceCard label="x" />;`,
    'a/Surfaced.tsx': `${G}import { Row } from './Row';\nexport const Surfaced = () => <Pane area="a" surface><Row /></Pane>;`,
    'a/Plain.tsx': `${G}import { Row } from './Row';\nexport const Plain = () => <Pane area="a"><Row /></Pane>;`,
    'a/Modal.tsx': `${G}import { Row } from './Row';\nexport const Modal = () => <Dialog trigger={null}><Row /></Dialog>;`,
  }), ['card-in-overlay@a/Row.tsx', 'card-in-pane@a/Row.tsx']);
});

test('a DataTable drawn in a card through a component is found', () => {
  assert.deepEqual(kinds({
    'a/Table.tsx': `${G}export const Table = () => <DataTable />;`,
    'a/Screen.tsx': `${G}import { Table } from './Table';\nexport const Screen = () => <SurfaceCard label="x"><Table /></SurfaceCard>;`,
  }), ['table-in-card@a/Table.tsx']);
});

test('a PaneGrid is found in a Page of another chrome, and not in Page chrome panes, a Pane or a spread Page', () => {
  const grid = { 'a/Grid.tsx': `${G}export const Panes = () => <PaneGrid areas={{}} />;` };
  const page = (name: string, jsx: string): Record<string, string> => ({ ...grid, [`a/${name}.tsx`]: `${G}import { Panes } from './Grid';
export const ${name} = (props) => ${jsx};` });
  assert.deepEqual(kinds(page('Bad', '<Page chrome="bleed"><Panes /></Page>')), ['grid-outside-panes@a/Grid.tsx']);
  assert.deepEqual(kinds(page('Good', '<Page chrome="panes"><Panes /></Page>')), []);
  assert.deepEqual(kinds(page('Open', '<Page {...props}><Panes /></Page>')), []);
  assert.deepEqual(kinds(page('Nested', '<Pane area="a"><Panes /></Pane>')), []);
});

test('a PaneGrid in a card, or in a Page with no chrome, is found', () => {
  assert.deepEqual(kinds({
    'a/Grid.tsx': `${G}export const Panes = () => <PaneGrid areas={{}} />;`,
    'a/InCard.tsx': `${G}import { Panes } from './Grid';\nexport const InCard = () => <SurfaceCard label="x"><Panes /></SurfaceCard>;`,
  }), ['grid-outside-panes@a/Grid.tsx']);
  assert.deepEqual(kinds({
    'a/Grid.tsx': `${G}export const Panes = () => <PaneGrid areas={{}} />;`,
    'a/Standard.tsx': `${G}import { Panes } from './Grid';\nexport const Standard = () => <Page header={null}><Panes /></Page>;`,
  }), ['grid-outside-panes@a/Grid.tsx']);
});

test('a Section or a Heading with one card is found, through one wrapper, and several cards under it are not', () => {
  assert.deepEqual(kinds({
    'a/Wrapped.tsx': `${G}export const Wrapped = () => <SurfaceCard label="x" />;`,
    'a/One.tsx': `${G}import { Wrapped } from './Wrapped';\nexport const One = () => <Section title="T"><Wrapped /></Section>;`,
    'a/Two.tsx': `${G}import { Wrapped } from './Wrapped';\nexport const Two = () => <><Heading>T</Heading><Wrapped /><Wrapped /></>;`,
    'a/Three.tsx': `${G}import { Wrapped } from './Wrapped';
export const Three = () => <><Heading>T</Heading><Wrapped /></>;`,
    'a/List.tsx': `${G}import { Wrapped } from './Wrapped';
export const List = () => <Section kind="list" title="T"><Wrapped /></Section>;`,
  }), ['heading-over-card@a/One.tsx', 'heading-over-card@a/Three.tsx']);
});

test('a labelled card repeated by a map in a peer-card Grid is found, an unlabelled tile is not', () => {
  assert.deepEqual(kinds({
    'a/Tile.tsx': `${G}export const Tile = ({ item }) => <SurfaceCard label={item.name} />;`,
    'a/Plain.tsx': `${G}export const Plain = ({ item }) => <SurfaceCard kind="tile" />;`,
    'a/Labelled.tsx': `${G}import { Tile } from './Tile';\nexport const Labelled = ({ items }) => <Grid kind="cards">{items.map((item) => <Tile key={item.id} item={item} />)}</Grid>;`,
    'a/Tiles.tsx': `${G}import { Plain } from './Plain';\nexport const Tiles = ({ items }) => <Grid kind="cards">{items.map((item) => <Plain key={item.id} item={item} />)}</Grid>;`,
  }), ['label-in-grid@a/Labelled.tsx']);
});

test('labelled day regions belong to the nearest semantic layout, while peer-card grids still refuse them', () => {
  const day = { 'a/Day.tsx': `${G}export const Day = ({ item }) => <SurfaceCard label={item.label} />;` };
  const screen = (layout: string) => ({ ...day, 'a/Week.tsx': `${G}import { Day } from './Day';\nexport const Week = ({ days }) => ${layout};` });
  for (const kind of ['week', 'week-summary']) {
    assert.deepEqual(kinds(screen(`<Grid kind="${kind}" label="Days">{days.map((day) => <Day key={day.id} item={day} />)}</Grid>`)), []);
  }
  assert.deepEqual(kinds(screen('<Grid kind="cards">{days.map((day) => <Day key={day.id} item={day} />)}</Grid>')), ['label-in-grid@a/Week.tsx']);
  assert.deepEqual(kinds(screen('<Grid kind="cards"><Grid kind="week" label="Days">{days.map((day) => <Day key={day.id} item={day} />)}</Grid></Grid>')), []);
});

test('a render cycle ends and an unresolved component is left alone', () => {
  const found = kinds({
    'a/Loop.tsx': `${G}export const A = ({ children }) => <SurfaceCard label="a"><B>{children}</B></SurfaceCard>;\nexport const B = ({ children }) => <A>{children}</A>;`,
    'a/Other.tsx': `${G}import { Unknown } from 'elsewhere';\nexport const Other = () => <SurfaceCard label="x"><Unknown /></SurfaceCard>;`,
  });
  assert.ok(!found.some((entry) => entry.endsWith('a/Other.tsx')));
});

test('R361: a function prop from a server file into a client component is found; data, a client file and a server action are not', () => {
  const client = "'use client';\nexport const Picker = (props) => <button onClick={props.onPick} />;";
  const found = (page: string) => checkRenderPropAcrossServer(program({ 'a/Picker.tsx': client, 'a/Page.tsx': page })).violations.map((v) => String(v.path));
  const head = "import { Picker } from './Picker';\n";
  assert.deepEqual(found(head + 'export const Page = () => <Picker onPick={() => 1} />;'), ['a/Page.tsx']);
  assert.deepEqual(found(head + 'export const Page = () => <Picker render={function () { return 1; }} />;'), ['a/Page.tsx']);
  assert.deepEqual(found(head + 'export const Page = () => <Picker label="x" items={[1]} />;'), []);
  assert.deepEqual(found("'use client';\n" + head + 'export const Page = () => <Picker onPick={() => 1} />;'), []);
  assert.deepEqual(found(head + "export const Page = () => <Picker onPick={async () => { 'use server'; return 1; }} />;"), []);
});

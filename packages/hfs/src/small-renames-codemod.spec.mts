import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { migrateSmallRenames, smallRenamesMarkdown, transformSmallRenames } from '../codemod/small-renames.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string) => transformSmallRenames({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file: 'fe/component.tsx' });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);

test('1. ChatBubble and its types are renamed through the import, tags and type names', () => {
  const result = run('ChatBubble, type ChatBubbleProps, ChatBubbleSide', 'const side: ChatBubbleSide = "in"; const A = (props: ChatBubbleProps) => <ChatBubble side={side}>Hi</ChatBubble>;');
  assert.equal(result.text, `import { MessageBubble, type MessageBubbleProps, MessageBubbleSide } from '${GRAMMAR}';\nconst side: MessageBubbleSide = "in"; const A = (props: MessageBubbleProps) => <MessageBubble side={side}>Hi</MessageBubble>;`);
  assert.deepEqual(result.findings, []);
});

test('1. ChatBubbleSkeletons becomes a skeleton MessageBubble with rows, and the old import goes', () => {
  const counted = run('ChatBubbleSkeletons', 'const A = () => <ChatBubbleSkeletons count={4} hasAvatar />;');
  assert.equal(counted.text, `import { MessageBubble } from '${GRAMMAR}';\nconst A = () => <MessageBubble isSkeleton rows={4} hasAvatar />;`);
  const bare = run('ChatBubbleSkeletons, ChatBubble', 'const A = () => <><ChatBubbleSkeletons /><ChatBubble isSkeleton avatar={x} /></>;');
  assert.equal(bare.text, `import { MessageBubble } from '${GRAMMAR}';\nconst A = () => <><MessageBubble isSkeleton rows={3} /><MessageBubble isSkeleton hasAvatar /></>;`);
});

test('1. a skeleton bubble with children and ChatBubbleSkeletonsProps are reported', () => {
  const result = run('ChatBubble, ChatBubbleSkeletonsProps', 'const A = () => <ChatBubble isSkeleton>text</ChatBubble>;');
  assert.deepEqual(codes(result).sort(), ['CHAT_BUBBLE_SKELETONS_PROPS', 'CHAT_BUBBLE_SKELETON_CHILDREN']);
  assert.match(result.text, /<MessageBubble isSkeleton>text<\/MessageBubble>/);
});

test('2. StatusDot with children becomes Badge isDot; the dot-only form stays', () => {
  const result = run('StatusDot', 'const A = () => <><StatusDot tone="success" size="sm" aria-label="ok" echo isSkeleton>Online</StatusDot><StatusDot aria-label="ok" tone="danger" /></>;');
  assert.equal(result.text, `import { StatusDot, Badge } from '${GRAMMAR}';\nconst A = () => <><Badge isDot tone="success" isLive isSkeleton>Online</Badge><StatusDot aria-label="ok" tone="danger" /></>;`);
  const all = run('StatusDot', 'const A = () => <StatusDot tone="success">Online</StatusDot>;');
  assert.equal(all.text, `import { Badge } from '${GRAMMAR}';\nconst A = () => <Badge isDot tone="success">Online</Badge>;`);
});

test('2. StatusDot with a spread or a children attribute is reported', () => {
  const result = run('StatusDot', 'const A = () => <><StatusDot {...p}>Online</StatusDot><StatusDot children={x} /></>;');
  assert.deepEqual(codes(result), ['SPREAD_PROPS', 'STATUS_DOT_CHILDREN']);
  assert.match(result.text, /<StatusDot \{\.\.\.p\}>Online<\/StatusDot>/);
});

test('3. ConnectionStatus becomes a Badge dot; lost is not live', () => {
  const result = run('ConnectionStatus', 'const A = () => <><ConnectionStatus state="live" label={x} /><ConnectionStatus state="reconnecting" label="Retry" /><ConnectionStatus state="lost" label={y} className="c" /></>;');
  assert.equal(result.text, `import { Badge } from '${GRAMMAR}';\nconst A = () => <><Badge isDot tone="success" isLive>{x}</Badge><Badge isDot tone="warning" isLive>Retry</Badge><Badge isDot tone="danger" className="c">{y}</Badge></>;`);
});

test('3. a non-literal ConnectionStatus state and its types are reported', () => {
  const result = run('ConnectionStatus, type ConnectionState, ConnectionStatusProps', 'const A = () => <ConnectionStatus state={s} label="x" />;');
  assert.deepEqual(codes(result).sort(), ['CONNECTION_STATUS_STATE', 'CONNECTION_STATUS_TYPES', 'CONNECTION_STATUS_TYPES']);
});

test('4. CloseButton becomes IconButton intent dismiss and reuses an existing IconButton import', () => {
  const result = run('CloseButton, IconButton', 'const A = () => <><CloseButton label="Close" size="sm" onPress={f} isDisabled /><IconButton label="x" source={s} /></>;');
  assert.equal(result.text, `import { IconButton } from '${GRAMMAR}';\nconst A = () => <><IconButton intent="dismiss" label="Close" size="sm" onPress={f} isDisabled /><IconButton label="x" source={s} /></>;`);
});

test('5. TextAction with href becomes Link; target blank becomes kind external', () => {
  const result = run('TextAction', 'const A = () => <><TextAction href="/a" isCurrent>Docs</TextAction><TextAction href="https://x.dev" target="_blank" rel="noreferrer">Out</TextAction><TextAction onPress={f}>Cmd</TextAction></>;');
  assert.equal(result.text, `import { TextAction, Link } from '${GRAMMAR}';\nconst A = () => <><Link href="/a" isCurrent>Docs</Link><Link href="https://x.dev" kind="external">Out</Link><TextAction onPress={f}>Cmd</TextAction></>;`);
  assert.deepEqual(result.findings, []);
});

test('5. TextAction with other props, non-string children, a spread or a dynamic href is reported', () => {
  const result = run('TextAction', 'const A = () => <><TextAction href="/a" size="sm">A</TextAction><TextAction href="/b"><b>B</b></TextAction><TextAction href="/c" {...p}>C</TextAction><TextAction href={url}>D</TextAction></>;');
  assert.deepEqual(codes(result), ['TEXT_ACTION_LINK_PROPS', 'TEXT_ACTION_LINK_PROPS', 'SPREAD_PROPS', 'TEXT_ACTION_DYNAMIC_HREF']);
  assert.equal(result.changes.length, 0);
});

test('6. EmptyNotice loses actionVariant', () => {
  const result = run('EmptyNotice', 'const A = () => <EmptyNotice title="t" actionVariant="primary" />;');
  assert.match(result.text, /<EmptyNotice title="t" \/>/);
});

test('7. DragItem leadingColor is reported and kept', () => {
  const result = run('DragItem', 'const A = () => <DragItem leadingColor="#f00" />;');
  assert.deepEqual(codes(result), ['DRAG_ITEM_LEADING_COLOR']);
  assert.match(result.text, /leadingColor="#f00"/);
});

test('8. SegmentedControl drops size lg and control, and every one outside a form is reported', () => {
  const result = run('SegmentedControl', 'const A = () => <><SegmentedControl size="lg" /><SegmentedControl size="control" /><Form><SegmentedControl size="md" /></Form></>;');
  assert.match(result.text, /<SegmentedControl \/><SegmentedControl \/><Form><SegmentedControl size="md" \/><\/Form>/);
  assert.deepEqual(codes(result), ['SEGMENTED_FILTER_OR_VALUE', 'SEGMENTED_FILTER_OR_VALUE']);
});

test('9. ButtonGroup with JSX children is reported with the actions shape', () => {
  const result = run('ButtonGroup', 'const A = () => <><ButtonGroup><Button>a</Button></ButtonGroup><ButtonGroup actions={a} /></>;');
  assert.deepEqual(codes(result), ['BUTTON_GROUP_CHILDREN']);
  assert.match(result.findings[0]?.reason ?? '', /actions: ReadonlyArray/);
});

test('10. field vocabulary: Input isError and OtpInput disabled, invalid, onChange', () => {
  const result = run('Input, OtpInput', 'const A = () => <><Input isError={e} /><OtpInput disabled invalid={i} onChange={f} /></>;');
  assert.match(result.text, /<Input isInvalid=\{e\} \/><OtpInput isDisabled isInvalid=\{i\} onValueChange=\{f\} \/>/);
});

test('11. variant is deleted on fields and Tabs; Button and IconButton variant is reported', () => {
  const result = run('Input, Tabs, Button, IconButton, Select', 'const A = () => <><Input variant="secondary" /><Tabs variant="x" /><Select variant={v} /><Button variant="primary">a</Button><IconButton variant="ghost" label="l" /></>;');
  assert.match(result.text, /<Input \/><Tabs \/><Select \/><Button variant="primary">a<\/Button><IconButton variant="ghost" label="l" \/>/);
  assert.deepEqual(codes(result), ['BUTTON_VARIANT', 'BUTTON_VARIANT']);
  assert.match(result.findings[0]?.reason ?? '', /button-intent/);
});

test('12. size control is deleted; Switch and Avatar lg stay', () => {
  const result = run('Button, IconButton, Input, SearchField, Switch, Avatar, AvatarButton', 'const A = () => <><Button size="control">a</Button><IconButton size="control" label="l" /><Input size="control" /><SearchField size="control" /><Switch size="control" /><Avatar size="control" /><AvatarButton size="control" /><Switch size="lg" /><Avatar size="lg" /></>;');
  assert.match(result.text, /<Button>a<\/Button><IconButton label="l" \/><Input \/><SearchField \/><Switch \/><Avatar \/><AvatarButton \/><Switch size="lg" \/><Avatar size="lg" \/>/);
});

test('13. FlowGraph orbit becomes BubbleMap and its nodes are reported; exports are renamed', () => {
  const result = run('FlowGraph, flowGraphDiameter, orbitLayout', 'const A = () => <FlowGraph layout="orbit" label="l" nodes={n} edges={e} />; const d = flowGraphDiameter(1); const l = orbitLayout(n);');
  assert.equal(result.text, `import { bubbleDiameter, bubbleMapLayout, BubbleMap } from '${GRAMMAR}';\nconst A = () => <BubbleMap label="l" nodes={n} edges={e} />; const d = bubbleDiameter(1); const l = bubbleMapLayout(n);`);
  assert.deepEqual(codes(result), ['BUBBLE_MAP_NODES']);
});

test('13. FlowGraph with direction, a dynamic layout, or the moved types is reported and kept', () => {
  const result = run('FlowGraph, FlowGraphNodeForm, FlowGraphFill, FlowGraphRingPart', 'const A = () => <><FlowGraph layout="orbit" direction="LR" /><FlowGraph layout={m} /><FlowGraph layout="tree" /></>;');
  assert.deepEqual(codes(result).sort(), ['BUBBLE_MAP_LAYOUT', 'BUBBLE_MAP_PROPS', 'FLOW_GRAPH_TYPES', 'FLOW_GRAPH_TYPES', 'FLOW_GRAPH_TYPES']);
  assert.equal(result.changes.length, 0);
});

test('14. removed components and foldForSearch are reported on the import', () => {
  const result = run('Backdrop, RankArtwork, IncludedMark, foldForSearch', 'const A = () => <Backdrop />;');
  assert.deepEqual(codes(result), ['REMOVED_COMPONENT', 'REMOVED_COMPONENT', 'REMOVED_COMPONENT', 'REMOVED_EXPORT']);
  assert.match(result.findings[0]?.reason ?? '', /Freestyle/);
});

test('14. SurfaceCopyGroup becomes Stack by density; anything else is reported', () => {
  const result = run('SurfaceCopyGroup', 'const A = () => <><SurfaceCopyGroup density="comfortable"><p>a</p></SurfaceCopyGroup><SurfaceCopyGroup density="compact">b</SurfaceCopyGroup><SurfaceCopyGroup>c</SurfaceCopyGroup></>;');
  assert.equal(result.text, `import { Stack } from '${GRAMMAR}';\nconst A = () => <><Stack gap="row"><p>a</p></Stack><Stack gap="inline">b</Stack><Stack gap="inline">c</Stack></>;`);
  const kept = run('SurfaceCopyGroup', 'const A = () => <SurfaceCopyGroup density={d} className="x">c</SurfaceCopyGroup>;');
  assert.deepEqual(codes(kept), ['REMOVED_COMPONENT']);
});

test('14. TagGroup selection props are reported', () => {
  const result = run('TagGroup', 'const A = () => <><TagGroup selectionMode="single" /><TagGroup items={i} /></>;');
  assert.deepEqual(codes(result), ['TAG_GROUP_SELECTION']);
});

test('names resolve through an alias and a namespace import', () => {
  const result = transformSmallRenames({ ts, text: `import { StatusDot as Dot, CloseButton as Close } from '${GRAMMAR}';\nimport * as G from '@starci/grammar/offset-pop';\nconst A = () => <><Dot tone="x">T</Dot><Close label="c" /><G.ChatBubble /><G.TextAction href="/a">L</G.TextAction></>;` });
  assert.match(result.text, /<Badge isDot tone="x">T<\/Badge><IconButton intent="dismiss" label="c" \/><G\.MessageBubble \/><G\.Link href="\/a">L<\/G\.Link>/);
  assert.match(result.text, /^import \{ Badge, IconButton \} from/);
});

test('same names from another module are untouched', () => {
  const text = `import { ChatBubble, StatusDot, TextAction, FlowGraph, Backdrop, Input } from 'another-ui';\nconst A = () => <><ChatBubble /><StatusDot>t</StatusDot><TextAction href="/a">a</TextAction><FlowGraph layout="orbit" /><Input variant="x" isError /></>;`;
  const result = transformSmallRenames({ ts, text });
  assert.equal(result.text, text);
  assert.deepEqual([result.changes, result.findings], [[], []]);
});

test('a parse error keeps the file and reports PARSE_ERROR', () => {
  const result = run('ChatBubble', 'const A = () => <ChatBubble>');
  assert.deepEqual(codes(result), ['PARSE_ERROR']);
});

function fixture(t: TestContext, body = 'export const View = () => <><ChatBubble /><TextAction href="/a">A</TextAction><DragItem leadingColor="red" /></>;') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'small-renames-codemod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'fe/apps/web/src'), { recursive: true });
  const file = path.join(root, 'fe/apps/web/src/component.tsx');
  const text = `import { ChatBubble, TextAction, DragItem } from '${GRAMMAR}';\n${body}`;
  fs.writeFileSync(file, text);
  return { root, file, text };
}

test('dry run writes nothing, --execute writes the safe rewrites, and a second run finds nothing to change', t => {
  const { root, file, text } = fixture(t);
  const preview = migrateSmallRenames({ root, ts });
  assert.equal(preview.schema, 'starci/small-renames-report@1');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(preview.filesChanged, ['fe/apps/web/src/component.tsx']);
  assert.equal(preview.filesScanned, 1);
  const written = migrateSmallRenames({ root, write: true, ts });
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(migrated, /<MessageBubble \/><Link href="\/a">A<\/Link><DragItem leadingColor="red" \/>/);
  assert.match(migrated, /^import \{ DragItem, MessageBubble, Link \} from/);
  assert.deepEqual(written.findings.map(finding => finding.code), ['DRAG_ITEM_LEADING_COLOR']);
  const again = migrateSmallRenames({ root, write: true, ts });
  assert.deepEqual([again.changes, again.filesChanged], [[], []]);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);
  assert.match(smallRenamesMarkdown(written), /DRAG_ITEM_LEADING_COLOR/);
});

test('codemodMain small-renames exits 1 while findings remain and 0 when none do', t => {
  const { root, file } = fixture(t);
  const output: string[] = [];
  const io = { cwd: root, stdout: (value: string) => output.push(value) };
  assert.ok(CODEMODS.includes('small-renames'));
  assert.equal(codemodMain(['small-renames', '--json'], io), 1);
  assert.equal(JSON.parse(output.pop() ?? '{}').write, false);
  assert.match(fs.readFileSync(file, 'utf8'), /ChatBubble/);
  assert.equal(codemodMain(['small-renames', '--execute', '--out', 'report.json', '--format', 'json'], io), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')).changes.length, 2);
  assert.match(fs.readFileSync(file, 'utf8'), /MessageBubble/);
  fs.writeFileSync(file, `import { MessageBubble } from '${GRAMMAR}';\nexport const View = () => <MessageBubble />;`);
  assert.equal(codemodMain(['small-renames'], io), 0);
  assert.match(output.pop() ?? '', /0 left for a person/);
  assert.throws(() => codemodMain(['small-renames', '--bogus'], io), /unknown codemod option/);
  assert.throws(() => codemodMain(['small-renames', '--out', 'x.txt'], io), /report file/);
});

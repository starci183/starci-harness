import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { migrateTierBinding, tierBindingMarkdown, transformTierBinding } from '../codemod/tier-binding.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string) => transformTierBinding({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file: 'fe/component.tsx' });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);

test('1. Tooltip, Disclosure, DragItem and MediaFrame move their child into the named prop', () => {
  const result = run('Tooltip, Disclosure, DragItem, MediaFrame, Button, Image',
    'const A = () => <><Tooltip content="Copy"><Button onPress={f}>Copy</Button></Tooltip><Disclosure title="T">{rows}</Disclosure><DragItem tone="accent"><Button>x</Button></DragItem><MediaFrame aspect="square"><Image src="a" alt="b" /></MediaFrame></>;');
  assert.equal(result.text.split('\n')[1],
    'const A = () => <><Tooltip content="Copy" trigger={<Button onPress={f}>Copy</Button>} /><Disclosure title="T" body={rows} /><DragItem tone="accent" body={<Button>x</Button>} /><MediaFrame aspect="square" media={<Image src="a" alt="b" />} /></>;');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.changes.map(change => change.code), ['CHILD_TO_PROP', 'CHILD_TO_PROP', 'CHILD_TO_PROP', 'CHILD_TO_PROP']);
});

test('1. several children become a fragment and keep every space between them', () => {
  const result = run('MessageBubble, Text, Link', 'const A = () => <MessageBubble author="L"><Text isStrong>@You</Text> can it move? See <Link href="#x">the sheet</Link> now.</MessageBubble>;');
  assert.equal(result.text.split('\n')[1],
    'const A = () => <MessageBubble author="L" body={<><Text isStrong>@You</Text> can it move? See <Link href="#x">the sheet</Link> now.</>} />;');
});

test('1. nested rewrites settle: the inner child moves first, then its parent', () => {
  const result = run('MessageBubble, Tooltip, IconButton', 'const A = () => <MessageBubble actions={null}><Tooltip content="Copy"><IconButton label="c" /></Tooltip></MessageBubble>;');
  assert.equal(result.text.split('\n')[1], 'const A = () => <MessageBubble actions={null} body={<Tooltip content="Copy" trigger={<IconButton label="c" />} />} />;');
});

test('1. Quote takes text, Field takes the render function as control, a namespace import works', () => {
  const result = transformTierBinding({ ts, file: 'fe/component.tsx', text: `import * as G from '${GRAMMAR}';\nconst A = () => <><G.Quote source="Brain">Hello there</G.Quote><G.Field label="n">{(control) => <input {...control} />}</G.Field></>;` });
  assert.equal(result.text.split('\n')[1], 'const A = () => <><G.Quote source="Brain" text={"Hello there"} /><G.Field label="n" control={(control) => <input {...control} />} /></>;');
  assert.deepEqual(result.findings, []);
});

test('2. a child that cannot be moved, a spread and a Tooltip around a disabled control are reported', () => {
  const quote = run('Quote, Text', 'const A = () => <Quote><Text>a</Text></Quote>;');
  assert.deepEqual(codes(quote), ['CHILD_NOT_TEXT']);
  assert.match(quote.text, /<Quote><Text>a<\/Text><\/Quote>/);
  const spread = run('Disclosure', 'const A = () => <Disclosure {...p}>x</Disclosure>;');
  assert.deepEqual(codes(spread), ['SPREAD_PROPS']);
  const tooltip = run('Tooltip, Button', 'const A = () => <Tooltip content="r" isDisabledTrigger triggerDescribedBy="id"><Button isDisabled>x</Button></Tooltip>;');
  assert.deepEqual(codes(tooltip), ['TOOLTIP_DISABLED_TRIGGER']);
  assert.match(tooltip.text, /trigger=\{<Button isDisabled>x<\/Button>\}/);
});

test('3. a label leaf with a node child, a no-children component with a child and a className are reported, nothing is rewritten', () => {
  const result = run('Button, Badge, Stack, Alert, Icon, Heading', [
    'const A = () => <>',
    '<Button><Icon source={x} />Save</Button>',
    '<Badge>ok</Badge>',
    '<Heading level={2}>{title}</Heading>',
    '<Alert title="t"><p>body</p></Alert>',
    '<Stack className="x">y</Stack>',
    '</>;',
  ].join(''));
  assert.deepEqual(codes(result), ['LABEL_NOT_TEXT', 'TAKES_NO_CHILDREN', 'CLASS_NAME_REMOVED']);
  assert.match(result.text, /<Alert title="t"><p>body<\/p><\/Alert>/);
});

test('3. a file that does not import the grammar, and a local component with the same name, are untouched', () => {
  const none = transformTierBinding({ ts, text: 'const A = () => <Tooltip content="x"><b /></Tooltip>;', file: 'fe/c.tsx' });
  assert.equal(none.text, 'const A = () => <Tooltip content="x"><b /></Tooltip>;');
  const local = run('Text', 'const Tooltip = (p) => p.children;\nconst A = () => <Tooltip content="x"><b /></Tooltip>;');
  assert.match(local.text, /<Tooltip content="x"><b \/><\/Tooltip>/);
});

function app(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

test('4. a dry run writes nothing, --execute writes the safe rewrites and the CLI exits 1 while a case is left', (t) => {
  const source = `import { Tooltip, Button, Stack } from '${GRAMMAR}';\nexport const A = () => <><Tooltip content="c"><Button>x</Button></Tooltip><Stack className="y">z</Stack></>;\n`;
  const root = app(t, { 'fe/apps/web/a.tsx': source });
  const out: string[] = [];
  const io = { cwd: root, stdout: (text: unknown) => out.push(String(text)) };
  assert.equal(codemodMain(['tier-binding'], io), 1);
  assert.equal(fs.readFileSync(path.join(root, 'fe/apps/web/a.tsx'), 'utf8'), source);
  assert.match(out.join(''), /CLASS_NAME_REMOVED/);
  assert.equal(codemodMain(['tier-binding', '--execute'], io), 1);
  assert.match(fs.readFileSync(path.join(root, 'fe/apps/web/a.tsx'), 'utf8'), /<Tooltip content="c" trigger=\{<Button>x<\/Button>\} \/>/);
  const report = migrateTierBinding({ root, ts });
  assert.equal(report.schema, 'starci/tier-binding-report@1');
  assert.deepEqual(report.findings.map(finding => finding.code), ['CLASS_NAME_REMOVED']);
  assert.match(tierBindingMarkdown(report), /Left for a person/);
  assert.ok(CODEMODS.includes('tier-binding'));
});

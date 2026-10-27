import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { transformButtonIntent, migrateButtonIntent, codemodMain, buttonIntentMarkdown } from '../codemod/button-intent.mjs';
import { main as appMain } from './main.mjs';

const PREFIX = `import { Button, IconButton } from '@starci/grammar/core';\n`;
const transform = text => transformButtonIntent({ ts, text: PREFIX + text, file: 'fe/component.tsx' });

test('maps every published legacy variant and destructive step without changing surrounding source', () => {
  const input = `export const Actions = () => <><Button variant='primary'>Save</Button><Button variant="secondary">Other</Button><Button variant={"tertiary"}>Cancel</Button><Button variant="outline">Edit</Button><Button variant="ghost">Export</Button><IconButton variant="danger-soft" label="Remove" /><Button variant="danger">Delete</Button></>;`;
  const result = transform(input);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.changes.map(({ from, intent, step }) => [from, intent, step]), [
    ['primary', 'commit', undefined], ['secondary', 'alternative', undefined], ['tertiary', 'dismiss', undefined],
    ['outline', 'neutral', undefined], ['ghost', 'neutral', undefined], ['danger-soft', 'destructive', 'entry'], ['danger', 'destructive', 'confirm'],
  ]);
  assert.match(result.text, /<IconButton intent="destructive" step="entry" label="Remove" \/>/);
  assert.match(result.text, /<Button intent="destructive" step="confirm">Delete<\/Button>/);
  assert.equal(transformButtonIntent({ ts, text: result.text }).text, result.text);
});

test('secondary uses a commit sibling in its own group and otherwise becomes neutral', () => {
  const result = transform(`const Actions = () => <><ButtonGroup><Button variant="secondary">Edit</Button></ButtonGroup><Footer><Button variant="secondary">Other</Button><Button intent="commit">Save</Button></Footer></>;`);
  assert.deepEqual(result.changes.map(change => change.intent), ['neutral', 'alternative']);
  assert.deepEqual(result.findings, []);
});

test('resolves named aliases and namespaces and leaves another package Button intact', () => {
  const text = `import { Button as Action, IconButton as IconAction } from '@starci/grammar/offset-pop';
import * as Grammar from '@starci/grammar/core';
import { Button } from 'another-ui';
const View = () => <><Action variant="outline">Edit</Action><IconAction variant="ghost" label="Details"/><Grammar.Button variant="secondary">View</Grammar.Button><Button variant="primary">Own</Button></>;`;
  const result = transformButtonIntent({ ts, text });
  assert.deepEqual(result.changes.map(change => change.component), ['Action', 'IconAction', 'Grammar.Button']);
  assert.match(result.text, /<Button variant="primary">Own<\/Button>/);
});

test('reports destructive verb and handler signals on weak variants without guessing', () => {
  const result = transform(`const View = () => <><Button variant="outline">Delete account</Button><IconButton variant="ghost" label={t('actions.revoke')} /><Button variant="secondary" onPress={props.on.remove}>Action</Button><Button variant="outline">H\u1ee7y offer</Button><Button variant="ghost">X\u00f3a</Button><Button variant="outline">Reject application</Button></>;`);
  assert.equal(result.findings.length, 6);
  assert.ok(result.findings.every(finding => finding.code === 'destructive-verb'));
  assert.deepEqual(result.changes, []);
  assert.match(result.text, /variant="outline">Delete account/);
});

test('camelCase clear handlers and translated label identifiers require a human consequence decision', () => {
  const result = transform(`const View = () => <Button variant="secondary" onPress={props.on.onClear}>{props.clearPending ? props.clearingLabel : props.clearLabel}</Button>;`);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.findings.map(finding => finding.code), ['destructive-verb']);
});

test('snake_case translated keys and handlers retain destructive commands for review', () => {
  const result = transform(`const View = () => <><Button variant="outline">{t('actions.delete_account')}</Button><IconButton variant="ghost" label="Action" onPress={on_clear}/><Button variant="secondary" onPress={remove_resource}>Action</Button></>;`);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.findings.map(finding => finding.code), ['destructive-verb', 'destructive-verb', 'destructive-verb']);
});

test('leaves simultaneous primary buttons unresolved and reports repeated commit intents', () => {
  const input = `const View = () => <><Button variant="primary">Save</Button><Button intent="commit">Approve</Button>{rows.map(row => <Button variant="primary">Open</Button>)}</>;`;
  const result = transform(input);
  assert.equal(result.text, PREFIX + input);
  assert.equal(result.findings.filter(finding => finding.code === 'multiple-commits').length, 3);
  assert.equal(result.findings.filter(finding => finding.code === 'commit-in-collection').length, 1);
});

test('named, aliased and computed map callbacks retain primary buttons for a human decision', () => {
  const result = transform(`const renderRow = row => <Button variant="primary">Open</Button>; const alias = renderRow;
const View = () => <>{rows.map(alias)}{cards['map'](card => <Button variant="primary">View</Button>)}{other.map((item => <Button variant="primary">Run</Button>))}</>;`);
  assert.deepEqual(result.changes, []);
  assert.equal(result.findings.filter(finding => finding.code === 'commit-in-collection').length, 3);
});

test('nested JSX child and render prop callbacks keep the enclosing render and collection ownership', () => {
  const repeated = transform(`const View = () => <>{rows.map(row => <SlotView>{() => <Button variant="primary">Run</Button>}</SlotView>)}</>;`);
  assert.deepEqual(repeated.changes, []);
  assert.deepEqual(repeated.findings.map(finding => finding.code), ['commit-in-collection']);
  const simultaneous = transform(`const View = () => <><Button variant="primary">Save</Button><SlotView>{() => <Button variant="primary">Run</Button>}</SlotView></>;`);
  assert.deepEqual(simultaneous.changes, []);
  assert.deepEqual(simultaneous.findings.map(finding => finding.code), ['multiple-commits', 'multiple-commits']);
  const renderProp = transform(`const View = () => <><Button variant="primary">Save</Button><Table renderCell={() => <Button variant="primary">Run</Button>}/></>;`);
  assert.deepEqual(renderProp.changes, []);
  assert.deepEqual(renderProp.findings.map(finding => finding.code), ['multiple-commits', 'multiple-commits']);
});

test('local parameter and block bindings shadowing Grammar imports are not rewritten', () => {
  const text = `import {Button} from '@starci/grammar/core'; import * as Grammar from '@starci/grammar/core';
function First({Button}) { return <Button variant="primary">Local</Button>; }
function Second(Grammar) { return <Grammar.Button variant="outline">Local</Grammar.Button>; }
function Third() { const Button = Local; return <Button variant="primary">Local</Button>; }`;
  const result = transformButtonIntent({ ts, text });
  assert.equal(result.text, text);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.findings.map(finding => finding.code), ['shadowed-button-binding', 'shadowed-button-binding', 'shadowed-button-binding']);
});

test('mutually exclusive ternary and if/else renders can each own a commit', () => {
  const result = transform(`const View = () => ready ? <Button variant="primary">Save</Button> : <Button variant="primary">Retry</Button>;
function Other() { if (ready) { return <Button variant="primary">Save</Button>; } else { return <Button variant="primary">Retry</Button>; } }`);
  assert.deepEqual(result.findings, []);
  assert.equal(result.changes.length, 4);
});

test('exclusive discriminator and complementary boolean branches do not produce competing commits', () => {
  const result = transform(`const View = () => <>{props.state === "form" ? <Button variant="primary">Review</Button> : null}{props.state === "confirm" ? <Button variant="primary">Send</Button> : null}</>;
const Other = () => <>{ready && <Button variant="primary">Save</Button>}{!ready && <Button variant="primary">Retry</Button>}</>;`);
  assert.deepEqual(result.findings, []);
  assert.equal(result.changes.length, 4);
});

test('the same discriminator value and coercive equality do not hide competing commits', () => {
  const result = transform(`const View = () => <>{state === 'form' && <Button variant="primary">Review</Button>}{state === \`form\` && <Button variant="primary">Send</Button>}</>;
const Other = () => <>{step == 0 && <Button variant="primary">Save</Button>}{step == '0' && <Button variant="primary">Retry</Button>}</>;`);
  assert.deepEqual(result.changes, []);
  assert.equal(result.findings.filter(finding => finding.code === 'multiple-commits').length, 4);
});

test('does not mix commits across separate component render owners', () => {
  const result = transform(`const First = () => <Button variant="primary">Save</Button>; const Second = () => <Button variant="primary">Retry</Button>;`);
  assert.deepEqual(result.findings, []);
  assert.equal(result.changes.length, 2);
});

test('reports dynamic, absent, unsupported and overlapping props rather than inventing roles', () => {
  const result = transform(`const View = () => <><Button variant={choice}>Dynamic</Button><Button>Unknown</Button><Button variant="custom">Custom</Button><Button variant="ghost" {...props}>Spread</Button><Button variant="outline" intent="neutral">Both</Button><Button variant="danger" step="confirm">Existing step</Button></>;`);
  assert.deepEqual(result.findings.map(finding => finding.code), ['dynamic-variant', 'missing-variant', 'unknown-variant', 'spread-props', 'intent-and-variant', 'existing-step']);
  assert.deepEqual(result.changes, []);
});

test('a parse error retains the whole file and returns a visible finding', () => {
  const result = transform('const View = () => <Button variant="primary">');
  assert.equal(result.findings[0].code, 'parse-error');
  assert.deepEqual(result.changes, []);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'button-intent-codemod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'fe/apps/web/src'), { recursive: true });
  const file = path.join(root, 'fe/apps/web/src/component.tsx');
  const text = PREFIX + 'export const View = () => <><Button variant="outline">Edit</Button><Button variant="ghost">Delete</Button></>;';
  fs.writeFileSync(file, text);
  return { root, file, text };
}

test('dry run preserves source, --write applies only safe changes, and reports retain locations', t => {
  const { root, file, text } = fixture(t);
  const preview = migrateButtonIntent({ root, ts });
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(preview.filesChanged, ['fe/apps/web/src/component.tsx']);
  assert.equal(preview.findings[0].file, preview.filesChanged[0]);
  assert.equal(preview.findings[0].line, 2);
  const written = migrateButtonIntent({ root, write: true, ts });
  assert.equal(fs.readFileSync(file, 'utf8'), text.replace('variant="outline"', 'intent="neutral"'));
  assert.equal(written.findings.length, 1);
  const markdown = buttonIntentMarkdown(written);
  assert.match(markdown, /destructive-verb/);
  assert.match(markdown, /Applied: 1 safe changes/);
});

test('the app verb dispatch previews by default and writes safe edits plus a JSON decision report', async t => {
  const { root, file, text } = fixture(t);
  const output = [];
  const errors = [];
  const io = { cwd: root, stdout: value => output.push(value), stderr: value => errors.push(value) };
  assert.equal(await appMain(['codemod', 'button-intent', '--json'], io), 1);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(JSON.parse(output.pop()).write, false);
  assert.deepEqual(errors, []);
  assert.equal(await appMain(['codemod', 'button-intent', '--write', '--format', 'json', '--report', 'migration.json'], io), 1);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'migration.json'), 'utf8'));
  assert.equal(report.write, true);
  assert.equal(report.changes.length, 1);
  assert.equal(report.findings.length, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /intent="neutral"/);
});

test('CLI refuses unsupported migration names and unsafe report extensions', t => {
  const { root, file, text } = fixture(t);
  assert.throws(() => codemodMain(['other'], { cwd: root, stdout() {} }), /takes button-intent/);
  assert.throws(() => codemodMain(['button-intent', '--write', '--report', file], { cwd: root, stdout() {} }), /report file/);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

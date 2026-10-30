import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes, hashText, isText, combineHashes } from '../cache/hash.mjs';
import { areaOf, canonicalJson, groupByArea, parseRecords, reconcile, serializeRecords } from '../cache/jsonl.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const record = (path: string, hash: string, step = 'format', findings: CacheRecord['findings'] = []): CacheRecord => ({ path, step, hash, findings });

test('a CRLF checkout and an LF checkout of one text hash alike', () => {
  assert.equal(hashText('a\r\nb\r\n'), hashText('a\nb\n'));
  assert.notEqual(hashText('a\rb'), hashText('a\nb'));
});

test('binary bytes are hashed as they are, by git\'s NUL test', () => {
  const binary = Uint8Array.from([0x61, 0x0d, 0x0a, 0x00, 0x62]);
  assert.equal(isText(binary), false);
  assert.notEqual(hashBytes(binary), hashBytes(Uint8Array.from([0x61, 0x0a, 0x00, 0x62])));
  assert.equal(isText(Buffer.from('plain\r\n')), true);
});

test('combined hashes ignore part order and separate names from values', () => {
  assert.equal(combineHashes({ a: '1', b: '2' }), combineHashes({ b: '2', a: '1' }));
  assert.notEqual(combineHashes({ a: '12' }), combineHashes({ a1: '2' }));
});

test('records serialise sorted by path then step with sorted keys, LF and a final newline', () => {
  const text = serializeRecords([
    record('b.ts', 'h2'),
    { path: 'a.ts', step: 'lint', hash: 'h1', findings: [{ path: 'a.ts', line: 2, column: 1, rule: 'r', message: 'm' }, { path: 'a.ts', line: 1, column: 9, rule: 'r', message: 'm' }] },
    record('a.ts', 'h1', 'format'),
  ]);
  const lines = text.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(text.endsWith('}\n'));
  assert.ok(!text.includes('\r'));
  assert.deepEqual(lines.slice(0, 3).map((line) => JSON.parse(line).step), ['format', 'lint', 'format']);
  assert.ok(lines[1]?.startsWith('{"findings":[{"column":9,"line":1,'));
  assert.equal(serializeRecords([]), '');
  assert.equal(canonicalJson({ b: 1, a: { d: undefined, c: 2 } }), '{"a":{"c":2},"b":1}');
});

test('two serialisations of one set are identical bytes whatever the input order', () => {
  const set = [record('z.ts', 'h'), record('m/a.ts', 'h'), record('a.ts', 'h')];
  assert.equal(serializeRecords(set), serializeRecords([...set].reverse()));
});

test('parsing skips and counts the lines that are not records', () => {
  const parsed = parseRecords(`${serializeRecords([record('a.ts', 'h')])}not json\r\n{"path":1}\n\n`);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.invalid, 2);
  assert.deepEqual(parseRecords(serializeRecords([record('a.ts', 'h')]).replaceAll('\n', '\r\n')).records, [record('a.ts', 'h')]);
});

test('a union merge is reduced to the record that matches the tree', () => {
  const hashes: Record<string, string> = { 'a.ts': 'new', 'b.ts': 'b1' };
  const merged = [record('a.ts', 'old'), record('a.ts', 'new'), record('a.ts', 'new'), record('b.ts', 'b1'), record('gone.ts', 'x')];
  assert.deepEqual(reconcile(merged, (path) => hashes[path]), [record('a.ts', 'new'), record('b.ts', 'b1')]);
});

test('two matching records that disagree keep neither', () => {
  const clean = record('a.ts', 'h');
  const dirty = record('a.ts', 'h', 'format', [{ path: 'a.ts', line: 1, column: 1, rule: 'r', message: 'm' }]);
  assert.deepEqual(reconcile([clean, dirty], () => 'h'), []);
});

test('records group into area files of the first two folders, a root file in root.jsonl', () => {
  assert.equal(areaOf('modules/billing/a/b.ts'), 'modules/billing');
  assert.equal(areaOf('apps/web.ts'), 'apps');
  assert.equal(areaOf('package.json'), 'root');
  assert.equal(areaOf('fe/apps/web/x.ts', 3), 'fe/apps/web');
  const groups = groupByArea([record('package.json', 'h'), record('modules/billing/b.ts', 'h'), record('modules/billing/a.ts', 'h')]);
  assert.deepEqual([...groups.keys()], ['modules/billing.jsonl', 'root.jsonl']);
  assert.deepEqual(groups.get('modules/billing.jsonl')?.map((r) => r.path), ['modules/billing/a.ts', 'modules/billing/b.ts']);
});

test('the fake session serves its trusted records, remembers replacements and logs progress', () => {
  const session = createFakeSession({ files: { 'a.ts': 'x' }, records: { 'check/format': [record('a.ts', hashText('x'))] }, mode: 'full', fullReason: '--full' });
  assert.deepEqual(session.decide('format'), { mode: 'full', reason: '--full' });
  assert.equal(session.records('check/format').length, 1);
  assert.deepEqual(session.records('lint/be'), []);
  const step = session.progress.step('format', 'prettier', 1);
  step.tick(1, 0, 1);
  step.end();
  assert.deepEqual(session.events.map((e) => e.kind), ['start', 'tick', 'end']);
  session.replace('check/format', []);
  assert.deepEqual(session.records('check/format'), []);
  assert.deepEqual(session.flush().written, ['check/format']);
  session.setFile('a.ts', undefined);
  assert.equal(session.index.hashOf('a.ts'), undefined);
});

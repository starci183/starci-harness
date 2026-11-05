// The per-spec coverage records are held as their lines and parsed one at a time (memory plan, streaming): a lazy record writes back the bytes it was
// read from and parses its data only when asked, the session dedupes by a line's digest, the union of the records folds through the preset's merge
// one record at a time, and a folder of 80 MB of records is read and written back under a 400 MB heap that its parsed tree would not fit in.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { lazyRecord, parseRecords, recordLine, serializeRecords, toLazyRecord } from '../cache/jsonl.mjs';
import { unionOfRecords, type SourceItems } from '../cache/test-family.mjs';
import type { CacheRecord, JsonValue } from '../cache/types.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const record = (spec: string, sources: Record<string, unknown>): CacheRecord => ({ path: spec, step: 'unit-spec', hash: `key-${spec}`, findings: [], data: { sources } as unknown as JsonValue });

test('a lazy record writes back its own line and parses its data each time it is read', () => {
  const eager = record('be/src/a.spec.ts', { 'be/src/a.ts': { s: [[1, 0, 1, 9, 1]], f: [], b: [] } });
  const text = serializeRecords([eager]);
  const [lazy] = parseRecords(text, { lazy: true }).records;
  assert.ok(lazy !== undefined);
  assert.equal(serializeRecords([lazy]), text, 'the bytes it was read from');
  assert.deepEqual(lazy.data, eager.data);
  assert.notEqual(lazy.data, lazy.data, 'parsed again on every read, never kept');
  assert.equal(recordLine(toLazyRecord(eager)), recordLine(eager));
  const loose = '{"step":"unit-spec","path":"be/x.spec.ts","hash":"k","findings":[],"data":{"sources":{}}}';
  const [kept] = parseRecords(`${loose}\n`, { lazy: true }).records;
  assert.equal(recordLine(kept as CacheRecord), recordLine(JSON.parse(loose) as CacheRecord), 'a line that is not canonical is held parsed and written canonically');
  assert.equal(lazyRecord(recordLine(eager), eager).path, 'be/src/a.spec.ts');
});

test('the union folds the records one at a time and keeps each item\'s merged count in the merge\'s order', () => {
  const seen: string[] = [];
  const records = (function* records(): Generator<Readonly<Record<string, SourceItems>>> {
    seen.push('first');
    yield { 'be/a.ts': { s: [[1, 0, 1, 5, 1]], f: [], b: [] } };
    seen.push('second');
    yield { 'be/a.ts': { s: [[1, 0, 1, 5, 1]], f: [], b: [] } };
  })();
  // A stand-in for the preset's istanbul merge: it sums each statement's hits by its range, reading the records as they come.
  const union = unionOfRecords(records, (iterable) => {
    const hits = new Map<string, Map<string, number>>();
    for (const one of iterable) for (const [source, items] of Object.entries(one)) for (const item of items.s as number[][]) {
      const key = item.slice(0, 4).join(':');
      const file = hits.get(source) ?? new Map<string, number>();
      file.set(key, (file.get(key) ?? 0) + (item[4] ?? 0));
      hits.set(source, file);
    }
    return {
      files: () => [...hits.keys()],
      fileCoverageFor: (file) => ({
        toJSON: () => {
          const entries = [...(hits.get(file) ?? new Map<string, number>())];
          const loc = (key: string) => { const [sl = 0, sc = 0, el = 0, ec = 0] = key.split(':').map(Number); return { start: { line: sl, column: sc }, end: { line: el, column: ec } }; };
          return { statementMap: Object.fromEntries(entries.map(([key], index) => [String(index), loc(key)])), s: Object.fromEntries(entries.map(([, count], index) => [String(index), count])), fnMap: {}, f: {}, branchMap: {}, b: {} };
        },
      }),
    };
  });
  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(union, { 'be/a.ts': { s: [[1, 0, 1, 5, 2]], f: [], b: [] } });
});

function bigRecords(t: TestContext, megabytes: number): string {
  const dir = mkdtemp(t, 'starci-streaming-');
  const file = path.join(dir, 'root.jsonl');
  const statements = Array.from({ length: 2000 }, (_, index) => [index + 1, 0, index + 1, 40, index % 2]);
  const records: CacheRecord[] = [];
  let bytes = 0;
  for (let index = 0; bytes < megabytes * 1_048_576; index += 1) {
    const one = record(`be/src/s${String(index).padStart(5, '0')}.spec.ts`, { [`be/src/m${String(index)}.ts`]: { s: statements, f: [], b: [] } });
    bytes += recordLine(one).length + 1;
    records.push(one);
  }
  fs.writeFileSync(file, serializeRecords(records));
  return file;
}

test('80 MB of coverage records are read and written back under a 400 MB heap their parsed tree outgrows', (t) => {
  const file = bigRecords(t, 80);
  const jsonl = new URL('../cache/jsonl.mjs', import.meta.url).href;
  const script = (lazy: boolean) => `import fs from 'node:fs'; import { parseRecords, serializeRecords } from '${jsonl}';
const text = fs.readFileSync(process.argv[1], 'utf8');
const records = parseRecords(text, { lazy: ${String(lazy)} }).records;
const out = serializeRecords(records);
process.stdout.write(String(out.length === text.length && out === text));`;
  const run = (lazy: boolean) => spawnSync(process.execPath, ['--max-old-space-size=400', '--input-type=module', '-e', script(lazy), file], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const streamed = run(true);
  assert.equal(streamed.status, 0, streamed.stderr.slice(-400));
  assert.equal(streamed.stdout, 'true', 'the bytes written back are the bytes read');
  const parsed = run(false);
  assert.notEqual(parsed.status, 0, 'held parsed, the same records do not fit the same heap');
});

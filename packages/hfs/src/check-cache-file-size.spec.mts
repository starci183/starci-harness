// A committed cache file stays well under what a git host takes: a group of records over RECORD_FILE_MAX_BYTES splits one folder deeper and,
// in one folder, into hash buckets; the push gate refuses a cache file over the limit (STARCI_CACHE_FILE_MAX_MB, 90) as
// HFS_CHECK_CACHE_FILE_TOO_LARGE before anything uploads; the readers read every `.jsonl` of a folder, so the old single file is still read.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupByArea, parseRecords, RECORD_FILE_MAX_BYTES, serializeRecords } from '../cache/jsonl.mjs';
import { cacheFileLimitMb, freshnessFindings, TOO_LARGE } from '../cache/freshness.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const record = (spec: string, bytes: number): CacheRecord => ({ path: spec, step: 'spec', hash: 'h', findings: [], data: { sources: { 'be/src/a.ts': { s: [[1, 1, 1, 1, 'x'.repeat(bytes)]], f: [], b: [] } } } });

test('a test-coverage folder over the file budget splits into files each under it, and every record is kept once', () => {
  const max = 64 * 1024;
  // one deep tree and one flat folder of many specs: both split under the budget
  const records = [
    ...Array.from({ length: 40 }, (_, index) => record(`be/src/modules/domain/area-${String(index % 4)}/x-${String(index)}.spec.ts`, 8_000)),
    ...Array.from({ length: 60 }, (_, index) => record(`be/src/flat-${String(index)}.spec.ts`, 8_000)),
  ];
  const files = groupByArea(records, 2, max);
  assert.ok(files.size > 2, `${String(files.size)} files`);
  for (const [file, group] of files) assert.ok(Buffer.byteLength(serializeRecords(group)) <= max, `${file} stays under the budget`);
  assert.deepEqual([...files.values()].flat().map((entry) => entry.path).sort(), records.map((entry) => entry.path).sort());
  assert.ok([...files.keys()].some((file) => /^be\/src\/~\d+\.jsonl$/u.test(file)), 'a flat folder splits into hash buckets');
  assert.ok([...files.keys()].some((file) => file.startsWith('be/src/modules/domain/area-')), 'a deep folder splits by folder');
  assert.deepEqual(groupByArea(records, 2, max), files, 'the split is the same on every run');
  const small = groupByArea(records.slice(0, 3));
  assert.deepEqual([...small.keys()], ['be/src.jsonl'], 'under the budget the area file stays one file');
  assert.equal(RECORD_FILE_MAX_BYTES, 32 * 1024 * 1024);
});

test('the old single file of a folder is still read record by record', () => {
  const text = serializeRecords([record('be/src/a.spec.ts', 10), record('be/src/b.spec.ts', 10)]);
  assert.deepEqual(parseRecords(text).records.map((entry) => entry.path), ['be/src/a.spec.ts', 'be/src/b.spec.ts']);
});

test('the push gate refuses a cache file over the limit, largest first, before any other judgement', (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-cache-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.starcistacks', 'cache', 'test-coverage', 'be');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'src.jsonl'), Buffer.alloc(3 * 1024 * 1024, 120));
  fs.writeFileSync(path.join(dir, 'ok.jsonl'), 'x\n');
  const refused = freshnessFindings({ root, portable: false, localReasons: [], written: [], removed: [], uncommitted: [], limitMb: 2 });
  assert.deepEqual(refused.map((finding) => [finding.code, finding.path]), [[TOO_LARGE, '.starcistacks/cache/test-coverage/be/src.jsonl']]);
  assert.match(refused[0]?.message ?? '', /is 3 MB, over the 2 MB a push may carry/u);
  assert.deepEqual(freshnessFindings({ root, portable: true, localReasons: [], written: [], removed: [], uncommitted: [], limitMb: 5 }), []);
  assert.equal(cacheFileLimitMb({}), 90);
  assert.equal(cacheFileLimitMb({ STARCI_CACHE_FILE_MAX_MB: '40' }), 40);
});

test('the CI unit run takes one more shard per 150 spec files, so a 1,676-spec back end runs in 12 shards', () => {
  const specs = (count: number): string[] => Array.from({ length: count }, (_, index) => `be/src/modules/m-${String(index)}/m.service.spec.ts`);
  assert.equal(ciWorkflowCommands({ files: specs(1_676) }).testShardTotal, '12');
  assert.equal(ciWorkflowCommands({ files: specs(400) }).testShardTotal, '6');
});

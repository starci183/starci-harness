// proves: HFS_CHECK_CACHE_FORGED
// The db family's record is equal wherever it is written: the order findings come out in (a directory walk, a rule's own order) and the spelling of their paths are no content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCommitted, FORGED } from '../cache/trust.mjs';
import { sortFindings, serializeRecords, parseRecords } from '../cache/jsonl.mjs';
import { compact } from '../cache/db-family.mjs';
import type { CacheRecord, Finding } from '../cache/types.mjs';

const at = (line: number, column: number | string, rule: string, message: string, path = 'db/migrations/1.sql'): Finding => ({ path, line, column: column as number, rule, message });
const FINDINGS = [at(59, 0, 'DB_PRIMARY_KEY_SHAPE', 'b'), at(44, 'session_id', 'DB_FOREIGN_KEY_NAME', 'a'), at(44, 0, 'DB_FOREIGN_KEY_INDEX', 'c'), at(3, 0, 'DB_FOREIGN_KEY_INDEX', 'd', 'db/migrations/0.sql'), at(44, 'created_by', 'DB_FOREIGN_KEY_NAME', 'e')];
const record = (findings: Finding[]): CacheRecord => ({ path: 'db', step: 'db-rules', hash: 'h', findings });

test('the committed record (sorted on disk) equals the computed one whatever order the rules produced', () => {
  const committed = parseRecords(serializeRecords([record(FINDINGS)])).records;
  for (const order of [FINDINGS, [...FINDINGS].reverse(), [FINDINGS[2], FINDINGS[0], FINDINGS[4], FINDINGS[1], FINDINGS[3]]]) {
    assert.deepEqual(verifyCommitted({ trusted: new Map(), computed: new Map([['check/db', [record(order)]]]), committed: new Map([['check/db', committed]]) }), []);
  }
  const different = verifyCommitted({ trusted: new Map(), computed: new Map([['check/db', [record([...FINDINGS.slice(1), at(1, 0, 'DB_X', 'other')])]]]), committed: new Map([['check/db', committed]]) });
  assert.deepEqual(different.map((verdict) => verdict.code), [FORGED]);
});

test('sortFindings is a total order: named columns and numbers sort alike from any input order', () => {
  const expected = JSON.stringify(sortFindings(FINDINGS));
  for (let shift = 0; shift < FINDINGS.length; shift += 1) assert.equal(JSON.stringify(sortFindings([...FINDINGS.slice(shift), ...FINDINGS.slice(0, shift)].reverse())), expected);
  assert.deepEqual(sortFindings(FINDINGS).map((finding) => finding.column), [0, 0, 'created_by', 'session_id', 0]);
});

test('a db finding keeps posix separators whatever host judged it', () => {
  assert.equal(compact({ code: 'DB_X', level: 'error', path: ['db', 'migrations', '1.sql'].join(String.fromCharCode(92)), message: 'm' }).path, 'db/migrations/1.sql');
});

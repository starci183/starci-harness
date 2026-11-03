// `starci app codemod secrets-cache`: a secrets cache written before the digests (raw messages, a payload) becomes the record contract of the secrets family.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { migrateSecretsCache, secretsCacheMarkdown } from '../codemod/secrets-cache.mjs';
import { secretRecordFaults } from '../runtime/scripts/lib/secret-records.mjs';

const FOLDER = '.starcistacks/cache/check/secrets';
const sha = 'b'.repeat(64);
const legacy = JSON.stringify({ data: { seen: 1 }, findings: [{ column: 2, line: 7, message: 'be/src/leak.ts:7 holds a plaintext secret (aws-access-key)', path: 'be/src/leak.ts', rule: 'HFS_PLAINTEXT_SECRET' }], hash: sha, path: 'be/src/leak.ts', step: 'secrets' });

function app(files: Record<string, string>): { root: string; done(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-cache-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('1. a legacy secrets cache is previewed, then migrated to digests with the payload dropped; the second run changes nothing', () => {
  const fixture = app({ [`${FOLDER}/be.jsonl`]: `${legacy}\n`, [`${FOLDER}/fe/src.jsonl`]: '', '.starcistacks/cache/check/hfs/x.jsonl': 'untouched' });
  try {
    const dry = migrateSecretsCache({ root: fixture.root });
    assert.deepEqual([dry.schema, dry.filesScanned, dry.filesChanged, dry.write, dry.findings], ['starci/secrets-cache-report@1', 2, [`${FOLDER}/be.jsonl`], false, []]);
    assert.deepEqual(dry.changes, [{ file: `${FOLDER}/be.jsonl`, records: 1, messagesDigested: 1, payloadsDropped: 1 }]);
    assert.equal(fs.readFileSync(path.join(fixture.root, FOLDER, 'be.jsonl'), 'utf8'), `${legacy}\n`, 'a dry run writes nothing');
    const out: string[] = [];
    assert.equal(codemodMain(['secrets-cache', '--execute'], { cwd: fixture.root, stdout: (text) => out.push(text) }), 0);
    assert.match(out.join(''), /# secrets-cache/);
    const migrated = fs.readFileSync(path.join(fixture.root, FOLDER, 'be.jsonl'), 'utf8');
    assert.deepEqual(secretRecordFaults(migrated), []);
    assert.equal(migrated.includes('plaintext secret'), false);
    assert.equal(fs.readFileSync(path.join(fixture.root, '.starcistacks/cache/check/hfs/x.jsonl'), 'utf8'), 'untouched', 'other families are not the codemod\'s');
    const again = migrateSecretsCache({ root: fixture.root });
    assert.deepEqual([again.filesChanged, again.changes, again.findings], [[], [], []]);
    assert.match(secretsCacheMarkdown(dry), /1 would be migrated/);
    assert.ok(CODEMODS.includes('secrets-cache'));
  } finally {
    fixture.done();
  }
});

test('2. a file that is not records is left for a person and the run exits 1; an app without a cache has nothing to do', () => {
  const broken = app({ [`${FOLDER}/be.jsonl`]: 'not a record\n', [`${FOLDER}/fe.jsonl`]: `${JSON.stringify({ findings: [{ column: 0, line: 1, message: 'm', path: 'a.ts', rule: 'NOT_A_SECRET_CODE' }], hash: sha, path: 'a.ts', step: 'secrets' })}\n` });
  const empty = app({ 'README.md': '# app\n' });
  try {
    const report = migrateSecretsCache({ root: broken.root, write: true });
    assert.deepEqual(report.findings.map((finding) => [finding.file, finding.code]), [[`${FOLDER}/be.jsonl`, 'SECRETS_CACHE_UNREADABLE'], [`${FOLDER}/fe.jsonl`, 'SECRETS_CACHE_NOT_MIGRATABLE']]);
    assert.equal(fs.readFileSync(path.join(broken.root, FOLDER, 'be.jsonl'), 'utf8'), 'not a record\n', 'a file it cannot migrate is not touched');
    assert.match(secretsCacheMarkdown(report), /Left for a person/);
    assert.equal(codemodMain(['secrets-cache'], { cwd: broken.root, stdout: () => undefined }), 1);
    assert.deepEqual(migrateSecretsCache({ root: empty.root }), { schema: 'starci/secrets-cache-report@1', root: empty.root, write: false, filesScanned: 0, filesChanged: [], changes: [], findings: [] });
  } finally {
    broken.done();
    empty.done();
  }
});

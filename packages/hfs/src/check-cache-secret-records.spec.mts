// proves: HFS_PLAINTEXT_SECRET@lite
// proves: HFS_PLAINTEXT_SECRET@full
// The secrets family's records are committed (contexts/project/check-cache.md, "The secrets records"): they hold codes, paths, positions and digests,
// never secret material, and the commit guard judges the cache files by that contract, not by the `secrets/` folder in their path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { git } from '../cache/git.mjs';
import { safeSecretRecords } from '../cache/secret-records.mjs';
import { parseRecords } from '../cache/jsonl.mjs';
import { secretFileFindings } from '../runtime/scripts/hfs/rules/secrets.mjs';
import { messageDigest, SECRETS_CACHE_FILE, secretRecordFaults } from '../runtime/scripts/lib/secret-records.mjs';
import { hygieneFindings, judge } from '../sync/hygiene.mjs';
import { appRepo, FAKE_KEY, FILES, runPass, write } from './check-cache-structure-support.mjs';

const CACHE_SECRETS = '.starcistacks/cache/check/secrets';
const sha = 'a'.repeat(64);
const record = (extra: Record<string, unknown> = {}, finding: Record<string, unknown> = {}) => JSON.stringify({
  findings: [{ column: 1, line: 3, message: messageDigest('the message'), path: 'be/src/leak.ts', rule: 'HFS_PLAINTEXT_SECRET', ...finding }], hash: sha, path: 'be/src/leak.ts', step: 'secrets', ...extra,
});

test('the secrets cache file pattern names the committed folder, at the app root or below one', () => {
  assert.ok(SECRETS_CACHE_FILE.test(`${CACHE_SECRETS}/be.jsonl`));
  assert.ok(SECRETS_CACHE_FILE.test(`${CACHE_SECRETS}/be/src.jsonl`), 'an area is a folder path');
  assert.ok(SECRETS_CACHE_FILE.test(`apps/shop/${CACHE_SECRETS}/be.jsonl`));
  assert.ok(!SECRETS_CACHE_FILE.test('.starcistacks/dev/secrets/be.jsonl'));
});

test('a record of codes, paths, positions and digests is accepted; anything else is a fault', () => {
  assert.deepEqual(secretRecordFaults(`${record()}\n`), []);
  assert.deepEqual(secretRecordFaults(''), []);
  assert.match(secretRecordFaults(record({ data: { value: FAKE_KEY } }))[0] ?? '', /carries data/);
  assert.match(secretRecordFaults(record({}, { message: `holds ${FAKE_KEY}` }))[0] ?? '', /not a digest/);
  assert.match(secretRecordFaults(record({}, { rule: 'FE_ANYTHING' }))[0] ?? '', /not a code of the secrets family/);
  assert.match(secretRecordFaults(record({}, { value: 'x' }))[0] ?? '', /keys/);
  assert.match(secretRecordFaults(record({}, { path: '/etc/passwd' }))[0] ?? '', /not a relative posix path/);
  assert.match(secretRecordFaults(record({}, { path: '../outside' }))[0] ?? '', /not a relative posix path/);
  assert.match(secretRecordFaults(record({}, { line: 'x' }))[0] ?? '', /position/);
  assert.match(secretRecordFaults(record({ step: 'hfs' }))[0] ?? '', /step/);
  assert.match(secretRecordFaults(record({ hash: 'zzz' }))[0] ?? '', /hash/);
  assert.match(secretRecordFaults('not json')[0] ?? '', /not JSON/);
  assert.match(secretRecordFaults('[]')[0] ?? '', /not a record/);
  assert.match(secretRecordFaults(JSON.stringify({ path: 'a', step: 'secrets', hash: sha, findings: 1 }))[0] ?? '', /findings is not a list/);
  assert.match(secretRecordFaults(JSON.stringify({ path: 'a', step: 'secrets', hash: sha, findings: [1] }))[0] ?? '', /not an object/);
  assert.deepEqual(secretRecordFaults(`${record()}\r\n\r\n`), []);
});

test('the digest of a message is stable, short and idempotent', () => {
  const digest = messageDigest('be/src/leak.ts:3 holds a plaintext secret (aws-access-key)');
  assert.match(digest, /^sha256:[0-9a-f]{16}$/);
  assert.equal(messageDigest(digest), digest);
  assert.equal(messageDigest('the message'), messageDigest('the message'));
  assert.notEqual(messageDigest('one'), messageDigest('two'));
});

test('the writer projects every record: digests for messages, no data', () => {
  const [safe] = safeSecretRecords([{ path: 'a.ts', step: 'secrets', hash: sha, findings: [{ path: 'a.ts', line: 1, column: 2, rule: 'HFS_PLAINTEXT_SECRET', message: `a.ts:1 ${FAKE_KEY}` }], data: { leaked: FAKE_KEY } }]);
  assert.ok(safe);
  assert.equal(safe.data, undefined);
  assert.equal(JSON.stringify(safe).includes(FAKE_KEY), false);
  assert.equal(safe.findings[0]?.message, messageDigest(`a.ts:1 ${FAKE_KEY}`));
});

test('the commit guard no longer refuses a cache file for sitting under secrets/, and still refuses a plaintext file of a stack', () => {
  assert.deepEqual(hygieneFindings([`${CACHE_SECRETS}/be.jsonl`], new Set()), []);
  assert.deepEqual(hygieneFindings(['.starcistacks/dev/secrets/app.txt'], new Set()).map((finding) => finding.code), ['HFS_PLAINTEXT_SECRET']);
});

test('the secret judgement accepts a conforming cache file and refuses one that holds more', () => {
  assert.deepEqual(secretFileFindings({ file: `${CACHE_SECRETS}/be.jsonl`, text: `${record()}\n` }), []);
  const refused = secretFileFindings({ file: `${CACHE_SECRETS}/be.jsonl`, text: `${record({}, { message: `be/src/leak.ts:3 holds ${FAKE_KEY}` })}\n` });
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.code, 'HFS_PLAINTEXT_SECRET');
  assert.equal(refused[0]?.pattern, 'secrets-cache-record');
  assert.equal(JSON.stringify(refused).includes(FAKE_KEY), false, 'a finding never prints the value');
});

/** The files of the secrets cache folder, repo-relative, whatever the depth of the area they name. */
const cacheFiles = (root: string): string[] => fs.readdirSync(path.join(root, CACHE_SECRETS), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
  .map((entry) => path.posix.join(CACHE_SECRETS, path.relative(path.join(root, CACHE_SECRETS), path.join(entry.parentPath, entry.name)).split(path.sep).join('/')));

/** A fixture app whose tracked tree holds one file with a secret-shaped value (built from parts), committed. */
function leakingRepo(t: test.TestContext): string {
  const root = appRepo(t, { ...FILES, 'be/src/leak.ts': `export const key = '${FAKE_KEY}';\n` });
  return root;
}

test('app check writes the secrets cache, and the staged guard lets exactly that file through', async (t) => {
  const root = leakingRepo(t);
  const cold = await runPass(root, { hfs: false, secrets: true });
  assert.equal(cold.pass.secretsReport?.newFindings, 1);
  const files = cacheFiles(root);
  assert.ok(files.length > 0, 'the run wrote the secrets cache');
  const texts = files.map((name) => fs.readFileSync(path.join(root, name), 'utf8'));
  for (const text of texts) {
    assert.equal(text.includes(FAKE_KEY), false, 'the cache never holds the value');
    assert.deepEqual(secretRecordFaults(text), []);
  }
  assert.ok(parseRecords(texts.join('')).records.length > 0);
  const warm = await runPass(root, { hfs: false, secrets: true });
  assert.equal(warm.pass.secretsReport?.knownFindings, 1, 'the digest is the identity of the finding across runs');
  git(root, ['add', '-f', '.starcistacks/cache']);
  const staged = git(root, ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter((file) => file.startsWith(CACHE_SECRETS));
  assert.ok(staged.length > 0);
  assert.deepEqual(judge(root, staged).findings.filter((finding) => finding.code === 'HFS_PLAINTEXT_SECRET'), []);
  const first = staged[0] as string;
  write(root, first, `${record({}, { message: `holds ${FAKE_KEY}` })}\n`);
  git(root, ['add', '-f', first]);
  assert.ok(judge(root, staged).findings.some((finding) => finding.code === 'HFS_PLAINTEXT_SECRET' && finding.file === first), 'a tampered cache file is refused by what it holds');
});

test('a cache written before the digests held raw messages: it reads back as digests, so the first run compares like with like', async (t) => {
  const root = leakingRepo(t);
  await runPass(root, { hfs: false, secrets: true });
  const file = path.join(root, cacheFiles(root)[0] as string);
  const legacy = parseRecords(fs.readFileSync(file, 'utf8')).records.map((entry) => ({ ...entry, findings: entry.findings.map((finding) => ({ ...finding, message: `${finding.path}:${finding.line} holds a plaintext secret` })) }));
  fs.writeFileSync(file, `${legacy.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const again = await runPass(root, { hfs: false, secrets: true });
  assert.equal(again.secrets.every((entry) => entry.findings.every((finding) => finding.message.startsWith('sha256:'))), true);
});

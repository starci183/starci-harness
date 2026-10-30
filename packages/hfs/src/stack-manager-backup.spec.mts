// The database backup made on the manager (stack/manager-backup.mjs): the remote scripts are composed only from validated names and quoted values,
// no password or URL secret is in them, the dump never leaves a root-private scratch directory, and the receipt is judged against a second reading of
// the archive. The runner is a double; the shell scripts are syntax-checked with bash where bash exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { backupFolder, decryptScript, dumpScript, managerBackup, managerDecrypt, measureScript } from '../stack/manager-backup.mjs';
import { backupProblems } from '../stack/db-phases.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import type { RemoteResult, Runner } from '../stack/remote.mjs';

const RECIPIENT = `age1${'q'.repeat(58)}`;
const SERVER = `age1${'z'.repeat(58)}`;
const CONTAINER = 'abcdef012345';
const URL = 'postgresql://appowner@127.0.0.1:5432/appdb';
const CONFIG = { stack: 'shop', project: 'shop', backup: null } as unknown as DeployConfig; // reason: the backup reads stack, project and backup only
const CTX = {} as unknown as StackContext; // reason: the backup does not read the context

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

test('the backup folder is the volume backup folder plus db, and an unsafe folder is refused', () => {
  assert.equal(backupFolder({ stack: 'shop', backup: null }), '/var/backups/shop/db');
  assert.equal(backupFolder({ stack: 'shop', backup: { image: 'x', keepDays: 1, dir: '/srv/backups', volumes: [] } }), '/srv/backups/db');
  assert.throws(() => backupFolder({ stack: 'shop', backup: { image: 'x', keepDays: 1, dir: '/srv/../etc', volumes: [] } }), /STACK_DEPLOY_BACKUP_DIR/u);
});

test('the dump script reads the password inside the container, encrypts to every recipient and leaves no plaintext behind', () => {
  const script = dumpScript({ dir: '/var/backups/shop/db', file: 'shop-1.tar.age', container: CONTAINER, url: URL, recipients: [RECIPIENT, SERVER] });
  assert.ok(script.includes('POSTGRES_PASSWORD_FILE'), 'the container reads its own secret file');
  assert.ok(!/PGPASSWORD=[^$]/u.test(script) && !script.includes('s3cret'), 'no password value is in the script');
  assert.ok(script.includes(`-r '${RECIPIENT}'`) && script.includes(`-r '${SERVER}'`));
  assert.ok(script.startsWith('set -o pipefail; umask 077;'));
  assert.ok(script.includes("trap 'rm -rf \"$S\"' EXIT"), 'the plaintext scratch directory is removed on every exit');
  assert.ok(script.includes('.partial') && script.includes('rm -f'), 'a failed dump leaves no truncated archive that looks valid');
  for (const part of ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']) assert.ok(script.includes(part), part);
  assert.ok(!script.includes('\n'), 'one line, so the remote shell quoting stays whole');
});

test('the scripts are valid shell', { skip: !hasBash }, () => {
  for (const script of [
    dumpScript({ dir: '/var/backups/shop/db', file: 'shop-1.tar.age', container: CONTAINER, url: URL, recipients: [RECIPIENT] }),
    measureScript('/var/backups/shop/db/shop-1.tar.age'), decryptScript('/var/backups/shop/db/shop-1.tar.age'),
  ]) assert.equal(spawnSync('bash', ['-n', '-c', script]).status, 0, script);
});

test('a container id or recipient that is not plain is refused before any command is composed', () => {
  const base = { dir: '/var/backups/shop/db', file: 'shop-1.tar.age', container: CONTAINER, url: URL, recipients: [RECIPIENT] };
  assert.throws(() => dumpScript({ ...base, container: 'abc; rm -rf /' }), /STACK_DEPLOY_BACKUP_FAILED/u);
  assert.throws(() => dumpScript({ ...base, recipients: [] }), /at least one age recipient/u);
  assert.throws(() => dumpScript({ ...base, recipients: ["age1'; touch x; '"] }), /plain age1/u);
});

/** A runner double that answers each remote command by what it is; `commands` records them. */
function runner(answers: { dump?: RemoteResult; measure?: RemoteResult; decrypt?: RemoteResult } = {}) {
  const commands: { command: string; input: string | undefined }[] = [];
  const sha = 'a'.repeat(64);
  const run = ((command: string, options?: { input?: string | undefined }): RemoteResult => {
    commands.push({ command, input: options?.input });
    if (command.includes('pg_dump')) return answers.dump ?? { status: 0, stdout: `${sha}\n4096\n[{"schema":"public","table":"orders","count":"7"},{"schema":"public","table":"items","count":"5"}]\n`, stderr: '' };
    if (command.includes('exists=1')) return answers.measure ?? { status: 0, stdout: `exists=1\nbytes=4096\nsha256=${sha}\nheader=1\n`, stderr: '' };
    if (command.startsWith('if [ "$(id -u)"')) return answers.decrypt ?? { status: 0, stdout: './roles.sql\n./schema.sql\n./data.sql\n./rowcounts.json\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  }) as Runner;
  return { run, commands, sha };
}

test('the manager backup writes a receipt from the dump and judges it against a second reading of the archive', async () => {
  const { run, commands, sha } = runner();
  const made = await managerBackup(CTX, CONFIG, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT], at: '2026-10-31T10:00:00.000Z' });
  assert.equal(made.archive, '/var/backups/shop/db/shop-20261031T100000000Z.tar.age');
  assert.equal(made.receiptPath, '/var/backups/shop/db/shop-20261031T100000000Z.receipt.json');
  assert.equal(made.receipt.bytes, 4096);
  assert.equal(made.receipt.sha256, sha);
  assert.equal(made.receipt.schemaOnly, false);
  assert.deepEqual(made.receipt.parts, ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);
  assert.deepEqual((made.receipt as unknown as { rowcounts: unknown }).rowcounts, { tables: 2, rows: '12' });
  assert.deepEqual(backupProblems(made.receipt, made.facts, Date.parse('2026-10-31T10:00:00.000Z')), []);
  const written = commands.find((entry) => entry.input !== undefined)!;
  assert.ok(written.command.includes('cat > ') && written.command.includes('shop-20261031T100000000Z.receipt.json'));
  assert.equal(JSON.parse(written.input!).sha256, sha);
  assert.ok(commands.every((entry) => !entry.command.includes('s3cret')));
});

test('a truncated archive (the second reading disagrees with the receipt) is not verified', async () => {
  const { run } = runner({ measure: { status: 0, stdout: `exists=1\nbytes=100\nsha256=${'b'.repeat(64)}\nheader=1\n`, stderr: '' } });
  const made = await managerBackup(CTX, CONFIG, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT], at: '2026-10-31T10:00:00.000Z' });
  const problems = backupProblems(made.receipt, made.facts, Date.parse('2026-10-31T10:00:00.000Z'));
  assert.equal(problems.length, 2);
  assert.match(problems.join(';'), /archive is 100 bytes, the receipt says 4096/u);
  assert.match(problems.join(';'), /sha256 differs/u);
  assert.deepEqual(backupProblems(made.receipt, { exists: false, size: 0, header: false, sha256: '' }, 0), ['the archive is missing']);
  assert.ok(backupProblems(made.receipt, { ...made.facts, header: false }, 0).includes('the archive has no age header'));
});

test('a failed dump is a failure that withholds the tool output', async () => {
  const { run } = runner({ dump: { status: 1, stdout: '', stderr: 'pg_dump: password for appowner s3cret' } });
  await assert.rejects(managerBackup(CTX, CONFIG, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT], at: '2026-10-31T10:00:00.000Z' }), (error: Error) => /STACK_DEPLOY_BACKUP_FAILED/u.test(error.message) && !error.message.includes('s3cret'));
});

test('the test decrypt runs as root with the manager identity and lists the parts; a failure names the likely cause', async () => {
  const ok = runner();
  assert.deepEqual(await managerDecrypt(CTX, { run: ok.run, archive: '/var/backups/shop/db/shop-1.tar.age' }), ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);
  assert.ok(ok.commands[0]!.input!.includes('/root/.config/sops/age/keys.txt'));
  const bad = runner({ decrypt: { status: 1, stdout: '', stderr: 'no identity matched' } });
  await assert.rejects(managerDecrypt(CTX, { run: bad.run, archive: '/var/backups/shop/db/shop-1.tar.age' }), /server recipient in \.sops\.yaml/u);
  await assert.rejects(managerDecrypt(CTX, { run: ok.run, archive: '/var/backups/x; rm -rf /' }), /plain absolute path/u);
});

// The script run for real under bash with a docker, age and psql that only echo: the quoting survives the nesting, the archive and its measures come
// out, the plaintext scratch directory is gone afterwards, and a failing step leaves no archive and no partial file.
const FAKE_DOCKER = [
  '#!/bin/sh', 'tool="$7"; shift 7', 'case "$tool" in',
  `  psql) echo '[{"schema":"public","table":"t","count":"3"}]' ;;`,
  '  pg_dumpall|pg_dump) [ -z "$FAKE_FAIL" ] || exit 1; echo "-- dump by $tool" ;;', 'esac',
].join('\n');
const FAKE_AGE = [
  '#!/bin/sh', 'out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; last="$1"; shift; done',
  `printf 'age-encryption.org/v1\\n' > "$out"; cat "$last" >> "$out"`,
].join('\n');

test('the dump script, run under bash with doubles for docker and age, writes a verifiable archive and cleans up', { skip: !hasBash }, () => {
  const work = spawnSync('bash', ['-c', 'd=$(mktemp -d); mkdir "$d/bin"; echo "$d"'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(work.length > 0);
  try {
    const write = (name: string, body: string) => spawnSync('bash', ['-c', `cat > ${work}/bin/${name} && chmod +x ${work}/bin/${name}`], { input: `${body}\n` });
    write('docker', FAKE_DOCKER);
    write('age', FAKE_AGE);
    const dump = (fail: boolean) => spawnSync('bash', ['-c', dumpScript({ dir: `${work}/out`, file: 'shop-1.tar.age', container: CONTAINER, url: URL, recipients: [RECIPIENT] })], { encoding: 'utf8', env: { ...process.env, PATH: `${work}/bin:${process.env.PATH}`, ...(fail ? { FAKE_FAIL: '1' } : {}) } });
    const good = dump(false);
    assert.equal(good.status, 0, good.stderr);
    const [sha, bytes, ...rest] = good.stdout.split('\n');
    assert.match(sha!, /^[a-f0-9]{64}$/u);
    assert.match(bytes!, /^\d+$/u);
    assert.ok(rest.join('\n').includes('"count":"3"'), 'the row counts come back');
    const listing = spawnSync('bash', ['-c', `ls -A ${work}/out`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    assert.deepEqual(listing, ['shop-1.tar.age'], 'no scratch directory and no partial file is left');
    const measured = spawnSync('bash', ['-c', measureScript(`${work}/out/shop-1.tar.age`)], { encoding: 'utf8' });
    assert.match(measured.stdout, /exists=1\nbytes=\d+\nsha256=[a-f0-9]{64}\nheader=1/u);
    assert.ok(measured.stdout.includes(`sha256=${sha}`) && measured.stdout.includes(`bytes=${bytes}`));
    spawnSync('bash', ['-c', `rm -rf ${work}/out`]);
    const bad = dump(true);
    assert.notEqual(bad.status, 0);
    assert.deepEqual(spawnSync('bash', ['-c', `ls -A ${work}/out`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean), [], 'a failed dump leaves no archive, no partial file and no plaintext');
  } finally {
    spawnSync('bash', ['-c', `rm -rf ${work}`]);
  }
});

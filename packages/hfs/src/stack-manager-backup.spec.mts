// The database backup made on the manager (stack/manager-backup.mts over the named operations of stack/backup-ops.mts): every remote step is a
// named operation whose arguments are checked first, no password or URL secret is in a command, the dump never leaves a root-private scratch
// directory, and the receipt is judged against a second reading of the archive. The runner is a double; the operations run for real under bash
// (ungated, `sh -c`) and through the generated gate (gated, `starci-op`) with doubles for docker, age, id and sudo, where bash exists.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPath, withPath } from '../runtime/scripts/lib/env.mjs';
import { backupCommand, backupFolder, dumpArguments, managerBackup, managerDecrypt } from '../stack/manager-backup.mjs';
import { backupProblems } from '../stack/db-phases.mjs';
import { gateScript } from '../stack/ssh-gate.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import type { RemoteResult, Runner } from '../stack/remote.mjs';

const RECIPIENT = `age1${'q'.repeat(58)}`;
const SERVER = `age1${'z'.repeat(58)}`;
const CONTAINER = 'abcdef012345';
const URL = 'postgresql://appowner@127.0.0.1:5432/appdb';
const NAME = 'shop-20261031T100000000Z';
const CONFIG = { stack: 'shop', project: 'shop', backup: null } as unknown as DeployConfig; // reason: the backup reads stack, project and backup only
const CTX = {} as unknown as StackContext; // reason: an ungated context; the backup reads only env
const GATED = { env: { STARCI_SSH_GATE: '1' } } as unknown as StackContext; // reason: the backup reads only env

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const posix = (file: string) => (process.platform === 'win32' ? file.replace(/^([A-Za-z]):/u, (_all, drive: string) => `/${drive.toLowerCase()}`) : file).split(path.sep).join('/');

test('the backup folder is the volume backup folder plus db, and an unsafe folder is refused', () => {
  assert.equal(backupFolder({ stack: 'shop', backup: null }), '/var/backups/shop/db');
  assert.equal(backupFolder({ stack: 'shop', backup: { image: 'x', keepDays: 1, dir: '/srv/backups', volumes: [] } }), '/srv/backups/db');
  assert.throws(() => backupFolder({ stack: 'shop', backup: { image: 'x', keepDays: 1, dir: '/srv/../etc', volumes: [] } }), /STACK_DEPLOY_BACKUP_DIR/u);
});

test('the dump takes the role and database of the container URL, never a password, and refuses anything not plain', () => {
  const base = { dir: '/var/backups/shop/db', name: NAME, container: CONTAINER, url: URL, recipients: [RECIPIENT, SERVER] };
  assert.deepEqual(dumpArguments(base), ['/var/backups/shop/db', NAME, CONTAINER, 'appowner', 'appdb', `${RECIPIENT},${SERVER}`]);
  assert.throws(() => dumpArguments({ ...base, container: 'abc; rm -rf /' }), /STACK_DEPLOY_BACKUP_FAILED/u);
  assert.throws(() => dumpArguments({ ...base, recipients: [] }), /at least one age recipient/u);
  assert.throws(() => dumpArguments({ ...base, recipients: ["age1'; touch x; '"] }), /plain age1/u);
  for (const url of ['postgresql://appowner:s3cret@127.0.0.1:5432/appdb', 'postgresql://appowner@db.example:5432/appdb', 'postgresql://app%3Bid@127.0.0.1:5432/appdb', 'postgresql://appowner@127.0.0.1:5432/app;db']) {
    assert.throws(() => dumpArguments({ ...base, url }), /not the container's own/u, url);
  }
});

test('the four steps are named operations: starci-op under the gate, the same body under sh -c without it', () => {
  const args = dumpArguments({ dir: '/var/backups/shop/db', name: NAME, container: CONTAINER, url: URL, recipients: [RECIPIENT] });
  assert.equal(backupCommand(GATED, 'db-dump', args), `starci-op db-dump ${args.join(' ')}`);
  assert.equal(backupCommand(GATED, 'db-measure', ['/var/backups/shop/db', NAME]), `starci-op db-measure /var/backups/shop/db ${NAME}`);
  const inline = backupCommand(CTX, 'db-dump', args);
  assert.ok(inline.startsWith("sh -c 'umask 077;") && inline.endsWith(` starci-op '/var/backups/shop/db' '${NAME}' '${CONTAINER}' 'appowner' 'appdb' '${RECIPIENT}'`), inline);
  assert.ok(inline.includes('POSTGRES_PASSWORD_FILE') && !inline.includes('s3cret'), 'the container reads its own secret file');
  assert.ok(!inline.includes('\n'), 'one line, so the remote shell quoting stays whole');
  for (const bad of [['/var/backups/shop/db', 'shop-1'], ['/var/backups/../etc', NAME], ['/var/backups/shop/db', `${NAME};id`]]) {
    assert.throws(() => backupCommand(GATED, 'db-measure', bad), (error: { code?: string }) => error.code === 'STACK_GATE_ARGUMENT', bad.join(' '));
  }
});

/** A runner double that answers each remote command by what it is; `commands` records them. */
function runner(answers: { dump?: RemoteResult; measure?: RemoteResult; decrypt?: RemoteResult } = {}) {
  const commands: { command: string; input: string | undefined }[] = [];
  const sha = 'a'.repeat(64);
  const run = ((command: string, options?: { input?: string | undefined }): RemoteResult => {
    commands.push({ command, input: options?.input });
    if (/db-dump|pg_dump/u.test(command)) return answers.dump ?? { status: 0, stdout: `${sha}\n4096\n[{"schema":"public","table":"orders","count":"7"},{"schema":"public","table":"items","count":"5"}]\n`, stderr: '' };
    if (/db-measure|exists=1/u.test(command)) return answers.measure ?? { status: 0, stdout: `exists=1\nbytes=4096\nsha256=${sha}\nheader=1\n`, stderr: '' };
    if (/db-decrypt|docker run --rm -i/u.test(command)) return answers.decrypt ?? { status: 0, stdout: './roles.sql\n./schema.sql\n./data.sql\n./rowcounts.json\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  }) as Runner;
  return { run, commands, sha };
}

test('the manager backup writes a receipt from the dump and judges it against a second reading of the archive', async () => {
  const { run, commands, sha } = runner();
  const made = await managerBackup(CTX, CONFIG, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT], at: '2026-10-31T10:00:00.000Z' });
  assert.equal(made.archive, `/var/backups/shop/db/${NAME}.tar.age`);
  assert.equal(made.receiptPath, `/var/backups/shop/db/${NAME}.receipt.json`);
  assert.equal(made.receipt.bytes, 4096);
  assert.equal(made.receipt.sha256, sha);
  assert.equal(made.receipt.schemaOnly, false);
  assert.deepEqual(made.receipt.parts, ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);
  assert.deepEqual((made.receipt as unknown as { rowcounts: unknown }).rowcounts, { tables: 2, rows: '12' });
  assert.deepEqual(backupProblems(made.receipt, made.facts, Date.parse('2026-10-31T10:00:00.000Z')), []);
  const written = commands.find((entry) => entry.input !== undefined)!;
  assert.equal(written.command, backupCommand(CTX, 'db-receipt', ['/var/backups/shop/db', NAME]));
  assert.equal(JSON.parse(Buffer.from(written.input!.trim(), 'base64').toString('utf8')).sha256, sha);
  assert.ok(commands.every((entry) => !entry.command.includes('s3cret')));
});

test('under the gate the backup sends only starci-op commands', async () => {
  const { run, commands } = runner();
  const made = await managerBackup(GATED, CONFIG, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT, SERVER], at: '2026-10-31T10:00:00.000Z' });
  await managerDecrypt(GATED, { run, archive: made.archive, container: CONTAINER });
  assert.deepEqual(commands.map((entry) => entry.command.split(' ').slice(0, 2).join(' ')), ['starci-op db-dump', 'starci-op db-receipt', 'starci-op db-measure', 'starci-op db-decrypt']);
  assert.equal(commands[3]!.command, `starci-op db-decrypt /var/backups/shop/db ${NAME} ${CONTAINER}`);
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

test('the test decrypt lists the parts; a failure names the likely cause and an unsafe archive or container is refused', async () => {
  const ok = runner();
  const archive = `/var/backups/shop/db/${NAME}.tar.age`;
  assert.deepEqual(await managerDecrypt(CTX, { run: ok.run, archive, container: CONTAINER }), ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);
  assert.ok(ok.commands[0]!.command.includes('/root/.config/sops/age/keys.txt'));
  assert.equal(ok.commands[0]!.input, undefined, 'the decrypt script is part of the operation, nothing is sent on stdin');
  const bad = runner({ decrypt: { status: 1, stdout: '', stderr: 'no identity matched' } });
  await assert.rejects(managerDecrypt(CTX, { run: bad.run, archive, container: CONTAINER }), /server recipient in \.sops\.yaml/u);
  for (const unsafe of ['/var/backups/x; rm -rf /', '/var/backups/../etc/shop-20261031T100000000Z.tar.age', '/var/backups/shop/db/other.tar.age']) {
    await assert.rejects(managerDecrypt(CTX, { run: ok.run, archive: unsafe, container: CONTAINER }), /plain absolute path/u, unsafe);
  }
  await assert.rejects(managerDecrypt(CTX, { run: ok.run, archive, container: 'abc; rm -rf /' }), /container id is not a plain id/u);
});

test('without root or passwordless sudo the decrypt runs in a container of the database image that sees only the identity, the archive and age, read-only', () => {
  const command = backupCommand(CTX, 'db-decrypt', ['/var/backups/shop/db', NAME, CONTAINER]);
  assert.ok(command.includes('if [ "$(id -u)" -eq 0 ]; then sh -s "$f"; elif sudo -n true 2>/dev/null; then sudo -n sh -s "$f"; else '), 'root, then sudo only when it answers');
  assert.ok(command.includes(`docker inspect --format '\\''{{.Image}}'\\'' "$c"`), "the image is the running database container's own");
  assert.ok(command.includes('docker run --rm -i --network none --user 0:0 --entrypoint sh '));
  assert.deepEqual(command.match(/--mount "[^"]*/gu), ['--mount "type=bind,src=/root/.config/sops/age/keys.txt,dst=/root/.config/sops/age/keys.txt,readonly', '--mount "type=bind,src=$f,dst=$f,readonly', '--mount "type=bind,src=$(readlink -f ']);
  assert.ok(command.includes('dst=/usr/local/bin/age,readonly"'), "the manager's age, read-only, where the script's PATH finds it");
  assert.ok(!/\s-v\s+\/|--volume|--privileged|--network host|--pid|--cap-add/u.test(command), 'no other mount, privilege or namespace');
});

/** Doubles: the login is not root, sudo answers when FAKE_SUDO is set, docker answers the dump's tools, the image inspect and the decrypt run. */
const FAKE_ID = ['#!/bin/sh', 'echo 1000'].join('\n');
const FAKE_SUDO = ['#!/bin/sh', '[ -n "$FAKE_SUDO" ] || exit 1', 'shift', 'if [ "$1" = true ]; then exit 0; fi', 'echo "sudo $*" >> "$LOG"', 'cat >/dev/null', 'echo ./roles.sql'].join('\n');
const FAKE_DOCKER = [
  '#!/bin/sh',
  'if [ "$1" = inspect ]; then echo sha256:feed; exit 0; fi',
  'if [ "$1" = run ]; then echo "docker $*" >> "$LOG"; cat >/dev/null; echo ./roles.sql; exit 0; fi',
  'tool="$7"; shift 7', 'case "$tool" in',
  `  psql) echo '[{"schema":"public","table":"t","count":"3"}]' ;;`,
  '  pg_dumpall|pg_dump) [ -z "$FAKE_FAIL" ] || exit 1; echo "-- dump by $tool" ;;', 'esac',
].join('\n');
const FAKE_AGE = [
  '#!/bin/sh', 'out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; last="$1"; shift; done',
  `printf 'age-encryption.org/v1\\n' > "$out"; cat "$last" >> "$out"`,
].join('\n');

/** A scratch manager: the doubles on PATH, the generated gate, and a runner over either path (`gated`: through the gate as sshd would run it). */
function manager(t: TestContext) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-backup-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin);
  for (const [name, body] of [['id', FAKE_ID], ['sudo', FAKE_SUDO], ['docker', FAKE_DOCKER], ['age', FAKE_AGE]] as const) fs.writeFileSync(path.join(bin, name), `${body}\n`, { mode: 0o755 });
  const gate = path.join(work, 'starci-ssh-gate');
  fs.writeFileSync(gate, gateScript(), { mode: 0o755 });
  const log = path.join(work, 'log');
  const runnerOf = (gated: boolean, extra: NodeJS.ProcessEnv = {}): Runner => ((command: string, options?: { input?: string | undefined }): RemoteResult => {
    const env = { ...withPath(process.env, `${bin}${path.delimiter}${readPath()}`), LOG: posix(log), ...extra, ...(gated ? { SSH_ORIGINAL_COMMAND: command } : {}) };
    const result = spawnSync(gated ? 'sh' : 'bash', gated ? [posix(gate)] : ['-c', command], { input: options?.input, encoding: 'utf8', env, windowsHide: true });
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }) as Runner;
  const config = { stack: 'shop', project: 'shop', backup: { image: 'x', keepDays: 1, dir: posix(path.join(work, 'out')), volumes: [] } } as unknown as DeployConfig; // reason: as CONFIG
  const read = (file: string): string => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  return { work, runnerOf, config, log: () => read(log), dir: path.join(work, 'out', 'db') };
}

for (const gated of [false, true]) {
  test(`the backup runs for real ${gated ? 'through the gate' : 'under sh -c'}: a verifiable archive, its receipt, nothing left behind, and the test decrypt`, { skip: !hasBash }, async (t) => {
    const scene = manager(t);
    const ctx = gated ? GATED : CTX;
    const made = await managerBackup(ctx, scene.config, { run: scene.runnerOf(gated), container: CONTAINER, url: URL, recipients: [RECIPIENT, SERVER], at: '2026-10-31T10:00:00.000Z' });
    assert.deepEqual(backupProblems(made.receipt, made.facts, Date.parse('2026-10-31T10:00:00.000Z')), []);
    assert.deepEqual((made.receipt as unknown as { rowcounts: unknown }).rowcounts, { tables: 1, rows: '3' });
    assert.deepEqual(fs.readdirSync(scene.dir).sort(), [`${NAME}.receipt.json`, `${NAME}.tar.age`], 'no scratch directory, partial or temp file is left');
    assert.equal(JSON.parse(fs.readFileSync(path.join(scene.dir, `${NAME}.receipt.json`), 'utf8')).sha256, made.receipt.sha256);
    assert.deepEqual(await managerDecrypt(ctx, { run: scene.runnerOf(gated, { FAKE_SUDO: '1' }), archive: made.archive, container: CONTAINER }), ['roles.sql']);
    assert.equal(scene.log().trim(), `sudo sh -s ${made.archive}`, 'sudo where it answers');
    assert.deepEqual(await managerDecrypt(ctx, { run: scene.runnerOf(gated), archive: made.archive, container: CONTAINER }), ['roles.sql']);
    assert.match(scene.log(), /^docker run --rm -i --network none --user 0:0 --entrypoint sh --mount type=bind,src=\/root\/\.config\/sops\/age\/keys\.txt,dst=\/root\/\.config\/sops\/age\/keys\.txt,readonly --mount type=bind,src=(\S+)\.tar\.age,dst=\1\.tar\.age,readonly --mount type=bind,src=\S+\/bin\/age,dst=\/usr\/local\/bin\/age,readonly sha256:feed -s \S+\.tar\.age$/mu);
  });
}

test('a failed dump leaves no archive, no partial file and no plaintext; a receipt is written only beside an archive', { skip: !hasBash }, async (t) => {
  const scene = manager(t);
  const run = scene.runnerOf(true, { FAKE_FAIL: '1' });
  await assert.rejects(managerBackup(GATED, scene.config, { run, container: CONTAINER, url: URL, recipients: [RECIPIENT], at: '2026-10-31T10:00:00.000Z' }), /STACK_DEPLOY_BACKUP_FAILED/u);
  assert.deepEqual(fs.readdirSync(scene.dir), []);
  const dir = posix(scene.dir);
  assert.notEqual(run(backupCommand(GATED, 'db-receipt', [dir, NAME]), { input: `${Buffer.from('{}').toString('base64')}\n` }).status, 0);
  assert.deepEqual(fs.readdirSync(scene.dir), []);
  assert.equal(run(backupCommand(GATED, 'db-measure', [dir, NAME])).stdout, 'exists=0\n');
});

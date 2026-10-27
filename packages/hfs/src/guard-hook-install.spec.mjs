import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { historyHookBody } from '../runtime/scripts/guards/hook-install.mjs';
import { isGuardCommand, toolGuardCommand } from '../runtime/scripts/lib/guard-command.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-hook-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime with spaces');
  const bin = path.join(runtime, 'packages', 'cli', 'bin');
  mkdirSync(bin, { recursive: true });
  const cliPath = path.join(bin, 'starci.mjs');
  writeFileSync(cliPath, 'throw new Error("runtime CLI unavailable");\n');
  const hook = path.join(root, 'reference-transaction');
  const terminals = path.join(root, 'terminals');
  const nodePath = path.join(root, 'missing node', 'node.exe');
  writeFileSync(hook, historyHookBody({ root: runtime, nodePath, terminals }));
  return { root, hook, cliPath, runtime, terminals, env: { ...process.env, STARCI_ROLE: '', ORCA_TERMINAL_HANDLE: '',
    STARCI_TEMP_ROOT: root, STARCI_LOCAL_ROOT: path.join(root, 'state'),
    STARCI_GUARDS_ROOT: path.join(root, 'guards'), STARCI_OWNER_CONFIG_WITHIN: root } };
}

const STDIN_SENTINEL = 'X';
const HISTORY_TIMEOUT_MS = 120_000;

/**
 * Runs the hook with finite file-backed stdin. Without explicit input, the shared file position proves that even
 * a partial read is refused; elapsed time never decides whether stdin was consumed.
 */
async function runHistory(t, options, { phase = 'prepared', input = null } = {}) {
  const stdinFile = path.join(options.root, `stdin-${phase}`);
  writeFileSync(stdinFile, input ?? `${STDIN_SENTINEL}${'c'.repeat(40)} ${'d'.repeat(40)} refs/heads/probe\n`);
  const stdin = openSync(stdinFile, 'r');
  t.after(() => closeSync(stdin));
  const child = spawn('sh', [options.hook, phase], { env: options.env, cwd: options.root,
    stdio: [stdin, 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const exited = await result;
  if (input === null) {
    const next = Buffer.alloc(1);
    readSync(stdin, next, 0, 1, null);
    assert.equal(next.toString(), STDIN_SENTINEL, 'the history hook read stdin it was not handed');
  }
  assert.equal(exited.signal, null, stderr);
  return { ...exited, stdout, stderr };
}

test('hook command rendering quotes absolute native paths and recognizes commands to refresh', (t) => {
  const { root, cliPath } = fixture(t);
  const nodePath = path.join(root, 'Program Files', 'nodejs', 'node.exe');
  const rendered = toolGuardCommand({ nodePath: nodePath.replaceAll('/', '\\'), cliPath: cliPath.replaceAll('/', '\\') });
  assert.equal(rendered, `"${nodePath.replaceAll('\\', '/')}" "${cliPath.replaceAll('\\', '/')}" guard command`);
  const launcher = path.join(root, '.starci', 'bin', 'starci').replaceAll('\\', '/');
  for (const command of [rendered, 'starci guard command', `"${launcher}" guard command`,
    `"${launcher}.cmd" guard command`, 'exec "$HOME/.starci/bin/starci" guard command']) {
    assert.equal(isGuardCommand(command), true, command);
  }
  assert.equal(isGuardCommand('starci guard seat-tools'), false);
  assert.equal(isGuardCommand('other guard command'), false);
});

test('the installed direct Node hook command executes through the native shell with spaces in its CLI path', (t) => {
  const options = fixture(t);
  writeFileSync(options.cliPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  const result = spawnSync(toolGuardCommand({ cliPath: options.cliPath }), {
    shell: true, env: options.env, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error ?? ''));
  assert.deepEqual(JSON.parse(result.stdout), ['guard', 'command']);
});

test('completed and aborted history transactions exit without consuming stdin or starting Node', { timeout: HISTORY_TIMEOUT_MS }, async (t) => {
  const options = fixture(t);
  await Promise.all(['committed', 'aborted'].map(async (phase) => {
    const result = await runHistory(t, options, { phase });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }));
});

test('unprotected ref updates do not depend on Node, the runtime path or CLI startup', { timeout: HISTORY_TIMEOUT_MS }, async (t) => {
  const options = fixture(t);
  const input = `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/feature\n`;
  const variants = [
    { root: options.runtime, nodePath: path.join(options.root, 'missing-node.exe') },
    { root: path.join(options.root, 'missing-runtime'), nodePath: process.execPath },
    { root: options.runtime, nodePath: process.execPath },
  ];
  mkdirSync(options.terminals, { recursive: true });
  writeFileSync(path.join(options.terminals, 'op-seat.json'), JSON.stringify({ role: 'op' }));
  options.env.ORCA_TERMINAL_HANDLE = 'op-seat';
  for (const variant of variants) {
    writeFileSync(options.hook, historyHookBody({ ...variant, terminals: options.terminals }));
    const result = await runHistory(t, options, { input });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('a complete history request preserves protected-main refusal and the committed-phase verdict', { timeout: HISTORY_TIMEOUT_MS }, async (t) => {
  const options = fixture(t);
  const deletion = `${'a'.repeat(40)} ${'0'.repeat(40)} refs/heads/main\n`;
  const refused = await runHistory(t, options, { input: deletion });
  assert.equal(refused.code, 1, refused.stderr);
  assert.match(refused.stderr, /refused deleting protected branch main/);
  const committed = await runHistory(t, options, { phase: 'committed', input: deletion });
  assert.equal(committed.code, 0, committed.stderr);
  assert.equal(committed.stderr, '');
});

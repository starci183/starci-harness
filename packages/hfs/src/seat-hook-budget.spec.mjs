import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runHookVerdict } from '../runtime/scripts/guards/verdict-process.mjs';
import { HOOK_INPUT_LIMITS } from '../runtime/scripts/guards/hook-io.mjs';
import { assertJsonToolGuard, codexGuardBlock, writeDevinProfile } from '../runtime/scripts/agent/trust.mjs';

const bundledRoot = fileURLToPath(new URL('../runtime/', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-seat-hook-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, STARCI_ROLE: '', ORCA_TERMINAL_HANDLE: '',
    STARCI_TEMP_ROOT: root, STARCI_LOCAL_ROOT: path.join(root, 'state'),
    STARCI_GUARDS_ROOT: path.join(root, 'guards'), STARCI_OWNER_CONFIG_WITHIN: root };
  return { root, env };
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};

test('the complete input, verdict, teardown and output budgets fit inside the generated host timeout', () => {
  const block = codexGuardBlock('fixture guard command');
  const seconds = Number(/^timeout = (\d+)$/m.exec(block)?.[1]);
  assert.equal(seconds, HOOK_INPUT_LIMITS.hookTimeoutSeconds);
  const total = HOOK_INPUT_LIMITS.minInputWindowMs + HOOK_INPUT_LIMITS.verdictTimeoutMs
    + HOOK_INPUT_LIMITS.teardownTimeoutMs + 2 * HOOK_INPUT_LIMITS.outputTimeoutMs;
  assert.ok(total < seconds * 1000, `${total} ms must fit below ${seconds} seconds`);
});

test('generated Claude and Devin guard settings use the shared host timeout', (t) => {
  const { root } = fixture(t);
  for (const [provider, writeGuard] of [['claude', assertJsonToolGuard], ['devin', writeDevinProfile]]) {
    const file = path.join(root, provider, 'settings.json');
    const command = 'starci guard command';
    const result = writeGuard({ file, command });
    assert.equal(result.ok, true, JSON.stringify(result));
    const hook = JSON.parse(readFileSync(file, 'utf8')).hooks.PreToolUse[0].hooks[0];
    assert.equal(hook.command, command);
    assert.equal(hook.timeout, HOOK_INPUT_LIMITS.hookTimeoutSeconds);
  }
});

test('Kernel and Supervisor hook refusals do not start a sleeping status diagnostic', (t) => {
  const { root, env } = fixture(t);
  const marker = path.join(root, 'status-started.json');
  const slowStatus = path.join(root, 'slow-status.mjs');
  writeFileSync(slowStatus, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n`);
  const preload = path.join(root, 'replace-status.mjs');
  writeFileSync(preload, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (args?.some((arg) => /scripts[\\\\/]kernel[\\\\/]cli\\.mjs$|scripts[\\\\/]supervisor[\\\\/]status\\.mjs$/.test(String(arg)))) {
    return original(process.execPath, [${JSON.stringify(slowStatus)}], { ...options, timeout: 1000 });
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
`);
  const probe = path.join(root, 'status-probe.mjs');
  writeFileSync(probe, `import { spawnSync } from 'node:child_process';\nspawnSync(process.execPath, [${JSON.stringify(path.join(root, 'scripts', 'kernel', 'cli.mjs'))}, 'status']);\n`);
  const statusEnv = { ...env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  const probed = spawnSync(process.execPath, [probe], { env: statusEnv, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(probed.status, 0, probed.stderr || String(probed.error ?? ''));
  assert.equal(existsSync(marker), true, 'the sleeping status fixture was not installed');
  rmSync(marker);
  const terminals = path.join(env.STARCI_GUARDS_ROOT, 'terminals');
  const seats = path.join(env.STARCI_GUARDS_ROOT, 'seats');
  mkdirSync(terminals, { recursive: true });
  mkdirSync(seats, { recursive: true });
  writeFileSync(path.join(terminals, 'kernel-seat.json'), JSON.stringify({ role: 'kernel', ledgerRepo: root, workflowId: 'fixture' }));
  writeFileSync(path.join(seats, 'supervisor-seat.json'), JSON.stringify({ role: 'supervisor' }));
  for (const [handle, command, code] of [
    ['kernel-seat', 'starci kernel finish', 'KERNEL_USE_DECIDE'],
    ['supervisor-seat', 'starci supervisor create', 'SUPERVISOR_USE_DECIDE'],
  ]) {
    const started = performance.now();
    const result = spawnSync(process.execPath, [path.join(bundledRoot, 'scripts', 'guards', 'command-guard.mjs')], {
      env: { ...statusEnv, ORCA_TERMINAL_HANDLE: handle },
      input: JSON.stringify({ tool_name: 'Bash', cwd: root, tool_input: { command } }),
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(result.status, 2, result.stderr || String(result.error ?? ''));
    assert.match(result.stderr, new RegExp(code));
    assert.ok(performance.now() - started < HOOK_INPUT_LIMITS.verdictTimeoutMs, 'refusal exceeded its verdict budget');
    assert.equal(existsSync(marker), false, 'refusal started a status subprocess');
  }
});

test('the verifier deadline interrupts synchronous work and terminates only its owned process tree', async (t) => {
  const { root, env } = fixture(t);
  const pidsFile = path.join(root, 'pids.json');
  const blocked = path.join(root, 'blocked-verifier.mjs');
  writeFileSync(blocked, `import { spawn } from 'node:child_process';
import fs from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000);'], { stdio: 'ignore', windowsHide: true });
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, child.pid]));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
`);
  let verifier;
  t.after(() => {
    if (verifier?.exitCode === null) verifier.kill('SIGKILL');
    if (existsSync(pidsFile)) {
      for (const pid of JSON.parse(readFileSync(pidsFile, 'utf8'))) {
        if (alive(pid)) process.kill(pid, 'SIGKILL');
      }
    }
  });
  const started = performance.now();
  await assert.rejects(runHookVerdict({ input: {}, env, timeoutMs: 1000,
    start: (_args, options) => { verifier = spawn(process.execPath, [blocked], { ...options, windowsHide: true }); return verifier; },
  }), /deadline/);
  assert.ok(performance.now() - started < 1000 + HOOK_INPUT_LIMITS.teardownTimeoutMs + 1000);
  assert.equal(existsSync(pidsFile), true, 'the blocking verifier did not start');
  const pids = JSON.parse(readFileSync(pidsFile, 'utf8'));
  for (let attempt = 0; attempt < 20 && pids.some(alive); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(pids.filter(alive), [], 'the verifier left a live child or descendant');
});

test('a late verifier decision cannot replace its expired deadline with an allow', async (t) => {
  const { root, env } = fixture(t);
  const late = path.join(root, 'late-verifier.mjs');
  writeFileSync(late, `process.once('message', () => setTimeout(() => process.send({ ok: true, decision: null }), 500));\n`);
  await assert.rejects(runHookVerdict({ input: {}, env, timeoutMs: 100,
    start: (_args, options) => spawn(process.execPath, [late], { ...options, windowsHide: true }),
  }), /deadline/);
});

test('a verifier close delivered before an expired timer still cannot admit an overdue allow', async (t) => {
  const { root, env } = fixture(t);
  const allow = path.join(root, 'allow-verifier.mjs');
  writeFileSync(allow, `process.once('message', () => process.send({ ok: true, decision: null }, () => process.exit(0)));\n`);
  await assert.rejects(runHookVerdict({ input: {}, env, timeoutMs: 1000,
    start: (_args, options) => {
      const child = spawn(process.execPath, [allow], { ...options, windowsHide: true });
      const emit = child.emit;
      child.emit = function (event, ...args) {
        if (event === 'close') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
        return emit.call(this, event, ...args);
      };
      return child;
    },
  }), /deadline/);
});

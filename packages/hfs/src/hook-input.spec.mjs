import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOOK_INPUT_LIMITS, readInput, writeHookOutput } from '../runtime/scripts/guards/hook-io.mjs';
import { main as commandMain } from '../runtime/scripts/guards/command-guard.mjs';
import { main as seatMain } from '../runtime/scripts/guards/seat-tools.mjs';
import { main as pushMain, pushRefusals } from '../runtime/scripts/guards/release-push-gate.mjs';

const bundledRoot = fileURLToPath(new URL('../runtime/', import.meta.url));
const hookFiles = [
  { file: 'command-guard.mjs', code: 0 },
  { file: 'seat-tools.mjs', code: 0 },
  { file: 'release-push-gate.mjs', code: 1 },
];

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-hook-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, STARCI_ROLE: '', ORCA_TERMINAL_HANDLE: '',
    STARCI_TEMP_ROOT: root, STARCI_LOCAL_ROOT: path.join(root, 'state'),
    STARCI_GUARDS_ROOT: path.join(root, 'guards'), STARCI_OWNER_CONFIG_WITHIN: root };
  return { root, env };
}

async function runHook(t, { file, env, input = null, preload = null, closeInput = false }) {
  const args = [...(preload ? ['--import', pathToFileURL(preload).href] : []), path.join(bundledRoot, 'scripts', 'guards', file)];
  const started = performance.now();
  const child = spawn(process.execPath, args, {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: HOOK_INPUT_LIMITS.minInputWindowMs + 3_000,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  // A bounded reader may close its pipe while the oversized write is still buffered in the parent.
  child.stdin.on('error', (error) => { if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (closeInput) child.stdin.end(input);
  else if (input !== null) child.stdin.write(input);
  const exited = await result;
  child.stdin.destroy();
  return { ...exited, stdout, stderr, elapsed: performance.now() - started, killed: child.killed };
}

test('the hook read has an absolute deadline even while bytes continue arriving', { timeout: 1_500 }, async () => {
  const stream = new PassThrough();
  const started = performance.now();
  const pending = readInput(stream, { timeoutMs: 80, maxBytes: 1_024 });
  const drip = setInterval(() => stream.write('x'), 10);
  try {
    await assert.rejects(pending, { kind: 'deadline' });
  } finally { clearInterval(drip); stream.destroy(); }
  assert.ok(performance.now() - started < 1_000);
  assert.equal(stream.listenerCount('data'), 0);
});

test('the byte limit counts multibyte input and releases the source on rejection', async () => {
  const stream = new PassThrough();
  const pending = readInput(stream, { timeoutMs: 1_000, maxBytes: 5 });
  stream.write(Buffer.from('€€'));
  await assert.rejects(pending, { kind: 'too-large' });
  assert.equal(stream.listenerCount('data'), 0);
  assert.ok(stream.destroyed || stream.isPaused());
});

test('an EOF queued before timers still refuses after the absolute input deadline', async () => {
  const stream = new PassThrough();
  const pending = readInput(stream, { timeoutMs: 20 });
  const refused = assert.rejects(pending, { kind: 'deadline' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  stream.end('{}');
  await refused;
});

test('a complete request at the byte limit survives split UTF-8 chunks', async () => {
  const bytes = Buffer.from('a€');
  const stream = Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]);
  assert.equal(await readInput(stream, { timeoutMs: 1_000, maxBytes: bytes.length }), 'a€');
  assert.equal(stream.listenerCount('data'), 0);
});

test('a stream error rejects the request and detaches the read listeners', async () => {
  const stream = new PassThrough();
  const pending = readInput(stream, { timeoutMs: 1_000, maxBytes: 10 });
  stream.destroy(new Error('fixture read failed'));
  await assert.rejects(pending, /fixture read failed/);
  assert.equal(stream.listenerCount('data'), 0);
});

test('a source already being destroyed retains its error listener until the queued failure arrives', async () => {
  const stream = new PassThrough();
  stream.destroy(new Error('fixture early failure'));
  await assert.rejects(readInput(stream), /fixture early failure/);
  assert.equal(stream.listenerCount('error'), 0);
});

test('early close and an already closed source reject without leaving read listeners', async () => {
  const stream = new PassThrough();
  const pending = readInput(stream);
  stream.destroy();
  await assert.rejects(pending, /closed|EOF/i);
  await assert.rejects(readInput(stream), /closed|EOF/i);
  for (const event of ['data', 'end', 'error', 'close']) assert.equal(stream.listenerCount(event), 0, event);
});

test('hook output waits for the pipe write callback before the caller may exit', async () => {
  let written = '';
  let complete;
  let settled = false;
  const output = { write: (text, done) => { written += text; complete = done; return false; } };
  const pending = writeHookOutput(output, 'hook verdict\n').then((flushed) => { settled = true; return flushed; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written, 'hook verdict\n');
  assert.equal(settled, false);
  complete();
  assert.equal(await pending, true);
  assert.equal(settled, true);
});

test('an output pipe that never drains cannot hold a settled hook indefinitely', async () => {
  const started = performance.now();
  assert.equal(await writeHookOutput({ write: () => false }, 'hook note\n'), false);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= HOOK_INPUT_LIMITS.outputTimeoutMs - 30, `${elapsed} ms`);
  assert.ok(elapsed < HOOK_INPUT_LIMITS.outputTimeoutMs + 1_000, `${elapsed} ms`);
});

test('a Writable callback error and its subsequent error event are contained', async () => {
  const stream = new Writable({ write: (_chunk, _encoding, done) => done(new Error('fixture broken pipe')) });
  await assert.rejects(writeHookOutput(stream, 'refused\n'), /broken pipe/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stream.listenerCount('error'), 0);
});

test('normal hook requests retain their command and seat verdicts', async (t) => {
  const { root, env } = fixture(t);
  let stderr = '';
  const allowed = await commandMain({ stdin: Readable.from([JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } })]),
    stderr: { write: (chunk, done) => { stderr += chunk; done?.(); } }, env, root });
  assert.equal(allowed, 0);
  assert.equal(stderr, '');
  const seats = path.join(root, 'runtime', 'guards', 'seats');
  mkdirSync(seats, { recursive: true });
  writeFileSync(path.join(seats, 'fixture-seat.json'), JSON.stringify({ role: 'supervisor', deniedTools: ['Agent'] }));
  let stdout = '';
  const denied = await seatMain({ stdin: Readable.from([JSON.stringify({ tool_name: 'Agent' })]),
    stdout: { write: (chunk, done) => { stdout += chunk; done?.(); } }, env: { ...env, ORCA_TERMINAL_HANDLE: 'fixture-seat' }, root });
  assert.equal(denied, 0);
  const decision = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision, 'deny');
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.match(decision.permissionDecisionReason, /Agent/);
});

test('unbound PreToolUse input failures pass through with one diagnostic line', async (t) => {
  const { root, env } = fixture(t);
  for (const main of [commandMain, seatMain]) {
    const stdin = new PassThrough();
    let note = '';
    const result = main({ stdin, stderr: { write: (text, done) => { note += text; done(); } }, root, env });
    stdin.destroy(new Error('fixture first line\nsecond line'));
    assert.equal(await result, 0);
    assert.equal(note.trim().split(/\r?\n/).length, 1);
    assert.match(note, /fixture first line second line/);
  }
});

test('a complete command request still refuses a read outside its bound critic directory', async (t) => {
  const { root, env } = fixture(t);
  const terminals = path.join(env.STARCI_GUARDS_ROOT, 'terminals');
  mkdirSync(terminals, { recursive: true });
  writeFileSync(path.join(terminals, 'fixture-critic.json'), JSON.stringify({ role: 'critic',
    reach: { dir: path.join(root, 'owned'), verdictFile: 'verdict.yaml' } }));
  const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'outside.txt') } });
  const result = await runHook(t, { file: 'command-guard.mjs', env: { ...env, ORCA_TERMINAL_HANDLE: 'fixture-critic' }, input, closeInput: true });
  assert.equal(result.killed, false);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stderr, /RIGHTS_CRITIC_REACH/);
});

test('padding a refused Write beyond the input ceiling cannot bypass its critic guard', async (t) => {
  const { root, env } = fixture(t);
  const terminals = path.join(env.STARCI_GUARDS_ROOT, 'terminals');
  mkdirSync(terminals, { recursive: true });
  writeFileSync(path.join(terminals, 'padded-critic.json'), JSON.stringify({ role: 'critic',
    reach: { dir: path.join(root, 'owned'), verdictFile: 'verdict.yaml' } }));
  const boundEnv = { ...env, ORCA_TERMINAL_HANDLE: 'padded-critic' };
  for (const content of ['refused', 'x'.repeat(HOOK_INPUT_LIMITS.maxBytes)]) {
    const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'outside.txt'), content } });
    const result = await runHook(t, { file: 'command-guard.mjs', env: boundEnv, input, closeInput: true });
    assert.equal(result.killed, false);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, content === 'refused' ? /RIGHTS_CRITIC_REACH/ : /exceeds.*bytes/);
  }
});

test('an extra shell command field cannot bypass a protected file Write', async (t) => {
  const { root, env } = fixture(t);
  const runtime = path.join(root, 'checkout');
  mkdirSync(path.join(runtime, 'knowledge', 'hfs'), { recursive: true });
  writeFileSync(path.join(runtime, 'knowledge', 'hfs', 'runtime-slots.yaml'), '');
  const seats = path.join(root, 'runtime', 'guards', 'seats');
  mkdirSync(seats, { recursive: true });
  writeFileSync(path.join(seats, 'file-seat.json'), JSON.stringify({ role: 'supervisor' }));
  const boundEnv = { ...env, ORCA_TERMINAL_HANDLE: 'file-seat' };
  for (const command of [undefined, 'ls']) {
    let stderr = '';
    const input = { tool_name: 'Write', tool_input: {
      file_path: path.join(runtime, 'modules', 'kernel', 'hook-input.yaml'), content: 'replacement',
      ...(command ? { command } : {}),
    } };
    const code = await commandMain({ stdin: Readable.from([JSON.stringify(input)]), root, env: boundEnv,
      stderr: { write: (text, done) => { stderr += text; done(); } } });
    assert.equal(code, 2, stderr);
    assert.match(stderr, /RIGHTS_PROTECTED_ZONE/);
  }
  let stderr = '';
  const code = await commandMain({ stdin: Readable.from([JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })]), root, env: boundEnv,
    stderr: { write: (text, done) => { stderr += text; done(); } } });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
});

test('bound seats refuse stalled stdin within the input deadline', async (t) => {
  const { root, env } = fixture(t);
  const seats = path.join(env.STARCI_GUARDS_ROOT, 'seats');
  mkdirSync(seats, { recursive: true });
  writeFileSync(path.join(seats, 'stalled-seat.json'), JSON.stringify({ role: 'supervisor', deniedTools: ['Agent'] }));
  const preload = path.join(root, 'keep-alive.mjs');
  writeFileSync(preload, 'setInterval(() => {}, 60000);\n');
  await Promise.all(['command-guard.mjs', 'seat-tools.mjs'].map(async (file) => {
    const result = await runHook(t, { file, env: { ...env, ORCA_TERMINAL_HANDLE: 'stalled-seat' }, preload });
    assert.equal(result.killed, false, `${file} needed the parent watchdog`);
    assert.equal(result.code, 2, result.stderr);
    assert.ok(result.elapsed < HOOK_INPUT_LIMITS.minInputWindowMs + 2_500, `${result.elapsed} ms`);
    assert.match(result.stderr, /deadline.*refusing/);
    if (file === 'seat-tools.mjs') assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  }));
});

test('a seat binding or role claim refuses oversized input for both PreToolUse guards', async (t) => {
  const { root, env } = fixture(t);
  const seats = path.join(root, 'runtime', 'guards', 'seats');
  mkdirSync(seats, { recursive: true });
  writeFileSync(path.join(seats, 'large-seat.json'), JSON.stringify({ role: 'supervisor', deniedTools: ['Agent'] }));
  for (const boundEnv of [{ ...env, ORCA_TERMINAL_HANDLE: 'large-seat' }, { ...env, STARCI_ROLE: 'op' }]) {
    for (const main of [commandMain, seatMain]) {
      let stderr = '';
      let stdout = '';
      const code = await main({ stdin: Readable.from(['x'.repeat(HOOK_INPUT_LIMITS.maxBytes + 1)]), root, env: boundEnv,
        stderr: { write: (text, done) => { stderr += text; done(); } },
        stdout: { write: (text, done) => { stdout += text; done(); } } });
      assert.equal(code, 2);
      assert.match(stderr, /exceeds.*bytes.*refusing/);
      if (main === seatMain) assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'deny');
    }
  }
});

test('a failed refusal diagnostic cannot turn a critic denial into an allow', async (t) => {
  const { root, env } = fixture(t);
  const terminals = path.join(root, 'runtime', 'guards', 'terminals');
  mkdirSync(terminals, { recursive: true });
  writeFileSync(path.join(terminals, 'broken-pipe.json'), JSON.stringify({ role: 'critic',
    reach: { dir: path.join(root, 'owned'), verdictFile: 'verdict.yaml' } }));
  const stdin = Readable.from([JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'outside.txt') } })]);
  const code = await commandMain({ stdin, root, env: { ...env, ORCA_TERMINAL_HANDLE: 'broken-pipe' },
    stderr: { write: (text, done) => done(new Error('fixture EPIPE')) } });
  assert.equal(code, 2);
});

test('a direct guard child preserves exit 2 when its real stderr pipe closes', async (t) => {
  const { root, env } = fixture(t);
  const terminals = path.join(env.STARCI_GUARDS_ROOT, 'terminals');
  mkdirSync(terminals, { recursive: true });
  writeFileSync(path.join(terminals, 'closed-stderr.json'), JSON.stringify({ role: 'critic',
    reach: { dir: path.join(root, 'owned'), verdictFile: 'verdict.yaml' } }));
  const child = spawn(process.execPath, [path.join(bundledRoot, 'scripts', 'guards', 'command-guard.mjs')], {
    env: { ...env, ORCA_TERMINAL_HANDLE: 'closed-stderr' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 5000,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stderr.destroy();
  child.stdout.resume();
  child.stdin.end(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'outside.txt') } }));
  assert.deepEqual(await exited, { code: 2, signal: null });
  assert.equal(child.killed, false);
});

test('a complete push ref list retains its allowed branch and protected-main refusal', async (t) => {
  const { root } = fixture(t);
  const zero = '0'.repeat(40);
  const head = 'a'.repeat(40);
  let stderr = '';
  const output = { write: (chunk, done) => { stderr += chunk; done?.(); } };
  assert.equal(await pushMain({ stdin: Readable.from([`refs/heads/fixture ${head} refs/heads/fixture ${zero}\n`]), stderr: output, cwd: root }), 0);
  assert.equal(stderr, '');
  assert.equal(await pushMain({ stdin: Readable.from([`refs/heads/main ${zero} refs/heads/main ${head}\n`]), stderr: output, cwd: root }), 1);
  assert.match(stderr, /RIGHTS_PUSH_NOT_RELEASE/);
});

test('all stdin-reading guard children exit on the deadline while the parent keeps stdin open', async (t) => {
  const { root, env } = fixture(t);
  const preload = path.join(root, 'referenced-timer.mjs');
  writeFileSync(preload, 'setInterval(() => {}, 60000);\n');
  await Promise.all(hookFiles.map(async ({ file, code }) => {
    const result = await runHook(t, { file, env, preload });
    assert.equal(result.killed, false, `${file} waited for the parent watchdog`);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, code, result.stderr);
    assert.ok(result.elapsed < HOOK_INPUT_LIMITS.minInputWindowMs + 2_500, `${file}: ${result.elapsed} ms`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim().split(/\r?\n/).length, 1, result.stderr);
    assert.match(result.stderr, /deadline|timed?\s*out|timeout/i);
  }));
});
test('all stdin-reading guard children bound oversized input without waiting for EOF', async (t) => {
  const { env } = fixture(t);
  const input = Buffer.alloc(HOOK_INPUT_LIMITS.maxBytes + 1, 'x');
  await Promise.all(hookFiles.map(async ({ file, code }) => {
    const result = await runHook(t, { file, env, input });
    assert.equal(result.killed, false, `${file} waited for the parent watchdog`);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, code, result.stderr);
    assert.ok(result.elapsed < HOOK_INPUT_LIMITS.minInputWindowMs, `${file}: ${result.elapsed} ms`);
    assert.equal(result.stderr.trim().split(/\r?\n/).length, 1, result.stderr);
    assert.match(result.stderr, /byte|large|size|limit/i);
  }));
});


test('a complete main ref list reaches the bundled secret scanner without release evidence', t => {
  const { root } = fixture(t);
  const head = 'a'.repeat(40);
  const calls = [];
  const result = pushRefusals({ cwd: root, text: `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`, scan: range => {
    calls.push(range);
    return { ok: true, findings: [] };
  } });
  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, root);
  assert.equal(calls[0].to, head);
});

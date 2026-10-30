import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOOK_INPUT_LIMITS, readInput, writeHookOutput } from '../runtime/scripts/guards/hook-io.mjs';
import { main as pushMain, pushRefusals } from '../runtime/scripts/guards/release-push-gate.mjs';

const bundledRoot = fileURLToPath(new URL('../runtime/', import.meta.url));
const hookFiles = [
  { file: 'release-push-gate.mjs', code: 1 },
];

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-hook-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, STARCI_ROLE: '', ORCA_TERMINAL_HANDLE: '',
    STARCI_TEMP_ROOT: root, STARCI_LOCAL_ROOT: path.join(root, 'state'),
    STARCI_GUARDS_ROOT: path.join(root, 'guards'), STARCI_OWNER_CONFIG_WITHIN: root };
  return { root, env };
}

async function runHook(t: TestContext, { file, env, input = null, preload = null, closeInput = false }: { file: string; env: NodeJS.ProcessEnv; input?: Buffer | string | null; preload?: string | null; closeInput?: boolean }) {
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
  child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error; });
  const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
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
  let complete!: () => void;
  let settled = false;
  const output = { write: (text: string, done: (error?: Error | null) => void) => { written += text; complete = done; return false; } };
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

test('a complete push ref list retains its allowed branch and protected-main refusal', async (t) => {
  const { root } = fixture(t);
  const zero = '0'.repeat(40);
  const head = 'a'.repeat(40);
  let stderr = '';
  const output = { write: (chunk: string, done?: () => void) => { stderr += chunk; done?.(); } };
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
  const calls: { cwd: string; from: string; to: string }[] = [];
  const result = pushRefusals({ cwd: root, text: `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`, scan: range => {
    calls.push(range);
    return { ok: true, findings: [] };
  } });
  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cwd, root);
  assert.equal(calls[0]!.to, head);
});

import { HOOK_INPUT_LIMITS } from '../lib/hook-limits.mjs';
export { HOOK_INPUT_LIMITS } from '../lib/hook-limits.mjs';

/** Keep fail-open and fail-closed input diagnostics on one stderr line, including parser errors containing input. */
export const hookErrorMessage = (error) => String(error?.message ?? error).replace(/[\r\n\u2028\u2029]+/g, ' ');

/** Flush hook output before explicit exit; false means the output deadline elapsed before the write completed. */
export const writeHookOutput = (stream, text) => new Promise((resolve, reject) => {
  let settled = false;
  const onError = (error) => done(error);
  const done = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // A Writable reports callback failure before emitting its error event. Keep the listener through that turn.
    if (error) setImmediate(() => stream.removeListener?.('error', onError));
    else stream.removeListener?.('error', onError);
    if (error) reject(error);
    else resolve(true);
  };
  const timer = setTimeout(() => {
    settled = true;
    stream.removeListener?.('error', onError);
    resolve(false);
  }, HOOK_INPUT_LIMITS.outputTimeoutMs);
  stream.once?.('error', onError);
  try { stream.write(text, done); }
  catch (error) { done(error); }
});

/**
 * Consume one EOF-delimited hook payload within a wall-clock deadline and byte budget. The stream belongs to this
 * one-shot hook: every outcome releases its input handle and listeners. Callers choose their existing failure policy.
 */
export const readInput = (stream, { timeoutMs = HOOK_INPUT_LIMITS.minInputWindowMs, maxBytes = HOOK_INPUT_LIMITS.maxBytes } = {}) => new Promise((resolve, reject) => {
  const chunks = [];
  const deadline = performance.now() + timeoutMs;
  const deadlineError = () => Object.assign(new Error(`hook stdin deadline exceeded (${timeoutMs} ms)`), { kind: 'deadline' });
  let bytes = 0;
  let settled = false;
  let closeCheck;
  const finish = (error) => {
    if (settled) return;
    if (!error && performance.now() >= deadline) error = deadlineError();
    settled = true;
    clearTimeout(timer);
    clearImmediate(closeCheck);
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
    stream.pause();
    stream.unref?.();
    stream.destroy();
    if (error) reject(error);
    else resolve(Buffer.concat(chunks, bytes).toString('utf8'));
  };
  const onData = (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) finish(Object.assign(new Error(`hook stdin exceeds ${maxBytes} bytes; split the tool input`), { kind: 'too-large' }));
    else chunks.push(buffer);
  };
  const onEnd = () => finish();
  const onError = (error) => finish(error);
  const onClose = () => finish(stream.errored ?? new Error('hook stdin closed before EOF'));
  // Keep the timer referenced so an idle pipe still reaches the caller's bound-session refusal.
  const timer = setTimeout(() => finish(deadlineError()), timeoutMs);
  stream.on('data', onData);
  stream.once('end', onEnd);
  stream.once('error', onError);
  stream.once('close', onClose);
  // destroy(error) marks a stream closed before its queued error event; let that event reach our listener first.
  if (stream.destroyed) closeCheck = setImmediate(onClose);
  else if (stream.readableEnded) onEnd();
});

import { fileURLToPath } from 'node:url';
import { spawnNode } from '../api/node/spawn-node.mjs';
import { killTree } from '../api/process/kill-tree.mjs';
import { HOOK_INPUT_LIMITS } from './hook-io.mjs';

const entry = fileURLToPath(new URL('./command-guard.mjs', import.meta.url));

/** Request forced teardown of this call's verifier tree; a failed tree stop is reported after the direct child is stopped. */
function stopVerifier(child, teardownTimeoutMs) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0 || child.exitCode !== null) return;
  let failure;
  if (process.platform === 'win32') {
    const stopped = killTree(child.pid, { timeoutMs: teardownTimeoutMs });
    if (!stopped.ok) {
      child.kill('SIGKILL');
      const detail = stopped.output || `exit ${stopped.status}`;
      failure = new Error(`verifier tree stop failed (${detail})`);
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) {
      if (error.code !== 'ESRCH') {
        child.kill('SIGKILL');
        failure = error;
      }
    }
  }
  if (child.connected) child.disconnect();
  child.unref();
  if (failure) throw failure;
}

/**
 * Evaluate a hook in an owned child so synchronous policy work cannot block its caller's deadline.
 * The promise resolves only after the child sends a decision and exits; startup, IPC and deadline failures reject.
 * A deadline requests bounded forced teardown of that child's tree and never accepts a late decision.
 */
export function runHookVerdict({ input, root, bindings, env = process.env, start = spawnNode,
  timeoutMs = HOOK_INPUT_LIMITS.verdictTimeoutMs, teardownTimeoutMs = HOOK_INPUT_LIMITS.teardownTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    let child;
    let settled = false;
    let response;
    const finish = (error, decision) => {
      if (settled) return;
      // Event-loop delays can deliver close before the expired timer; elapsed time still owns admission.
      if (!error && performance.now() >= deadline) error = new Error(`hook verdict deadline exceeded (${timeoutMs} ms)`);
      settled = true;
      clearTimeout(timer);
      if (error) {
        try { stopVerifier(child, teardownTimeoutMs); }
        catch (cleanupError) {
          child?.channel?.unref();
          child?.unref();
          reject(new Error(`${error.message}; verifier cleanup failed (${cleanupError.message})`));
          return;
        }
        reject(error);
      } else resolve(decision);
    };
    const timer = setTimeout(() => finish(new Error(`hook verdict deadline exceeded (${timeoutMs} ms)`)), timeoutMs);
    try {
      child = start([entry], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.once('error', (error) => finish(error));
      child.on('message', (message) => {
        if (settled || response) return;
        if (message?.ok !== true || !Object.hasOwn(message, 'decision')) {
          finish(new Error(String(message?.error ?? 'hook verifier returned an invalid decision')));
          return;
        }
        response = message;
      });
      child.once('close', (code, signal) => {
        if (response && code === 0 && !signal) finish(null, response.decision);
        else finish(new Error(`hook verifier exited before its decision (exit ${code}, signal ${signal ?? 'none'})`));
      });
      child.send({ input, root, bindings }, (error) => { if (error) finish(error); });
    } catch (error) { finish(error); }
  });
}

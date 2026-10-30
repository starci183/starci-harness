// scripts/api/node/lib.mjs — the runner of the runtime's own scripts as child processes: the node binary that runs this
// process (process.execPath), a hidden window, utf8 text. The call files beside it (run-script.mjs, syntax-check.mjs,
// run-node.mjs, spawn-node.mjs, exec-node.mjs) each name one use; nothing outside scripts/api/node imports this runner.
import { assertMutationFence } from '../../lib/mutation-fence.mjs';
import { execFile, spawn, spawnSync, type ChildProcess, type ExecFileException, type ExecFileOptions, type ExecFileOptionsWithStringEncoding, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { withTempEnv } from '../../../engine/temp-root.mjs';
import { withoutTestRunner } from '../../lib/env.mjs';

/** Whether `node <args>` starts the test runner (`--test`, `--test=...` before any script): its env must not carry an enclosing run's mark. THE one seam of every runtime child that runs specs. */
const startsTestRunner = (args: readonly string[]): boolean => args.some((arg) => arg === '--test' || String(arg).startsWith('--test='));
const forChild = <T extends { env?: NodeJS.ProcessEnv | undefined }>(args: readonly string[], options: T): T => (startsTestRunner(args) ? { ...options, env: withoutTestRunner(options?.env ?? process.env) } : options);

/** `node <args>` with this process's node binary, waited for; options pass through last (cwd, stdio, env, timeout, maxBuffer, input). */
export const nodeSpawn = (args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> => {
  assertMutationFence({ kind: 'node-effect', args });
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = withTempEnv({ encoding: 'utf8', windowsHide: true, ...forChild(args, options) });
  return spawnSync(process.execPath, args, spawnOptions);
};

/** `node <args>` with this process's node binary, started and not waited for: the ChildProcess (detached, stdio, env pass through). */
export const nodeStart = (args: readonly string[], options: SpawnOptions = {}): ChildProcess => {
  assertMutationFence({ kind: 'node-effect', args });
  const spawnOptions: SpawnOptions = withTempEnv({ windowsHide: true, ...forChild(args, options) });
  return spawn(process.execPath, args, spawnOptions);
};

/** `node <args>` with this process's node binary, waited for without blocking the thread: callback(error, stdout, stderr). */
export const nodeExecFile = (args: readonly string[], options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void): ChildProcess => {
  assertMutationFence({ kind: 'node-effect', args });
  const execOptions: ExecFileOptionsWithStringEncoding = withTempEnv({ encoding: 'utf8', windowsHide: true, ...forChild(args, options) });
  return execFile(process.execPath, args, execOptions, callback);
};

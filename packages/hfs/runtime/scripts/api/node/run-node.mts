// run-node.mjs — `node <args>` with this process's node binary, waited for: a runtime script (or `-e`/`--test`) as a child
// whose output the caller reads. Returns the spawnSync result {status, stdout, stderr, error, signal} (utf8 text).
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import { nodeSpawn } from './lib.mjs';

/** Runs `node <args>`; options (cwd, env, timeout, input, maxBuffer, stdio) pass through. */
export const runNode = (args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> => nodeSpawn(args, options);

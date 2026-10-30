// run-program.mjs — run one declared program argv (`file args`, never a shell), waited for: a UAT policy command of an
// assisted run (scripts/uat/assisted-runner.mjs), resolved to its file by scripts/uat/launch.mjs launchFor. Returns the
// spawnSync result {status, stdout, stderr, error, signal} (utf8 text, a hidden window).
import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { withTempEnv } from '../../../engine/temp-root.mjs';

/** Runs `file args`; options (cwd, env, timeout, stdio, input) pass through. */
export const runProgram = (file: string, args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> => {
  // reason: utf8 is the default; a caller option that overrides encoding is the caller's explicit request for another output type
  const spawnOptions = withTempEnv({ encoding: 'utf8', windowsHide: true, ...options }) as SpawnSyncOptionsWithStringEncoding;
  return spawnSync(file, args, spawnOptions);
};

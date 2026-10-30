// resolve-sops.mjs — find the sops executable: PATH, and on Windows the WinGet links and packages.
import { resolveSops as resolve, type ResolveSopsOptions } from './lib.mjs';

/** The absolute sops path, or null. `options`: platform, pathext (PATHEXT names), wingetPackageTree (the full package tree), filesystem (a probe). */
export function resolveSops(env: NodeJS.ProcessEnv = process.env, options: ResolveSopsOptions = {}): string | null {
  return resolve(env, options);
}

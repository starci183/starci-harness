// update-keys.mjs — the public SOPS `updatekeys` call: a sealed member is wrapped again to the recipients its .sops.yaml rule
// names. Only the member's data key is opened (with the caller's identity); no value is decrypted to stdout or disk.
import { spawnSync } from 'node:child_process';
import { sopsIdentityEnv } from '../../../engine/secrets.mjs';
import { resolveSops, runSelectedUpdateKeys } from './lib.mjs';

/**
 * Run `<bin> --config <config> updatekeys -y --input-type <inputType> <file>` (bin null: the sops resolveSops finds). An inline
 * SOPS_AGE_KEY goes through the selected isolation (runSelectedUpdateKeys); a SOPS_AGE_KEY_FILE runs with the selected environment.
 * {status, stdout, stderr, error}; stdout and stderr carry public key names only.
 */
export function updateKeys(bin, { file, config, inputType }, { invocation = null, env = process.env, cwd = undefined, timeout = undefined } = {}) {
  const selected = sopsIdentityEnv(env, { required: true });
  if (selected.error?.identityRefusal === 'inline-context-unqualified') return runSelectedUpdateKeys(bin, { file, config, inputType }, { selection: selected, invocation, env, cwd, timeout });
  if (selected.error) return { status: null, stdout: '', stderr: '', error: selected.error };
  const exe = bin ?? resolveSops(selected.env);
  if (!exe) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('sops is not installed (Windows: winget install Mozilla.SOPS)'), { code: 'SOPS_MISSING' }) };
  const r = spawnSync(exe, ['--disable-version-check', '--config', config, 'updatekeys', '-y', '--input-type', inputType, file], { cwd, env: selected.env, encoding: 'utf8', windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ?? null };
}

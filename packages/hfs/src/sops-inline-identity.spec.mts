// sops-inline-identity.spec.mts - an inline SOPS_AGE_KEY pasted as a whole age identity document (keys.txt: `# created:` and `# public key:`
// comments around the AGE-SECRET-KEY-1 line, CRLF or LF) opens a member exactly as the bare line does. A CI secret is often pasted in that form,
// and the selected invocation refused it as `inline-context-unqualified` before any sops process ran, so `starci app stack connect` could not open
// the transport member of a release deploy (STACK_SECRET_MEMBER_UNREADABLE). Every stack read of a member (connect, deploy, render, migrate,
// rollback, seeds) goes through the one sops seam (secret-sops.mts defaultSops -> runSopsFile -> runSelectedSops), so this owner covers them all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inlineAgeIdentity, sopsIdentityEnv } from '../runtime/engine/secrets.mjs';
import type { SpawnSyncOptions } from 'node:child_process';
import { runSelectedSops, selectedAgeRecipient, type Capture, type SopsInvocation } from '../runtime/scripts/api/sops/lib.mjs';

// Built at run time so no source line carries an identity-shaped literal (the secret scan reads every committed file).
const LINE = ['AGE', 'SECRET', 'KEY', `1${'Q'.repeat(58)}`].join('-');
const RECIPIENT = `age1${'q'.repeat(58)}`;
const KEYS_TXT = `# created: 2026-11-27T10:00:00Z\n# public key: ${RECIPIENT}\n${LINE}\n`;

test('inlineAgeIdentity takes the bare line or one identity document, and nothing else', () => {
  assert.equal(inlineAgeIdentity(LINE), LINE);
  assert.equal(inlineAgeIdentity(`  ${LINE}\n`), LINE);
  assert.equal(inlineAgeIdentity(KEYS_TXT), LINE);
  assert.equal(inlineAgeIdentity(KEYS_TXT.replaceAll('\n', '\r\n')), LINE, 'CRLF');
  assert.equal(inlineAgeIdentity(`\n\n${KEYS_TXT}\n\n`), LINE, 'blank lines around it');
  assert.equal(inlineAgeIdentity(`${LINE}\n${LINE}`), null, 'two identities');
  assert.equal(inlineAgeIdentity(`${KEYS_TXT}garbage\n`), null, 'a line that is not an identity');
  assert.equal(inlineAgeIdentity(LINE.toLowerCase()), null);
  assert.equal(inlineAgeIdentity(''), null);
  assert.equal(inlineAgeIdentity(undefined), null);
});

/** A fake process owner: the two version probes answer the selected profile, `age-keygen -y` the recipient; every call is recorded. */
function invocation(calls: { args: string[]; input: string; key: string | undefined }[]): SopsInvocation {
  const ok = (stdout: string): Capture => ({ status: 0, signal: null, error: undefined, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) });
  return {
    resolveRealTool: () => process.execPath,
    runProgram: (_program: string, args: string[], options: SpawnSyncOptions): Capture => {
      const input = options.input;
      calls.push({ args, input: Buffer.isBuffer(input) ? input.toString('utf8') : typeof input === 'string' ? input : '', key: options.env?.SOPS_AGE_KEY });
      if (args.includes('--version')) return ok(args[0] === '--disable-version-check' ? 'sops 3.13.2\n' : 'v1.2.1\n');
      if (args[0] === '-y') return ok(`${RECIPIENT}\n`);
      return { status: 1, signal: null, error: undefined, stdout: Buffer.alloc(0), stderr: Buffer.from('no identity matched') };
    },
  };
}

for (const [label, value] of [['the bare line', LINE], ['a pasted keys.txt', KEYS_TXT], ['a pasted keys.txt with CRLF', KEYS_TXT.replaceAll('\n', '\r\n')]] as const) {
  test(`a member decrypt with ${label} as SOPS_AGE_KEY passes admission and hands age only the bare line`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sops-inline-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'vps-ci.enc.yaml');
    fs.writeFileSync(file, 'not: a sealed envelope\n');
    const env = { PATH: process.env.PATH, SOPS_AGE_KEY: value };
    const selection = sopsIdentityEnv(env, { required: true });
    assert.equal(selection.error?.identityRefusal, 'inline-context-unqualified', 'the selection hands the key to the selected invocation');
    const calls: { args: string[]; input: string; key: string | undefined }[] = [];
    const result = runSelectedSops(process.execPath, { operation: 'decrypt', args: ['decrypt', '--input-type', 'yaml', '--output-type', 'json', file] }, { selection, invocation: invocation(calls), env, cwd: dir, maxBuffer: 1024 * 1024 });
    const refusal = (result.error as (Error & { identityRefusal?: string }) | null)?.identityRefusal;
    assert.notEqual(refusal, 'inline-context-unqualified', 'admitted, never refused before a process ran');
    assert.notEqual(refusal, 'unsupported-tool-profile');
    const derive = calls.find((call) => call.args[0] === '-y');
    assert.ok(derive, 'the recipient was derived');
    assert.equal(derive.input, LINE, 'age reads the bare identity line');
    assert.ok(calls.every((call) => call.key === undefined || call.key === LINE), 'a child that reads SOPS_AGE_KEY reads the bare line');
  });
}

test('the public recipient of a pasted keys.txt is derived as the bare line', () => {
  const calls: { args: string[]; input: string; key: string | undefined }[] = [];
  const outcome = selectedAgeRecipient({ env: { PATH: process.env.PATH, SOPS_AGE_KEY: KEYS_TXT }, cwd: os.tmpdir(), invocation: invocation(calls) });
  assert.deepEqual(outcome, { ok: true, publicRecipient: RECIPIENT });
  assert.equal(calls.find((call) => call.args[0] === '-y')?.input, LINE);
});

test('an inline SOPS_AGE_KEY that holds no identity line is refused by name, not as an unqualified context', () => {
  const env = { PATH: process.env.PATH, SOPS_AGE_KEY: '# public key only\n' };
  const selection = sopsIdentityEnv(env, { required: true });
  const result = runSelectedSops(process.execPath, { operation: 'decrypt', args: ['decrypt', '--input-type', 'yaml', '--output-type', 'json', path.join(os.tmpdir(), 'x.enc.yaml')] }, { selection, invocation: invocation([]), env, cwd: os.tmpdir(), maxBuffer: 1024 * 1024 });
  assert.equal((result.error as (Error & { identityRefusal?: string }) | null)?.identityRefusal, 'invalid-inline');
  assert.match(String(result.error?.message), /no single AGE-SECRET-KEY-1 identity line/u);
});

// local-custody.mts - the dev custody of a dev environment: which keys the environment reads, whether they are sealed, and their host-local
// files (PROJECT-STACKS-5). Opening a member needs the owner identity; a machine without it is refused with the exact owner step, and a missing
// value is never answered by minting a replacement (only the owner-armed `starci app secret init --env <env>` creates dev values, once).
import fs from 'node:fs';
import path from 'node:path';
import { envelopeOf } from '../runtime/scripts/hfs/secret-document.mjs';
import { materializedDirectory, writeSecretFile } from '../runtime/scripts/hfs/secret-files.mjs';
import { isSealedName, memberOfName } from '../runtime/scripts/lib/sealed-member.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { LocalConfig } from './local-config.mjs';

/** The opened custody: the directory of the host-local `<KEY>` files and the values, in memory only. */
export interface Custody { directory: string; values: Map<string, string> }

/** Every key the environment's commands, processes, database and compose read. */
export function neededKeys(local: LocalConfig): string[] {
  const keys = new Set<string>();
  for (const run of [...local.setup, ...local.seed, ...local.processes]) for (const key of run.files) if (key !== local.database?.urlEnv) keys.add(key);
  for (const item of local.composeEnv) keys.add(item.key);
  for (const grant of local.grants) for (const key of grant.keys) keys.add(key);
  if (local.database) {
    keys.add(local.database.password.key); keys.add(local.database.adminPassword.key);
    if (local.database.appPassword) keys.add(local.database.appPassword.key);
  }
  return [...keys].sort();
}

/** Which sealed member holds each key, read from the cleartext key names (no identity needed). */
export function holders(secretsDir: string): Map<string, string> {
  const held = new Map<string, string>();
  let names: string[] = [];
  try { names = fs.readdirSync(secretsDir).filter(isSealedName).sort(); } catch { return held; }
  for (const name of names) {
    try { for (const key of envelopeOf(fs.readFileSync(path.join(secretsDir, name), 'utf8')).keys) if (!held.has(key)) held.set(key, name); } catch { /* an unreadable member is judged when it is opened */ }
  }
  return held;
}

/** The keys needed that no sealed member holds. */
export const missingKeys = (local: LocalConfig): string[] => {
  const held = holders(local.secretsDir);
  return neededKeys(local).filter((key) => !held.has(key));
};

/** The owner step for keys no member holds: init when the environment generates them, else set. */
export function missingStep(local: LocalConfig, missing: readonly string[]): string {
  const generated = new Set(local.custody.flatMap((item) => [item.key, ...(item.publicKey ? [item.publicKey] : [])]));
  const create = missing.filter((key) => generated.has(key));
  const set = missing.filter((key) => !generated.has(key));
  return [
    create.length ? `the owner arms "starci app secret init --env ${local.env} --execute" to create ${create.join(', ')} once` : '',
    set.length ? `the owner seals ${set.join(', ')} with "starci app secret set --env ${local.env} <slug> <KEY>"` : '',
  ].filter(Boolean).join('; ');
}

/**
 * Decrypts the needed keys in memory and writes each to its own private file outside the checkout. A key no member holds, or a member the
 * machine's identity cannot open, is a refusal that names the owner step; nothing is generated here.
 */
export function openCustody(ctx: StackContext, local: LocalConfig): Custody {
  const needed = neededKeys(local);
  const held = holders(local.secretsDir);
  const missing = needed.filter((key) => !held.has(key));
  if (missing.length) throw refusal('STACK_LOCAL_CUSTODY_MISSING', `no sealed member of ${local.env} holds ${missing.join(', ')}: ${missingStep(local, missing)}`);
  const values = new Map<string, string>();
  const members = [...new Set(needed.map((key) => held.get(key) as string))];
  for (const name of members) {
    const file = path.join(local.secretsDir, name);
    try {
      ctx.sops.requireIdentity?.(file);
      const map = ctx.sops.decrypt(file, envelopeOf(fs.readFileSync(file, 'utf8')).format);
      for (const key of needed) if (held.get(key) === name && typeof map[key] === 'string') values.set(key, map[key]);
    } catch (error) {
      const why = String((error as Error).message ?? error).split(/\r?\n/u)[0];
      throw refusal('STACK_LOCAL_IDENTITY_MISSING', `${memberOfName(name)} (${local.env}) cannot be opened on this machine: ${why}. The owner step: put the age identity that ${local.env} is sealed to in SOPS_AGE_KEY of the harness secret.env (or .claude/secret.env of the app), obtained from the owner; a replacement is never generated for an existing sealed value (PROJECT-STACKS-5)`);
    }
  }
  const directory = materializedDirectory(local.repoRoot, local.env, ctx.env, ctx.platform);
  for (const [key, value] of values) writeSecretFile(directory, key, value);
  for (const grant of local.grants) {
    const target = grantDirectory(directory, grant.name);
    for (const key of grant.keys) if (values.has(key)) writeSecretFile(target, key, values.get(key) as string);
  }
  return { directory, values };
}

/** The directory of one least grant inside the host-local custody directory (created private; it holds only the keys the grant names). */
export function grantDirectory(directory: string, name: string): string {
  const target = path.join(directory, 'grants', name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}

/** The `<KEY>_FILE` environment of the keys a command reads: each points at the host-local file. */
export const fileEnvironment = (custody: Custody, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.filter((key) => custody.values.has(key)).map((key) => [`${key}_FILE`, path.join(custody.directory, key)]));

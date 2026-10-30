// sealed.mjs - opens the sealed custody members in memory and derives, from names and keyed hashes only, which Swarm secret each
// service is granted (the shared half of the release tools). No value is ever written to disk, printed or put in an argument list:
// callers receive `value` and must keep it in memory. Config objects (non-secret files mounted into services) are versioned by content.
import { createHash, createHmac } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { memberFile } from '../runtime/scripts/lib/sealed-member.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readMap } from '../runtime/scripts/hfs/secret-store.mjs';
import type { DeployConfig, SecretGrant, SecretSource } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';

/** An opened sealed member: KEY -> value (a value that is not a string is never granted). */
export type SealedMap = Record<string, unknown>;
/** Opens a member once and returns its map. */
type MemberOf = (member: string) => SealedMap;
/** One granted secret: its Swarm secret name and its value (in memory only). */
export interface SealedSecret { runtimeName: string; value: string }
/** What loadSealed returns: the secrets, the keys each service is granted and the plain settings. */
export interface LoadedSealed {
  secrets: Record<string, SealedSecret>;
  grants: Record<string, string[]>;
  settings: Record<string, string>;
}
/** A non-secret config file mounted into a service, named by the digest of its content. */
export interface ConfigObject { logical: string; env: string; file: string; name: string }

const KEY_NAME = /^[A-Z][A-Z0-9_]*$/u;
const UNSAFE_SETTING = /[\r\n"'\\]/u;
const MAX_NAME = 64;

/** sha256 of the bytes, as lowercase hex. */
export const sha = (bytes: BinaryLike): string => createHash('sha256').update(bytes).digest('hex');

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);

/** True for content that is not text: a NUL byte in the first 8 KiB. Binary files are never rewritten. */
const isBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0);

/** Every CRLF of a string becomes LF. */
const lfText = (text: string): string => text.replaceAll(CR + LF, LF);

/**
 * Line endings of a text file as the services need them: every CRLF becomes LF (a script rendered from a Windows checkout failed with
 * `set: Illegal option -`). Binary content is returned untouched. Takes and returns a Buffer.
 */
function lfBytes(bytes: Buffer): Buffer {
  if (isBinary(bytes) || !bytes.includes(13)) return bytes;
  return Buffer.from(lfText(bytes.toString('latin1')), 'latin1');
}

/** The bytes of a config file as they are hashed and created: LF-normalised text, untouched binary. */
export const configBytes = (file: string): Buffer => lfBytes(fs.readFileSync(file));

/** The key that makes the version suffix of a secret name unguessable from the name alone: a local fixture key or the age identity. */
function versionKeyOf(ctx: StackContext): string {
  const key = ctx.env.STARCI_SECRET_VERSION_KEY || ctx.env.SOPS_AGE_KEY;
  if (!key) throw refusal('STACK_VERSION_KEY_MISSING', 'STARCI_SECRET_VERSION_KEY (a local fixture) or SOPS_AGE_KEY is needed to version the secret names');
  return key;
}

/** `<stack>-<key>-v<10 hex of HMAC(versionKey, key NUL value)>`: a changed value is a new name, an unchanged one keeps its name. */
function secretRuntimeName(stack: string, key: string, value: string, versionKey: string): string {
  const version = createHmac('sha256', versionKey).update(`${key}\0${value}`).digest('hex').slice(0, 10);
  const name = `${stack}-${key.toLowerCase().replaceAll('_', '-')}-v${version}`;
  if (name.length > MAX_NAME) throw refusal('STACK_SECRET_NAME_TOO_LONG', `the Swarm secret name for ${key} would exceed ${MAX_NAME} characters`);
  return name;
}

const AGE_HINT = 'add SOPS_AGE_KEY to .claude/secret.env of the app or the harness secret.env of the owner machine (the CI secret in a workflow) and retry';

/**
 * True when the sops seam found an age identity (secret-init.mjs decryptionIdentity, the one lookup every decrypt uses). A seam
 * that reports no `identity` (a spec double) decides for itself.
 */
export function hasAgeIdentity(ctx: Pick<StackContext, 'sops'>): boolean {
  const { identity } = ctx.sops;
  return identity === undefined || identity.source !== null;
}

/** Refuses up front, before any work, when sealed custody must be opened and no age identity is reachable. */
export function requireAgeIdentity(ctx: Pick<StackContext, 'sops'>, _config: DeployConfig, purpose: string): void {
  if (!hasAgeIdentity(ctx)) throw refusal('STACK_AGE_IDENTITY_MISSING', `${purpose} needs the sealed members, and no age identity is available (looked in ${ctx.sops.identity?.looked.join(', ')}): ${AGE_HINT}`);
}

/**
 * Opens one sealed member (`<secretsDir>/<member>.enc.yaml`, or a legacy `.enc`) into a { KEY: value } map. A failure is refused
 * naming the member and the seam's reason (its format, recipients and the identity tried); no value.
 */
export function openMember(ctx: Pick<StackContext, 'sops'>, config: Pick<DeployConfig, 'secretsDir'>, member: string): SealedMap {
  try {
    const map = readMap(memberFile(config.secretsDir, member), ctx.sops);
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, typeof value === 'string' && !value.includes(String.fromCodePoint(0)) ? lfText(value) : value]));
  } catch (error) {
    throw refusal('STACK_SECRET_MEMBER_UNREADABLE', `the sealed member ${member} cannot be opened: ${(error as Error).message}${hasAgeIdentity(ctx) ? '' : `; ${AGE_HINT}`}`);
  }
}

const present = (map: SealedMap, key: string): boolean => typeof map[key] === 'string' && map[key] !== '';

function sourceKeys(map: SealedMap, source: SecretSource): string[] {
  if (source.keys !== null) return source.keys;
  return Object.keys(map).filter((key) => KEY_NAME.test(key) && !key.endsWith('_FILE'));
}

/** The KEY -> value pairs one grant source contributes, given what the same service already holds. */
function takeFromSource(map: SealedMap, source: SecretSource, held: Record<string, string>): Record<string, string> {
  const taken: Record<string, string> = {};
  for (const key of sourceKeys(map, source)) {
    if (!present(map, key)) {
      if (source.required) throw refusal('STACK_SECRET_MISSING', `the sealed member ${source.member} has no value for ${key}`);
    } else if (!(source.fill && Object.hasOwn(held, key))) taken[key] = map[key] as string; // present() proved a non-empty string
  }
  return taken;
}

function serviceValues(grant: SecretGrant, memberOf: MemberOf): Record<string, string> {
  const held: Record<string, string> = {};
  for (const source of grant.from) Object.assign(held, takeFromSource(memberOf(source.member), source, held));
  return held;
}

function sealGrants(config: DeployConfig, memberOf: MemberOf, versionKey: string): Pick<LoadedSealed, 'secrets' | 'grants'> {
  const grants: Record<string, { values: Record<string, string> }> = {};
  const secrets: Record<string, SealedSecret> = {};
  const owner: Record<string, string> = {};
  for (const grant of config.secrets.grants) {
    const values = { ...grants[grant.service]?.values, ...serviceValues(grant, memberOf) };
    grants[grant.service] = { values };
    for (const [key, value] of Object.entries(values)) {
      if (Object.hasOwn(secrets, key) && secrets[key]?.value !== value) throw refusal('STACK_SECRET_CONFLICT', `${key} has different values for ${owner[key]} and ${grant.service}`);
      owner[key] ??= grant.service;
      secrets[key] ??= { runtimeName: secretRuntimeName(config.stack, key, value, versionKey), value };
    }
  }
  return { secrets, grants: Object.fromEntries(Object.entries(grants).map(([service, entry]) => [service, Object.keys(entry.values).sort()])) };
}

function sealSettings(config: DeployConfig, memberOf: MemberOf): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const block of config.secrets.settings) {
    const map = memberOf(block.member);
    for (const key of block.keys.filter((name) => present(map, name))) {
      const value = map[key] as string; // present() proved a non-empty string
      if (UNSAFE_SETTING.test(value)) throw refusal('STACK_SETTING_INVALID', `${key} must be a plain one-line value`);
      settings[key] = value;
    }
  }
  return settings;
}

/**
 * Opens the sealed members once each and returns what every service is granted:
 * { secrets: { KEY: { runtimeName, value } }, grants: { service: [KEY...] }, settings: { KEY: value } }. The caller must not log a value.
 */
export function loadSealed(ctx: StackContext, config: DeployConfig): LoadedSealed {
  const versionKey = versionKeyOf(ctx);
  const opened = new Map<string, SealedMap>();
  const memberOf: MemberOf = (member) => {
    let map = opened.get(member);
    if (map === undefined) {
      map = openMember(ctx, config, member);
      opened.set(member, map);
    }
    return map;
  };
  const { secrets, grants } = sealGrants(config, memberOf, versionKey);
  return { secrets, grants, settings: sealSettings(config, memberOf) };
}

/** The config objects: non-secret files mounted into services, named by the digest of their content. */
export const configObjects = (config: Pick<DeployConfig, 'configs' | 'envDir' | 'stack'>): ConfigObject[] => config.configs.map((entry) => {
  const file = path.join(config.envDir, entry.file);
  return { logical: entry.name, env: entry.env, file, name: `${config.stack}-${entry.name}-c${sha(configBytes(file)).slice(0, 10)}` };
});

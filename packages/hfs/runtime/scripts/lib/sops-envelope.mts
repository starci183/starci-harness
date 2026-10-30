// sops-envelope.mjs — the pure rules of a test credential (owner ruling push-scan-test-secrets-encrypted, 2026-09-28):
// where it lives in a product repository's `.starcistacks`, the command that stores it, the sops format of its path, and
// whether a committed file is a sops envelope with no plaintext value (the push secret scan's test). Reading one is
// scripts/uat/test-secret.mjs; the sops binary is found by scripts/api/sops/lib.mjs.
import path from 'node:path';
import { parseYaml } from '../../engine/yaml.mjs';

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STACK = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** One sops-encrypted leaf: `ENC[AES256_GCM,data:...,iv:...,tag:...,type:...]` (data may be empty). */
const SOPS_VALUE = /^ENC\[AES256_GCM,data:[A-Za-z0-9+/=]*,iv:[A-Za-z0-9+/=]+,tag:[A-Za-z0-9+/=]+,type:[a-z]+\]$/;

/** Where test credential `name` of `stack` lives in `repo`: {plain, enc, rel}. `rel` is the path the repo's
 *  `stack-secret.mjs set` takes. */
export function testSecretPaths(name: string, { repo, stack = 'dev' }: { repo?: string; stack?: string } = {}): { plain: string; enc: string; rel: string } {
  if (!NAME.test(String(name ?? ''))) throw new Error(`test secret name must match ${NAME} (got ${JSON.stringify(name)})`);
  if (!STACK.test(String(stack ?? ''))) throw new Error(`stack must match ${STACK} (got ${JSON.stringify(stack)})`);
  if (!repo) throw new Error('test secret needs {repo}: the product repository whose .starcistacks holds it');
  const rel = `${stack}/secrets/test/${name}`;
  const plain = path.join(path.resolve(String(repo)), '.starcistacks', stack, 'secrets', 'test', name);
  return { plain, enc: `${plain}.enc`, rel };
}

/** The command that stores a test credential, in the product repository's own tooling. */
export const setCommand = (name = '<name>', stack = 'dev'): string => `node scripts/stack-secret.mjs set ${stack}/secrets/test/${name}`;

/** sops' format for a plaintext path, as the repository's stack-secret.mjs formatFor decides it. */
export const sopsFormatFor = (file: string): 'dotenv' | 'json' | 'yaml' | 'binary' => {
  if (file.endsWith('.env')) return 'dotenv';
  if (file.endsWith('.json')) return 'json';
  if (/\.(ya?ml|kubeconfig)$/.test(file)) return 'yaml';
  return 'binary';
};

/** Every leaf outside the `sops` block is an ENC[...] value (or null); the block itself carries a mac. */
const allEncrypted = (node: unknown): boolean => {
  if (node === null) return true;
  if (Array.isArray(node)) return node.every(allEncrypted);
  if (typeof node === 'object') return Object.values(node as object).every(allEncrypted);
  return typeof node === 'string' && SOPS_VALUE.test(node);
};
// reason: a sops document is JSON or YAML parsed from a committed file; the envelope test reads it structurally.
const sopsTree = (doc: any): boolean => !!doc && typeof doc === 'object' && !Array.isArray(doc) && !!doc.sops && typeof doc.sops === 'object'
  && typeof doc.sops.mac === 'string' && SOPS_VALUE.test(doc.sops.mac)
  && Object.keys(doc).length > 1 && Object.entries(doc).every(([k, v]) => k === 'sops' || allEncrypted(v));

/**
 * True only for a sops-encrypted file with no plaintext value: binary/json form ({"data": ENC[...], "sops": {...}}),
 * yaml form (every value ENC[...] plus the sops block) or dotenv form (KEY=ENC[...] lines plus sops_* metadata).
 * The sops metadata must carry its mac. A key kept plaintext through `unencrypted_suffix` does not pass.
 */
export function isSopsEnvelope(text: unknown): boolean {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (!src.trim()) return false;
  try { return sopsTree(JSON.parse(src)); } catch { /* not JSON */ }
  const lines = src.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  if (lines.length && lines.every((l) => /^[A-Za-z_]\w*=/.test(l))) {
    const pairs = lines.map((l): [string, string] => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]);
    const meta = pairs.filter(([k]) => k.startsWith('sops_'));
    const vals = pairs.filter(([k]) => !k.startsWith('sops_'));
    return vals.length > 0 && vals.every(([, v]) => SOPS_VALUE.test(v)) && meta.some(([k, v]) => k === 'sops_mac' && SOPS_VALUE.test(v));
  }
  try { return sopsTree(parseYaml(src)); } catch { return false; }
}

/** A refused admission, named by its reason. */
const refusal = (reason: string): Refusal => ({ ok: false, reason });

/** A refused admission, named by its reason. */
export interface Refusal { ok: false; reason: string }
/** The admission of an age envelope. */
export type Admission = Refusal | { ok: true };
type SopsMetadata = Record<string, unknown>;
type AgeEntry = { recipient?: string; enc?: string };
type MetadataRead = { refusal: string; meta?: undefined } | { meta: SopsMetadata | null | undefined; refusal?: undefined };

const DOTENV_AGE_FIELD = /^age__list_(0|[1-9]\d{0,2})__map_(recipient|enc)$/u;

function dotenvMetadataValue(meta: SopsMetadata, age: (AgeEntry | undefined)[], key: string, value: string): string | null {
  const field = DOTENV_AGE_FIELD.exec(key);
  if (field) {
    const entry = (age[Number(field[1])] ??= {});
    entry[field[2] as 'recipient' | 'enc'] = value;
  } else if (key === 'mac_only_encrypted') {
    if (value !== 'false') return 'partial-mac';
    meta[key] = false;
  } else if (key.includes('__')) return 'unsupported-key-group';
  else meta[key] = value;
  return null;
}

function readDotenvMetadata(text: unknown): MetadataRead {
  const pairs = new Map<string, string>();
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (line.includes('\r')) return { refusal: 'unsupported-dotenv' };
    const at = line.indexOf('=');
    if (at < 1) return { refusal: 'unsupported-dotenv' };
    const name = line.slice(0, at);
    if (pairs.has(name)) return { refusal: 'duplicate-key' };
    pairs.set(name, line.slice(at + 1).replaceAll(String.raw`\n`, '\n'));
  }
  const meta: SopsMetadata = {};
  const age: (AgeEntry | undefined)[] = [];
  for (const [name, value] of pairs) {
    if (!name.startsWith('sops_')) continue;
    const reason = dotenvMetadataValue(meta, age, name.slice('sops_'.length), value);
    if (reason) return { refusal: reason };
  }
  // A gap in the list indices is an entry sops never wrote: refused as an empty entry, never skipped.
  meta.age = Array.from(age, (entry) => entry ?? null);
  return { meta };
}

function readStructuredMetadata(text: unknown, format: string): MetadataRead {
  const doc = parseYaml(String(text));
  if (format !== 'yaml') JSON.parse(String(text));
  if (format === 'binary' && (!doc || Object.keys(doc).length !== 2 || !Object.hasOwn(doc, 'data') || !Object.hasOwn(doc, 'sops') || typeof doc.data !== 'string'))
    return { refusal: 'unsupported-binary-shape' };
  return { meta: doc?.sops };
}

function readAgeMetadata(text: unknown, format: string): MetadataRead {
  try {
    return format === 'dotenv' ? readDotenvMetadata(text) : readStructuredMetadata(text, format);
  } catch { return { refusal: 'invalid-envelope' }; }
}

function hasNonAgeProvider(meta: SopsMetadata, providers: readonly string[]): boolean {
  for (const name of providers) {
    const provider = meta[name];
    if (Object.hasOwn(meta, name) && (!Array.isArray(provider) || provider.length)) return true;
  }
  return false;
}

function isAgeEntry(entry: unknown): entry is Record<string, unknown> {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry)
    && !Object.keys(entry).some(name => !['recipient', 'enc'].includes(name));
}

function hasValidAgePayload(entry: Record<string, unknown>): boolean {
  return typeof entry.enc === 'string' && entry.enc.startsWith('-----BEGIN AGE ENCRYPTED FILE-----\n')
    && entry.enc.includes('\n-----END AGE ENCRYPTED FILE-----');
}

function hasValidEnvelopeVersion(meta: SopsMetadata): boolean {
  return typeof meta.version === 'string' && /^\d+\.\d+\.\d+$/.test(meta.version)
    && typeof meta.lastmodified === 'string' && Number.isFinite(Date.parse(meta.lastmodified));
}

function validateAgeMetadata(meta: SopsMetadata | null | undefined, text: unknown, recipient: string): Admission {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || !isSopsEnvelope(text)) return refusal('invalid-envelope');
  if (Object.hasOwn(meta, 'key_groups') || Object.hasOwn(meta, 'shamir_threshold')) return refusal('unsupported-key-group');
  const providers = ['kms', 'gcp_kms', 'hckms', 'azure_kv', 'hc_vault', 'pgp'];
  if (hasNonAgeProvider(meta, providers)) return refusal('non-age-provider');
  const fields = new Set([...providers, 'age', 'lastmodified', 'mac', 'version', 'unencrypted_suffix', 'encrypted_suffix', 'unencrypted_regex', 'encrypted_regex', 'unencrypted_comment_regex', 'encrypted_comment_regex', 'mac_only_encrypted']);
  if (Object.keys(meta).some(name => !fields.has(name))) return refusal('unknown-metadata');
  if (Object.hasOwn(meta, 'mac_only_encrypted') && meta.mac_only_encrypted !== false) return refusal('partial-mac');
  const set = ageSet(meta.age);
  if (!set.ok) return set;
  if (!set.recipients.includes(recipient)) return refusal('recipient-mismatch');
  if (!hasValidEnvelopeVersion(meta)) return refusal('invalid-envelope');
  return { ok: true };
}

const AGE_RECIPIENT = /^age1[ac-hj-np-z02-9]+$/u;

/**
 * The age set of an envelope: one or more entries (the owner key and an environment's server key are the standard pair), each a
 * well-formed recipient with its wrapped data key; an empty entry or a recipient named twice is refused.
 */
function ageSet(entries: unknown): Refusal | { ok: true; recipients: string[] } {
  if (!Array.isArray(entries) || entries.length === 0) return refusal('unsupported-age-set');
  const recipients: string[] = [];
  for (const entry of entries) {
    if (!isAgeEntry(entry) || typeof entry.recipient !== 'string' || !AGE_RECIPIENT.test(entry.recipient) || !hasValidAgePayload(entry))
      return refusal('invalid-age-entry');
    if (recipients.includes(entry.recipient)) return refusal('duplicate-age-recipient');
    recipients.push(entry.recipient);
  }
  return { ok: true, recipients };
}

/**
 * Admit one flat age envelope for the native selected-identity invocation when `recipient` (the selected identity's public key) is
 * one of its age set. Shape admission, never cryptographic proof.
 */
export function selectedAgeEnvelope(text: unknown, format: string, recipient: string): Admission {
  if (!['binary', 'json', 'yaml', 'dotenv'].includes(format)) return refusal('unsupported-format');
  const parsed = readAgeMetadata(text, format);
  if (parsed.refusal) return refusal(parsed.refusal);
  return validateAgeMetadata(parsed.meta, text, recipient);
}

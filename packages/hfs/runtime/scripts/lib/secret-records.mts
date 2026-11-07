// secret-records.mts - the contract of the secrets family's records in the committed check cache (contexts/project/check-cache.md, "The secrets
// records"). The cache is committed, so what the secrets family writes may never be secret material: a record holds codes, paths, positions
// and hashes. The finding's rule is one of the family's codes, its message is the sha256 prefix of the message the run printed (the identity
// the new / known / fixed comparison needs), and the record carries no `data`. The cache writer (hfs cache/secret-records.mts) projects its
// records to this form; the secret judgement of R06 (scripts/hfs/rules/secrets.mts, shared by `starci app check` and the commit hook) judges a
// staged or tracked file of the folder by `secretRecordFaults`, so the file is accepted by what it holds and never by where it sits.
import { createHash } from 'node:crypto';

/** The cache folder of the secrets family, relative to the cache directory. */
export const SECRETS_FOLDER = 'check/secrets';

/** A file of the secrets folder in a tracked tree: `.starcistacks/cache/check/secrets/<area>.jsonl` (an area is a folder path, so the file may sit in subfolders), at the app root or below one. */
export const SECRETS_CACHE_FILE = /(?:^|\/)\.starcistacks\/cache\/check\/secrets\/.+\.jsonl$/;

/** The finding codes of the secrets family: plaintext secrets, sealed custody, untracked secret files. */
export const SECRET_CODES: ReadonlySet<string> = new Set([
  'HFS_PLAINTEXT_SECRET', 'HFS_SECRET_PLAINTEXT_FILE', 'HFS_SECRET_OUTSIDE_ENC', 'HFS_SCRIPT_PLAINTEXT_LOAD', 'HFS_LITE_SECRET_CUSTODY', 'HFS_IDENTITY_CUSTODY',
  'HFS_AGE_KEY_CUSTODY', 'RT_SECRET_TRACKED', 'STACKS_SECRET_ENV_LITERAL', 'STACKS_SECRET_NOT_EXTERNAL', 'STACKS_SECRET_UNVERSIONED', 'SEALED_CUSTODY_LOCATION',
  'APP_SECRET_IN_CI', 'CI_SECRET_SEALED', 'BE_LOG_SECRET', 'BE_SECRET_DEFAULT', 'HFS_DOCKER_SECRETS',
]);

/** The form a stored message takes: `sha256:` and the first 16 hex digits of the sha256 of the message. */
const DIGEST = /^sha256:[0-9a-f]{16}$/;
/** A path a record may name: a relative posix path without control characters, backslashes or colons, never absolute and never leaving the app. */
const SAFE_PATH = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^\u0000-\u001f\\:]*$/u;

/** The stored form of a finding message: the digest of the message. A message already in that form is kept. */
export function messageDigest(message: string): string {
  return DIGEST.test(message) ? message : `sha256:${createHash('sha256').update(message).digest('hex').slice(0, 16)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPath = (value: unknown): boolean => typeof value === 'string' && SAFE_PATH.test(value);

/** The faults of one parsed record of the secrets folder; an empty list is a record that carries no secret material. */
function recordFaults(value: unknown, at: string): string[] {
  if (!isObject(value)) return [`${at} is not a record`];
  const faults: string[] = [];
  const extra = Object.keys(value).filter((key) => !['path', 'step', 'hash', 'findings'].includes(key));
  if (extra.length > 0) faults.push(`${at} carries ${extra.join(', ')}; a secrets record holds path, step, hash and findings only`);
  if (!isPath(value['path'])) faults.push(`${at} path is not a relative posix path`);
  if (value['step'] !== 'secrets') faults.push(`${at} step is not "secrets"`);
  if (typeof value['hash'] !== 'string' || !/^(?:[0-9a-f]{64}|absent)$/.test(value['hash'])) faults.push(`${at} hash is not a sha256`);
  const findings = value['findings'];
  if (!Array.isArray(findings)) return [...faults, `${at} findings is not a list`];
  for (const finding of findings as unknown[]) {
    if (!isObject(finding)) { faults.push(`${at} holds a finding that is not an object`); continue; }
    const keys = Object.keys(finding).sort().join(',');
    if (keys !== 'column,line,message,path,rule') faults.push(`${at} holds a finding with the keys ${keys}; a finding holds path, line, column, rule and message only`);
    if (typeof finding['rule'] !== 'string' || !SECRET_CODES.has(finding['rule'])) faults.push(`${at} holds a finding whose rule is not a code of the secrets family`);
    if (typeof finding['message'] !== 'string' || !DIGEST.test(finding['message'])) faults.push(`${at} holds a finding whose message is not a digest (sha256:<16 hex>)`);
    if (!isPath(finding['path'])) faults.push(`${at} holds a finding whose path is not a relative posix path`);
    if (!Number.isInteger(finding['line']) || !Number.isInteger(finding['column'])) faults.push(`${at} holds a finding whose position is not a pair of integers`);
  }
  return faults;
}

/**
 * The faults of the text of a file of the secrets folder: every line is a record that holds codes, paths, positions and digests, and nothing
 * else. An empty list means the file carries no secret material by construction.
 */
export function secretRecordFaults(text: string): string[] {
  const faults: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return;
    const at = `line ${index + 1}`;
    try { faults.push(...recordFaults(JSON.parse(line), at)); } catch { faults.push(`${at} is not JSON`); }
  });
  return faults;
}

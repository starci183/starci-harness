// secret-records.mts - the writer side of the secrets records contract (runtime/scripts/lib/secret-records.mts): the cache is committed, so the
// records of `check/secrets` are projected to codes, paths, positions and digests before they are stored or compared, whoever produced them.
import { messageDigest, SECRETS_FOLDER, SECRET_CODES } from '../runtime/scripts/lib/secret-records.mjs';
import type { CacheRecord, Finding } from './types.mjs';

export { SECRETS_FOLDER, SECRET_CODES };

/** A finding as the secrets cache stores it: the same code, path and position, the message as its digest. */
export function safeSecretFinding(finding: Finding): Finding {
  return { path: finding.path, line: finding.line, column: finding.column, rule: finding.rule, message: messageDigest(finding.message) };
}

/** The records as the secrets cache stores them: each finding safe, no `data`. */
export function safeSecretRecords(records: readonly CacheRecord[]): CacheRecord[] {
  return records.map((record) => ({ path: record.path, step: record.step, hash: record.hash, findings: record.findings.map(safeSecretFinding) }));
}

import fs from 'node:fs';
import path from 'node:path';
import { parseRecords, serializeRecords } from '../cache/jsonl.mjs';
import { safeSecretRecords } from '../cache/secret-records.mjs';
import { SECRETS_CACHE_FILE, secretRecordFaults } from '../runtime/scripts/lib/secret-records.mjs';
import { relativePosix } from './source-tree.mjs';

/** One cache file the migration rewrites: the records whose message became a digest or whose payload was dropped. */
export interface SecretsCacheChange { file: string; records: number; messagesDigested: number; payloadsDropped: number }
/** One case left for a person: a file whose lines the migration cannot turn into the contract's records. */
export interface SecretsCacheFinding { file: string; code: string; reason: string }
/** The report of a migration (`starci app codemod secrets-cache`). */
export interface SecretsCacheReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: SecretsCacheChange[]; findings: SecretsCacheFinding[];
}

const CACHE_FOLDER = '.starcistacks/cache/check/secrets';

/** Every file of the secrets cache folder under `root`, app-relative and sorted. */
function cacheFiles(root: string): string[] {
  const folder = path.join(root, CACHE_FOLDER);
  if (fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
  return fs.readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relativePosix(root, path.join(entry.parentPath, entry.name)))
    .filter((file) => SECRETS_CACHE_FILE.test(file))
    .sort();
}

/**
 * Migrate the secrets cache of one app to the record contract of the secrets family (contexts/project/check-cache.md, "The secrets records"):
 * every message becomes its digest and a record's `data` is dropped, in the canonical form the cache writes. The migration needs no run of
 * the gate, because the digest of a message is the identity the family compares; a file it cannot read as records is left for a person, who
 * deletes it and runs `starci app check --gate secrets`.
 */
export function migrateSecretsCache({ root, write = false }: { root: string; write?: boolean }): SecretsCacheReport {
  const report: SecretsCacheReport = { schema: 'starci/secrets-cache-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const file of cacheFiles(root)) {
    report.filesScanned += 1;
    const target = path.join(root, file);
    const original = fs.readFileSync(target, 'utf8');
    const parsed = parseRecords(original);
    if (parsed.invalid > 0) {
      report.findings.push({ file, code: 'SECRETS_CACHE_UNREADABLE', reason: `${parsed.invalid} line${parsed.invalid === 1 ? ' is' : 's are'} not a cache record; delete the file and run starci app check --gate secrets` });
      continue;
    }
    const migrated = safeSecretRecords(parsed.records);
    const text = serializeRecords(migrated);
    const remaining = secretRecordFaults(text);
    if (remaining.length > 0) {
      report.findings.push({ file, code: 'SECRETS_CACHE_NOT_MIGRATABLE', reason: `${remaining[0] ?? 'a record'}; delete the file and run starci app check --gate secrets` });
      continue;
    }
    if (text === original) continue;
    const digested = parsed.records.reduce((count, record, index) => count + record.findings.filter((finding, at) => finding.message !== migrated[index]?.findings[at]?.message).length, 0);
    report.filesChanged.push(file);
    report.changes.push({ file, records: parsed.records.length, messagesDigested: digested, payloadsDropped: parsed.records.filter((record) => record.data !== undefined).length });
    if (write) fs.writeFileSync(target, text);
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function secretsCacheMarkdown(report: SecretsCacheReport): string {
  const out = ['# secrets-cache', '', `Scanned ${report.filesScanned} cache files, ${report.filesChanged.length} ${report.write ? 'migrated' : 'would be migrated'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Migrated', '', '| file | records | messages digested | payloads dropped |', '|---|---|---|---|');
    for (const item of report.changes) out.push(`| ${cell(item.file)} | ${item.records} | ${item.messagesDigested} | ${item.payloadsDropped} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

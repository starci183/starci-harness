import fs from 'node:fs';
import path from 'node:path';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { filesUnder, relativePosix } from './source-tree.mjs';

const RETIRED = '@starci/auth-oidc';
const MERGED = '@starci/auth';

/** Each entry of the retired package and the entry of @starci/auth that holds it now. */
export const AUTH_MERGE_ENTRIES: Readonly<Record<string, string>> = Object.freeze({
  [RETIRED]: '@starci/auth/oidc',
  [`${RETIRED}/server`]: '@starci/auth/oidc',
  [`${RETIRED}/contracts`]: '@starci/auth/oidc',
  [`${RETIRED}/client`]: '@starci/auth/client/oidc',
  [`${RETIRED}/testing`]: '@starci/auth/testing',
});

/** One rewrite: a file whose imports moved, or a manifest whose requirement moved. */
export interface AuthMergeChange { file: string; became: string }
/** One case left for a person. */
export interface AuthMergeFinding { file: string; line: number; code: string; reason: string }
/** The report of `starci app codemod auth-merge`. */
export interface AuthMergeReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: AuthMergeChange[]; findings: AuthMergeFinding[];
  /** The `@starci/auth` requirement a rewritten manifest takes: its canon pin. */
  dependency: { name: string; version: string };
}

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** A quoted module specifier of the retired package: the package itself or one of its subpaths. */
const SPECIFIER = /(['"`])(@starci\/auth-oidc(?:\/[^'"`\s]*)?)\1/g;
const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** The `@starci/auth` version a rewritten manifest requires: its canon pin. */
function mergedVersion(): string {
  return bundledPins()[MERGED]?.version ?? '0.6.0';
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** `text` with every specifier of the retired package rewritten to its entry of @starci/auth, and the subpaths that have none. */
export function transformAuthMerge(text: string): { text: string; rewritten: number; unknown: { specifier: string; line: number }[] } {
  let rewritten = 0;
  const unknown: { specifier: string; line: number }[] = [];
  const next = text.replace(SPECIFIER, (all, quote: string, specifier: string, index: number) => {
    const target = AUTH_MERGE_ENTRIES[specifier];
    if (target === undefined) {
      unknown.push({ specifier, line: lineAt(text, index) });
      return all;
    }
    rewritten += 1;
    return `${quote}${target}${quote}`;
  });
  return { text: next, rewritten, unknown };
}

/** Two imports of one module after the rewrite (`/server` and `/contracts` both became `@starci/auth/oidc`): the lint wants one. */
function duplicateImports(text: string): string[] {
  const seen = new Map<string, number>();
  for (const match of text.matchAll(/^\s*import\s+(type\s+)?[^;'"]*?from\s+['"](@starci\/auth\/[^'"]+)['"]/gm)) {
    const key = `${match[1] ?? ''}${match[2] ?? ''}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key.replace(/^type\s+/, ''));
}

type Manifest = Record<string, unknown> & Partial<Record<(typeof SECTIONS)[number], Record<string, string>>>;

/** The exact version a requirement names, as three numbers, or null for a range or a path. */
const exactOf = (value: string): number[] | null => (/^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null);
const below = (left: number[], right: number[]): boolean => {
  for (let index = 0; index < 3; index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  return false;
};

/** The manifest with `@starci/auth-oidc` replaced by `@starci/auth` at its pin in each section that named it, and the sentence of what changed; null when nothing does. */
export function transformManifest(manifest: Manifest, version: string): { manifest: Manifest; became: string } | null {
  const notes: string[] = [];
  const next: Manifest = { ...manifest };
  for (const section of SECTIONS) {
    const requirements = manifest[section];
    if (requirements === undefined || requirements[RETIRED] === undefined) continue;
    const { [RETIRED]: _retired, ...rest } = requirements;
    const current = rest[MERGED];
    const exact = current === undefined ? null : exactOf(current);
    const merged = current === undefined || (exact !== null && below(exact, exactOf(version) ?? [0, 0, 0])) ? version : current;
    next[section] = Object.fromEntries(Object.entries({ ...rest, [MERGED]: merged }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    notes.push(`${section}: ${RETIRED} replaced by ${MERGED} ${merged}`);
  }
  return notes.length === 0 ? null : { manifest: next, became: notes.join('; ') };
}

/** What `migrateAuthMerge` takes: the app root and whether to write. */
export interface AuthMergeOptions { root: string; write?: boolean }

/**
 * Preview or apply the retirement of `@starci/auth-oidc` in one app: every source file's specifiers of the package and its entries become the
 * entries of `@starci/auth` that hold them (`/server` and `/contracts` -> `@starci/auth/oidc`, `/client` -> `@starci/auth/client/oidc`,
 * `/testing` -> `@starci/auth/testing`), and every package.json that required it requires `@starci/auth` at its canon pin instead. A subpath
 * with no new home and two imports of one module after the rewrite are left for a person. A second run finds nothing to do.
 */
export function migrateAuthMerge({ root, write = false }: AuthMergeOptions): AuthMergeReport {
  if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('auth-merge runs at an app root with a package.json');
  const report: AuthMergeReport = { schema: 'starci/auth-merge-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [], dependency: { name: MERGED, version: mergedVersion() } };
  const record = (target: string, became: string, text: string): void => {
    const file = relativePosix(root, target);
    report.filesChanged.push(file);
    report.changes.push({ file, became });
    if (write) fs.writeFileSync(target, text);
  };
  for (const file of filesUnder(root, SOURCE)) {
    report.filesScanned += 1;
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(RETIRED)) continue;
    const result = transformAuthMerge(original);
    for (const entry of result.unknown) report.findings.push({ file: relativePosix(root, file), line: entry.line, code: 'AUTH_MERGE_SUBPATH', reason: `${entry.specifier} has no entry in ${MERGED}; import ${MERGED}/oidc, ${MERGED}/client/oidc or ${MERGED}/testing by hand` });
    if (result.rewritten === 0) continue;
    record(file, `${result.rewritten} import${result.rewritten === 1 ? '' : 's'} of ${RETIRED} now name ${MERGED}`, result.text);
    for (const specifier of duplicateImports(result.text)) report.findings.push({ file: relativePosix(root, file), line: 1, code: 'AUTH_MERGE_DUPLICATE_IMPORT', reason: `two imports of ${specifier} after the rewrite; merge them into one` });
  }
  for (const file of filesUnder(root, /^package\.json$/)) {
    report.filesScanned += 1;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(`"${RETIRED}"`)) continue;
    const manifest = JSON.parse(text.replace(/^\uFEFF/, '')) as Manifest; // reason: package.json parsed from disk; only the dependency sections are read and written
    const result = transformManifest(manifest, report.dependency.version);
    if (result !== null) record(file, `${result.became} (run npm install)`, `${JSON.stringify(result.manifest, null, 2)}\n`);
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the rewrite and what is left for a person as Markdown; JSON consumers read the same report object. */
export function authMergeMarkdown(report: AuthMergeReport): string {
  const out = ['# auth-merge', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'rewritten' : 'would be rewritten'}, ${report.findings.length} left for a person.`, ''];
  if (report.changes.length) out.push('| file | becomes |', '|---|---|', ...report.changes.map((change) => `| ${cell(change.file)} | ${cell(change.became)} |`), '');
  if (report.findings.length) out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|', ...report.findings.map((finding) => `| ${cell(`${finding.file}:${finding.line}`)} | ${finding.code} | ${cell(finding.reason)} |`), '');
  out.push(`${report.dependency.name} ${report.dependency.version} replaces ${RETIRED} in every manifest that required it${report.write ? '; run npm install' : ' (--execute writes)'}.`, '');
  return out.join('\n');
}

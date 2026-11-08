import fs from 'node:fs';
import path from 'node:path';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { filesUnder, relativePosix, sideFolders } from './source-tree.mjs';

const COMMON = '@starci/common';
const ERRORS = 'src/modules/platform/errors';
const PRIMITIVES = 'src/modules/platform/primitives';
const DOMAIN_ERROR_EXPORT = 'export { DomainError, isDomainError } from "@starci/common"\n';

/** One file the migration rewrites into a re-export of `@starci/common`. */
export interface CommonBaseChange { file: string; became: string }
/** One case left for a person. */
export interface CommonBaseFinding { file: string; line: number; code: string; reason: string }
/** The report of a migration (`starci app codemod common-base`). */
export interface CommonBaseReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: CommonBaseChange[]; findings: CommonBaseFinding[];
  /** The `@starci/common` requirement of the app's root package.json: added by `--execute` when a file changed, then `npm install` resolves it. */
  dependency: { name: string; version: string; declared: boolean; added: boolean };
}

/** A file whose whole text becomes one re-export when it still declares what the marker names. */
interface Whole { name: string; marker: RegExp; text: string }

const WHOLE_FILES: readonly Whole[] = [
  { name: `${ERRORS}/domain.error.ts`, marker: /\bclass DomainError\b/, text: DOMAIN_ERROR_EXPORT },
  { name: `${PRIMITIVES}/outcome.contracts.ts`, marker: /\bexport type Outcome</, text: 'export type { Outcome, OutcomeErrorClass, OutcomeOk, OutcomeRefused } from "@starci/common"\n' },
  { name: `${PRIMITIVES}/outcome.mapper.ts`, marker: /\bexport const unwrapOutcome\b/, text: 'export { ok, refused, unwrapOutcome } from "@starci/common"\n' },
  { name: `${PRIMITIVES}/record.policy.ts`, marker: /\bexport const isRecord\b/, text: 'export { isRecord } from "@starci/common"\n' },
  { name: `${PRIMITIVES}/sequence.policy.ts`, marker: /\bexport const eachInOrder\b/, text: 'export { eachInOrder } from "@starci/common"\n' },
];

/** The declarations `errors.contracts.ts` hands to `@starci/common`: the doc comment through the closing line of each. */
const CONTRACT_DECLARATIONS: readonly RegExp[] = [
  /\/\*\*[^]*?\*\/\nexport type ErrorKind =[^]*?\n\n/,
  /\/\*\*[^]*?\*\/\nexport interface ErrorParams \{[^]*?\n\}\n\n?/,
  /\/\*\*[^]*?\*\/\nexport interface DomainErrorInit<C extends string> \{[^]*?\n\}\n\n?/,
];
const CONTRACT_HEAD = 'import type { ErrorKind, ErrorParams } from "@starci/common"\n\nexport type { DomainErrorInit, ErrorKind, ErrorParams } from "@starci/common"\n\n';

/** The text of `errors.contracts.ts` with the three shared declarations replaced by the re-export, or null when one is not there in its template form. */
export function transformErrorContracts(text: string): string | null {
  let rest = text;
  for (const declaration of CONTRACT_DECLARATIONS) {
    if (!declaration.test(rest)) return null;
    rest = rest.replace(declaration, '');
  }
  return `${CONTRACT_HEAD}${rest.replace(/^\n+/, '')}`;
}

/** The `@starci/common` requirement the codemod adds to an app's root package.json. */
function commonVersion(): string {
  return bundledPins()[COMMON]?.version ?? '1.0.0';
}

/** What `migrateCommonBase` takes: the app root and whether to write. */
export interface CommonBaseOptions { root: string; write?: boolean }

/** The line (1-based) of the first match of `pattern` in `text`. */
const lineOf = (text: string, pattern: RegExp): number => text.slice(0, pattern.exec(text)?.index ?? 0).split('\n').length;

/**
 * Preview or apply the move of the shared error base in one app: the `platform/errors` and `platform/primitives` files that still declare
 * `DomainError`, `ErrorKind`, `ErrorParams`, `DomainErrorInit`, `Outcome`, `isRecord` or `eachInOrder` become re-exports of `@starci/common`
 * (every import through `@modules/platform/errors` stays), the root package.json gains the dependency, and a root package that still declares
 * `starci.errorBase` is left for a person (its error classes extend `DomainError` of `@starci/common`).
 */
export function migrateCommonBase({ root, write = false }: CommonBaseOptions): CommonBaseReport {
  const folders = sideFolders(root);
  if (!folders.length) throw new Error('common-base runs at an app root with a be/ directory');
  const packageFile = path.join(root, 'package.json');
  const manifest = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, 'utf8')) as { dependencies?: Record<string, string> } : null; // reason: package.json parsed from disk, only dependencies are read
  const declared = manifest?.dependencies?.[COMMON] !== undefined;
  const report: CommonBaseReport = { schema: 'starci/common-base-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [], dependency: { name: COMMON, version: commonVersion(), declared, added: false } };
  const rewrite = (target: string, text: string, original: string, became: string): void => {
    const file = relativePosix(root, target);
    report.filesChanged.push(file);
    report.changes.push({ file, became });
    if (write && text !== original) fs.writeFileSync(target, text);
  };
  for (const folder of folders) {
    for (const whole of WHOLE_FILES) {
      const target = path.join(folder, whole.name);
      if (!fs.existsSync(target)) continue;
      report.filesScanned += 1;
      const original = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      if (original === whole.text) continue;
      if (whole.marker.test(original)) rewrite(target, whole.text, original, 're-export of @starci/common');
      else report.findings.push({ file: relativePosix(root, target), line: 1, code: 'COMMON_BASE_FILE_CUSTOM', reason: `the file no longer declares what @starci/common owns; make it \`${whole.text.trim()}\` by hand` });
    }
    const contracts = path.join(folder, ERRORS, 'errors.contracts.ts');
    if (fs.existsSync(contracts)) {
      report.filesScanned += 1;
      const original = fs.readFileSync(contracts, 'utf8').replace(/\r\n/g, '\n');
      if (!original.includes('from "@starci/common"')) {
        const text = transformErrorContracts(original);
        if (text === null) report.findings.push({ file: relativePosix(root, contracts), line: lineOf(original, /export (?:type|interface) (?:ErrorKind|ErrorParams|DomainErrorInit)\b/), code: 'COMMON_BASE_CONTRACTS_CUSTOM', reason: 'ErrorKind, ErrorParams or DomainErrorInit is not in its template form; re-export them from @starci/common by hand' });
        else rewrite(contracts, text, original, 'ErrorKind, ErrorParams and DomainErrorInit re-exported from @starci/common');
      }
    }
  }
  const packages = path.join(root, 'packages');
  for (const file of fs.existsSync(packages) ? filesUnder(packages, /^package\.json$/) : []) {
    const text = fs.readFileSync(file, 'utf8');
    if (/"errorBase"/.test(text)) report.findings.push({ file: relativePosix(root, file), line: lineOf(text, /"errorBase"/), code: 'COMMON_BASE_ERROR_BASE', reason: 'extend DomainError of @starci/common in the package errors and delete the starci.errorBase key; the lint stops on it' });
  }
  if (report.filesChanged.length > 0 && !declared && manifest !== null) {
    report.dependency.added = write;
    if (write) {
      manifest.dependencies = Object.fromEntries(Object.entries({ ...manifest.dependencies, [COMMON]: report.dependency.version }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the rewrite and what is left for a person as Markdown; JSON consumers read the same report object. */
export function commonBaseMarkdown(report: CommonBaseReport): string {
  const out = ['# common-base', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'rewritten' : 'would be rewritten'}, ${report.findings.length} left for a person.`, ''];
  if (report.changes.length) out.push('| file | becomes |', '|---|---|', ...report.changes.map((change) => `| ${cell(change.file)} | ${cell(change.became)} |`), '');
  if (report.findings.length) out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|', ...report.findings.map((finding) => `| ${cell(`${finding.file}:${finding.line}`)} | ${finding.code} | ${cell(finding.reason)} |`), '');
  out.push(`Dependency ${report.dependency.name} ${report.dependency.version}: ${report.dependency.declared ? 'declared' : report.dependency.added ? 'added to package.json (run npm install)' : 'not declared (--execute adds it)'}.`, '');
  return out.join('\n');
}

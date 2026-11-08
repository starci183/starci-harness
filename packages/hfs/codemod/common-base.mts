import fs from 'node:fs';
import path from 'node:path';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { filesUnder, relativePosix, sideFolders } from './source-tree.mjs';

const COMMON = '@starci/common';
const ERRORS = 'src/modules/platform/errors';
const PRIMITIVES = 'src/modules/platform/primitives';

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

/** A file whose whole text becomes one re-export of the names it declared, when it still declares what the marker names. */
interface Whole { name: string; marker: RegExp; names: readonly string[]; type: boolean }

/** The one re-export line of a file: only the names the app imports. */
const reexportText = (names: readonly string[], type: boolean): string => `export ${type ? 'type ' : ''}{ ${names.join(', ')} } from "${COMMON}"\n`;

const WHOLE_FILES: readonly Whole[] = [
  { name: `${ERRORS}/domain.error.ts`, marker: /\bclass DomainError\b/, names: ['DomainError', 'isDomainError'], type: false },
  { name: `${PRIMITIVES}/outcome.contracts.ts`, marker: /\bexport type Outcome</, names: ['Outcome', 'OutcomeErrorClass', 'OutcomeOk', 'OutcomeRefused'], type: true },
  { name: `${PRIMITIVES}/outcome.mapper.ts`, marker: /\bexport const unwrapOutcome\b/, names: ['ok', 'refused', 'unwrapOutcome'], type: false },
  { name: `${PRIMITIVES}/record.policy.ts`, marker: /\bexport const isRecord\b/, names: ['isRecord'], type: false },
  { name: `${PRIMITIVES}/sequence.policy.ts`, marker: /\bexport const eachInOrder\b/, names: ['eachInOrder'], type: false },
];

/** The names of `names` the app imports; every name when it imports none (the file keeps its template form and a person decides). */
const usedOf = (names: readonly string[], used: ReadonlySet<string>): string[] => {
  const kept = names.filter((name) => used.has(name));
  return kept.length > 0 ? kept : [...names];
};

/** The name an import or export specifier binds from its source: `type A as B` is `A`. */
const specifierName = (item: string): string => item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '';

/** The names every `import { ... } from` of the app's source binds, outside the files the codemod rewrites and the barrels that pass them on. */
function importedNames(folder: string, skip: ReadonlySet<string>): Set<string> {
  const names = new Set<string>();
  const source = path.join(folder, 'src');
  for (const file of fs.existsSync(source) ? filesUnder(source, /\.tsx?$/) : []) {
    if (skip.has(path.resolve(file))) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
      for (const item of (match[1] ?? '').split(',')) if (specifierName(item) !== '') names.add(specifierName(item));
    }
  }
  return names;
}

/** `text` with `dropped` removed from every `export { ... } from "<specifier>"` line of a barrel, and the line itself when nothing is left. */
export function pruneBarrel(text: string, specifier: string, dropped: readonly string[]): string {
  const lines = text.split('\n').flatMap((line) => {
    const match = /^export (type )?\{([^}]*)\} from (["'])([^"']+)\3\s*$/.exec(line);
    if (match === null || match[4] !== specifier) return [line];
    const items = (match[2] ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '');
    const kept = items.filter((item) => !dropped.includes(specifierName(item)));
    if (kept.length === items.length) return [line];
    return kept.length === 0 ? [] : [`export ${match[1] ?? ''}{ ${kept.join(', ')} } from ${match[3] ?? '"'}${specifier}${match[3] ?? '"'}`];
  });
  return lines.join('\n');
}

/** The declarations `errors.contracts.ts` hands to `@starci/common`: the doc comment through the closing line of each. */
const CONTRACT_DECLARATIONS: readonly RegExp[] = [
  /\/\*\*[^]*?\*\/\nexport type ErrorKind =[^]*?\n\n/,
  /\/\*\*[^]*?\*\/\nexport interface ErrorParams \{[^]*?\n\}\n\n?/,
  /\/\*\*[^]*?\*\/\nexport interface DomainErrorInit<C extends string> \{[^]*?\n\}\n\n?/,
];
const CONTRACT_NAMES: readonly string[] = ['DomainErrorInit', 'ErrorKind', 'ErrorParams'];
const contractHead = (names: readonly string[]): string => `import type { ErrorKind, ErrorParams } from "${COMMON}"

${reexportText(names, true)}
`;

/** The text of `errors.contracts.ts` with the three shared declarations replaced by the re-export, or null when one is not there in its template form. */
export function transformErrorContracts(text: string, names: readonly string[] = CONTRACT_NAMES): string | null {
  let rest = text;
  for (const declaration of CONTRACT_DECLARATIONS) {
    if (!declaration.test(rest)) return null;
    rest = rest.replace(declaration, '');
  }
  return `${contractHead(names)}${rest.replace(/^\n+/, '')}`;
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
    const rewritten = new Set([...WHOLE_FILES.map((whole) => whole.name), `${ERRORS}/errors.contracts.ts`, `${ERRORS}/index.ts`, `${PRIMITIVES}/index.ts`].map((name) => path.resolve(folder, name)));
    const used = importedNames(folder, rewritten);
    const dropped = new Map<string, string[]>();
    for (const whole of WHOLE_FILES) {
      const target = path.join(folder, whole.name);
      if (!fs.existsSync(target)) continue;
      report.filesScanned += 1;
      const original = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      const kept = usedOf(whole.names, used);
      const text = reexportText(kept, whole.type);
      const reexport = original.includes(`from "${COMMON}"`);
      if (!reexport && !whole.marker.test(original)) {
        report.findings.push({ file: relativePosix(root, target), line: 1, code: 'COMMON_BASE_FILE_CUSTOM', reason: `the file no longer declares what @starci/common owns; make it \`${text.trim()}\` by hand` });
        continue;
      }
      if (!reexport) rewrite(target, text, original, 're-export of @starci/common');
      if (!reexport) dropped.set(`./${path.posix.basename(whole.name, '.ts')}`, whole.names.filter((name) => !kept.includes(name)));
      // a re-export has no logic of its own: the specs of that logic live in @starci/common, and BE_SPEC_FORM_ALL_ROLES refuses a spec that tests nothing the app owns
      const spec = target.replace(/\.ts$/, '.spec.ts');
      if (fs.existsSync(spec)) {
        const file = relativePosix(root, spec);
        report.filesChanged.push(file);
        report.changes.push({ file, became: 'deleted: a spec of a re-export, the logic is specified in @starci/common' });
        if (write) fs.rmSync(spec);
      }
    }
    const contracts = path.join(folder, ERRORS, 'errors.contracts.ts');
    if (fs.existsSync(contracts)) {
      report.filesScanned += 1;
      const original = fs.readFileSync(contracts, 'utf8').replace(/\r\n/g, '\n');
      if (!original.includes('from "@starci/common"')) {
        const kept = usedOf(CONTRACT_NAMES, used);
        const text = transformErrorContracts(original, kept);
        if (text === null) report.findings.push({ file: relativePosix(root, contracts), line: lineOf(original, /export (?:type|interface) (?:ErrorKind|ErrorParams|DomainErrorInit)/), code: 'COMMON_BASE_CONTRACTS_CUSTOM', reason: 'ErrorKind, ErrorParams or DomainErrorInit is not in its template form; re-export them from @starci/common by hand' });
        else {
          rewrite(contracts, text, original, `${kept.join(', ')} re-exported from @starci/common`);
          dropped.set('./errors.contracts', CONTRACT_NAMES.filter((name) => !kept.includes(name)));
        }
      }
    }
    // the barrels pass on only what is still exported: a name nobody imports is dropped from them, or HFS_UNUSED_EXPORT names it
    for (const barrelName of [`${ERRORS}/index.ts`, `${PRIMITIVES}/index.ts`]) {
      const barrel = path.join(folder, barrelName);
      if (!fs.existsSync(barrel)) continue;
      const original = fs.readFileSync(barrel, 'utf8').replace(/\r\n/g, '\n');
      const text = [...dropped].reduce((current, [specifier, names]) => pruneBarrel(current, specifier, names), original);
      if (text !== original) rewrite(barrel, text, original, 'names nobody imports no longer re-exported');
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

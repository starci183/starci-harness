// i18n-locales.mts - FE_I18N_LOCALE_MISSING (R60): every locale a front-end app declares has its catalog, and every catalog is a declared locale.
// FE_I18N_CATALOG holds the catalogs that exist to the same keys, so a declared locale with no catalog at all passed it: next-intl then serves that
// locale with no messages. The locales are the `locales` of the app's `defineI18n({...})` call (@starci/next-i18n, FE-I18N-1) in a file of
// `apps/<app>/src/modules/i18n/`, read as a TypeScript syntax tree: an array literal of string literals, written inline or as a const of the
// same file (`as const` and `satisfies` unwrapped). A computed list, a spread or a description kept in a shared package is not judged. Each
// declared locale needs `apps/<app>/src/modules/i18n/messages/<locale>.json`, and a catalog of a locale the description does not declare is
// dead copy. Reported in `--env local`, blocking in `--env prod` (the code is localOnly). Paths are side-relative (the fe side folder).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Parsed, Repo, Ts } from './rule-types.mjs';

export const FE_I18N_LOCALE_MISSING = 'FE_I18N_LOCALE_MISSING';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = /\.[cm]?tsx?$/u;

/** The expression under `as const`, `satisfies T` and parentheses. */
function unwrap(ts: Ts, node: Parsed): Parsed {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression;
  return current;
}

/** The string elements of an array literal, or null when any element is not a plain string literal. */
function stringsOf(ts: Ts, node: Parsed): string[] | null {
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const values: string[] = [];
  for (const element of node.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) return null;
    values.push(element.text);
  }
  return values;
}

/** The initializer of the top-level `const <name> = ...` of the file, or null. */
function constOf(ts: Ts, sourceFile: Parsed, name: string): Parsed {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer ?? null;
    }
  }
  return null;
}

/** The locales the first `defineI18n({ locales })` of `text` declares as literals, or null when the file has none or they are not literal. */
export function declaredLocales(ts: Ts, file: string, text: string): string[] | null {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let locales: string[] | null = null;
  let seen = false;
  const visit = (node: Parsed): void => {
    if (seen) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineI18n') {
      seen = true;
      const description = unwrap(ts, node.arguments[0]);
      if (!description || !ts.isObjectLiteralExpression(description)) return;
      for (const property of description.properties) {
        if (!property.name || !ts.isIdentifier(property.name) || property.name.text !== 'locales') continue;
        const value = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) ? unwrap(ts, property.initializer) : null;
        const literal = value && ts.isIdentifier(value) ? unwrap(ts, constOf(ts, sourceFile, value.text)) : value;
        locales = stringsOf(ts, literal);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return locales;
}

/** The findings of one `next` app of the fe side. */
function appFindings(ts: Ts, repoRoot: string, app: string, files: readonly string[]): Finding[] {
  const i18n = `apps/${app}/src/modules/i18n/`;
  const messages = `${i18n}messages/`;
  let declared: string[] | null = null;
  let where = '';
  for (const file of files.filter((entry) => entry.startsWith(i18n) && !entry.startsWith(messages) && SOURCE.test(entry)).sort(byCodeUnit)) {
    const text = readText(repoRoot, file);
    if (text === null || !text.includes('defineI18n')) continue;
    declared = declaredLocales(ts, file, text);
    where = file;
    if (declared !== null) break;
  }
  if (declared === null) return [];
  const catalogs = new Set(files.filter((file) => file.startsWith(messages) && file.endsWith('.json') && !file.slice(messages.length).includes('/')).map((file) => file.slice(messages.length, -'.json'.length)));
  const findings: Finding[] = [];
  for (const locale of [...new Set(declared)].sort(byCodeUnit)) {
    if (!catalogs.has(locale)) findings.push(found(FE_I18N_LOCALE_MISSING, `${messages}${locale}.json`, `${where} declares the locale ${locale}, but ${messages}${locale}.json is not tracked: a declared locale is served with no messages; write its catalog with the keys every other locale holds, or drop the locale from defineI18n (R60, FE-I18N-3)`, { app, locale, local: true }));
  }
  for (const locale of [...catalogs].sort(byCodeUnit)) {
    if (!declared.includes(locale)) findings.push(found(FE_I18N_LOCALE_MISSING, `${messages}${locale}.json`, `${messages}${locale}.json is the catalog of ${locale}, which ${where} does not declare in defineI18n: no reader is ever served it; declare the locale or delete the catalog (R60, FE-I18N-3)`, { app, locale, local: true }));
  }
  return findings;
}

/** R60 locale presence for every `next` app of the fe side (`repoRoot` the fe side folder, `files` side-relative). */
export function localeCatalogFindings({ repoRoot, files, repo }: { repoRoot: string; files: readonly string[]; repo: Repo }): Finding[] {
  const apps = (repo.apps ?? []).filter((app: Parsed) => app?.kind === 'next').map((app: Parsed) => String(app.name));
  if (apps.length === 0) return [];
  const ts = loadTypescript(repoRoot, HERE);
  if (ts === null) return [];
  return apps.flatMap((app) => appFindings(ts, repoRoot, app, files));
}

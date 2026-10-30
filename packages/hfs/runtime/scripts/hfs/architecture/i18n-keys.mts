import fs from 'node:fs';
import path from 'node:path';
import type { CallExpression, Expression, Node, PropertyAssignment, StringLiteralLike, TemplateExpression, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { MachineContext } from './machine-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { escapeRegExp } from '../../lib/regex.mjs';

/**
 * R106 `i18n-keys` (FE_I18N_KEYS). The catalogs of an app (`apps/<app>/src/modules/i18n/messages/<locale>.json`, slot fe.modules.i18n) and
 * the source that reads them agree, both ways. The key sets of the locales agree with each other (FE_I18N_CATALOG, `starci app check`); this
 * rule holds the source to the catalogs:
 *
 *   - a key read with a literal is in every locale: `useTranslations("ns")` / `getTranslations("ns")` (also `{ namespace }`, `await`)
 *     imported from `next-intl` or `next-intl/server`, then `t("key")`, `t.rich("key")`, `t.raw("key")`, `t.markup("key")` inside the app's
 *     own source (both branches of a conditional key are read). A key no locale's catalog holds is FE_I18N_KEYS, once per call. A computed
 *     key (a template with an interpolation, a variable) is not judged here; it counts as a read.
 *   - a key nobody reads is dead: a leaf of the app's catalogs that no string in the app's or the shared packages' source can be reading.
 *     A leaf counts as read when a string literal or a template pattern (each interpolation a wildcard within its dotted segment) equals a
 *     tail of its dotted path (`"title"`, `"card.title"`, `"orders.card.title"` all read `orders.card.title`); the test is deliberately loose
 *     so a key handed through props or a table of keys is never reported, and only a key that appears nowhere is.
 *
 * Reads the source of the program and the JSON catalogs on disk; the wording of a translation is the product owner's.
 */
export const I18N_KEYS_RULE_IDS = ['FE_I18N_KEYS'];

const RULE = 'FE_I18N_KEYS';
const MODULES = new Set(['next-intl', 'next-intl/server']);
const FACTORIES = new Set(['useTranslations', 'getTranslations']);
const READERS = new Set(['rich', 'raw', 'markup']);
const APP_SOURCE = /^apps\/([^/]+)\/src\//u;

/** One segment of a key pattern: literal text, `*` for a pure wildcard, or a regular expression for a partial interpolation. */
type PatternSegment = string | RegExp;

/** A locale catalog file of an app. */
interface Catalog {
  rel: string;
  locale: string;
}

/** A catalog with the dotted leaf paths it holds. */
interface LoadedCatalog extends Catalog {
  leaves: Set<string>;
}

type ReportAt = (file: GraphFile, node: Node, message: string, extra?: Record<string, unknown>) => void;

/** What one file's translation-read scan shares. */
interface ReadContext {
  ts: TypeScriptApi;
  file: GraphFile;
  checker: TypeChecker;
  namespaces: Map<Node, string>;
  loaded: LoadedCatalog[];
  app: string;
  report: ReportAt;
}

const leavesOf = (value: unknown, prefix = ''): string[] => (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length
  ? Object.entries(value).flatMap(([key, child]) => leavesOf(child, prefix ? `${prefix}.${key}` : key))
  : [prefix]);

const readCatalog = (root: string, rel: string): Set<string> | null => {
  try { return new Set(leavesOf(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))).filter(Boolean)); } catch { return null; }
};

/** True when the key `full` is a leaf of `leaves` or a namespace above one (an object read by `rich`, `raw` or a nested `t`). */
const held = (leaves: Set<string>, full: string): boolean => leaves.has(full) || [...leaves].some(leaf => leaf.startsWith(`${full}.`));

// A pattern that is only wildcards (`${a}`, `${a}.${b}`) names nothing: it would read every key, so it reads none.
const tailMatches = (pattern: PatternSegment[], leafSegments: string[]): boolean => pattern.some(segment => segment !== '*' && segment !== '') && pattern.length <= leafSegments.length
  && pattern.every((segment, index) => {
    const leaf = leafSegments[leafSegments.length - pattern.length + index];
    return segment instanceof RegExp ? segment.test(leaf as string) : segment === '*' || segment === leaf;
  });

function catalogsPerApp(config: ArchitectureConfig, graph: HfsGraph): Map<string, Catalog[]> {
  const catalogs = new Map<string, Catalog[]>();
  const seen = new Set<string>();
  for (const file of graph.files.values()) {
    const app = APP_SOURCE.exec(file.rel)?.[1];
    if (!app || seen.has(app)) continue;
    seen.add(app);
    const dir = `apps/${app}/src/modules/i18n/messages/`;
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(config.root, dir)).filter(name => name.endsWith('.json')).sort(byCodeUnit); } catch { /* the app has no catalog directory: FE_I18N_PLACEMENT's finding */ }
    if (names.length) catalogs.set(dir, names.map(name => ({ rel: `${dir}${name}`, locale: name.slice(0, -5) })));
  }
  return catalogs;
}

/** Each interpolation can fill part or all of a segment; the template's static fragments keep their literal spelling. */
function templatePatternOf(node: TemplateExpression): PatternSegment[] {
  const pattern: PatternSegment[] = [];
  for (const segment of [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join('\u0000').split('.')) {
    if (!segment.includes('\u0000')) { pattern.push(segment); continue; }
    const parts = segment.split('\u0000');
    pattern.push(parts.every(part => part === '') ? '*' : new RegExp(`^${parts.map((part) => escapeRegExp(part)).join('.*')}$`, 'su'));
  }
  return pattern;
}

function patternsOf(ts: TypeScriptApi, files: GraphFile[]): PatternSegment[][] {
  const patterns: PatternSegment[][] = [];
  for (const file of files) {
    const visit = (node: Node): void => {
      if (ts.isStringLiteralLike(node)) patterns.push(node.text.split('.'));
      else if (ts.isTemplateExpression(node)) patterns.push(templatePatternOf(node));
      ts.forEachChild(node, visit);
    };
    visit(file.sourceFile);
  }
  return patterns;
}

function translationFactories(ts: TypeScriptApi, file: GraphFile): Set<string> {
  const factories = new Set<string>();
  for (const statement of file.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !MODULES.has(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if (!element.isTypeOnly && FACTORIES.has((element.propertyName ?? element.name).text)) factories.add(element.name.text);
    }
  }
  return factories;
}

function namespaceForCall(ts: TypeScriptApi, file: GraphFile, init: Expression, factories: Set<string>): string | null {
  let expression: Expression = init;
  if (ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || !factories.has(expression.expression.text)) return null;
  const [first] = expression.arguments;
  if (first === undefined) return '';
  if (ts.isStringLiteralLike(first)) return first.text;
  if (!ts.isObjectLiteralExpression(first)) return null;
  const property = first.properties.find((candidate): candidate is PropertyAssignment => ts.isPropertyAssignment(candidate) && candidate.name.getText(file.sourceFile) === 'namespace');
  if (!property) return '';
  return ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null;
}

function translatorNamespaces(ts: TypeScriptApi, file: GraphFile, factories: Set<string>): Map<Node, string> {
  const namespaces = new Map<Node, string>();
  const collect = (node: Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const namespace = namespaceForCall(ts, file, node.initializer, factories);
      if (namespace !== null) namespaces.set(node, namespace);
    }
    ts.forEachChild(node, collect);
  };
  collect(file.sourceFile);
  return namespaces;
}

function keysOf(ts: TypeScriptApi, argument: Expression): StringLiteralLike[] {
  if (ts.isConditionalExpression(argument)) return [...keysOf(ts, argument.whenTrue), ...keysOf(ts, argument.whenFalse)];
  if (ts.isParenthesizedExpression(argument) || ts.isAsExpression(argument) || ts.isSatisfiesExpression(argument)) return keysOf(ts, argument.expression);
  return ts.isStringLiteralLike(argument) ? [argument] : [];
}

function reportCallKeys(reads: ReadContext, node: CallExpression): void {
  const { ts, file, checker, namespaces, loaded, app, report } = reads;
  const callee = node.expression;
  let owner = ts.isIdentifier(callee) ? callee : null;
  if (ts.isPropertyAccessExpression(callee) && READERS.has(callee.name.text) && ts.isIdentifier(callee.expression)) owner = callee.expression;
  const [first] = node.arguments;
  const declaration = owner ? checker.getSymbolAtLocation(owner)?.valueDeclaration : null;
  if (!owner || first === undefined || !declaration || !namespaces.has(declaration)) return;
  for (const literal of keysOf(ts, first)) {
    const namespace = namespaces.get(declaration);
    const full = namespace ? `${namespace}.${literal.text}` : literal.text;
    const lacking = loaded.filter(catalog => !held(catalog.leaves, full)).map(catalog => catalog.locale);
    if (lacking.length) report(file, literal, `${file.rel} reads "${full}" and ${lacking.join(', ')} ${lacking.length === 1 ? 'holds' : 'hold'} no such key; add it to every catalog of ${app} or read a key that exists`, { key: full, locales: lacking });
  }
}

function reportTranslationReads(ts: TypeScriptApi, file: GraphFile, checker: TypeChecker, namespaces: Map<Node, string>, loaded: LoadedCatalog[], app: string, report: ReportAt): void {
  const reads: ReadContext = { ts, file, checker, namespaces, loaded, app, report };
  const read = (node: Node): void => {
    if (ts.isCallExpression(node)) reportCallKeys(reads, node);
    ts.forEachChild(node, read);
  };
  read(file.sourceFile);
}

function reportUnusedCatalogKeys(primary: LoadedCatalog, loaded: LoadedCatalog[], patterns: PatternSegment[][], app: string, violations: ArchitectureViolation[]): void {
  const every = new Set(loaded.flatMap(catalog => [...catalog.leaves]));
  for (const leaf of [...every].sort(byCodeUnit)) {
    const segments = leaf.split('.');
    if (patterns.some(pattern => tailMatches(pattern, segments))) continue;
    violations.push({ ruleId: RULE, path: primary.rel, line: 1, column: 1, message: `${primary.rel} holds the key "${leaf}" and no source of ${app} or the shared packages reads it; delete the key from every catalog`, key: leaf });
  }
}

export function checkI18nKeys({ config, graph, context }: { config: ArchitectureConfig; graph: HfsGraph; context: MachineContext }): { violations: ArchitectureViolation[]; coverage: { status: string; apps: number } } {
  const ts = context.ts;
  const violations: ArchitectureViolation[] = [];
  const report: ReportAt = (file, node, message, extra = {}) => {
    const at = file.sourceFile.getLineAndCharacterOfPosition(node.getStart(file.sourceFile));
    violations.push({ ruleId: RULE, path: file.rel, line: at.line + 1, column: at.character + 1, message, ...extra });
  };

  const catalogsByApp = catalogsPerApp(config, graph);

  let apps = 0;
  for (const [dir, catalogs] of catalogsByApp) {
    const app = /^apps\/([^/]+)\//u.exec(dir)?.[1];
    const loaded = catalogs.map(catalog => ({ ...catalog, leaves: readCatalog(config.root, catalog.rel) })).filter((catalog): catalog is LoadedCatalog => Boolean(catalog.leaves));
    if (!app || !loaded.length) continue;
    apps += 1;
    const own = [...graph.files.values()].filter(file => file.rel.startsWith(`apps/${app}/src/`));
    const shared = [...graph.files.values()].filter(file => /^packages\/[^/]+\/src\//u.test(file.rel));
    const patterns = patternsOf(ts, [...own, ...shared]);

    for (const file of own) {
      const factories = translationFactories(ts, file);
      if (!factories.size) continue;
      const checker = context.checkerFor(file.sourceFile.fileName);
      const namespaces = translatorNamespaces(ts, file, factories);
      if (!namespaces.size) continue;
      reportTranslationReads(ts, file, checker, namespaces, loaded, app, report);
    }

    const [primary] = [...loaded].sort((a, b) => a.locale.localeCompare(b.locale));
    reportUnusedCatalogKeys(primary as LoadedCatalog, loaded, patterns, app, violations);
  }
  return { violations, coverage: { status: 'checked', apps } };
}

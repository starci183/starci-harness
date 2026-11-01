import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import { shadowed } from './small-renames.mjs';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');
type Node = TsTypes.Node;
type Opening = TsTypes.JsxOpeningElement | TsTypes.JsxSelfClosingElement;
type Element = TsTypes.JsxElement | TsTypes.JsxSelfClosingElement;

/** One Grammar import specifier: the exported name, the local name and the declaration that brought it in. */
interface Binding { imported: string; local: string; declaration: TsTypes.ImportDeclaration; specifier: TsTypes.ImportSpecifier }
/** One text edit of the source. */
interface Edit { start: number; end: number; text: string }
/** One safe rewrite of the report. */
export interface PageNavigationChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface PageNavigationFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod page-navigation`). */
export interface PageNavigationReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: PageNavigationChange[]; findings: PageNavigationFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

/** Layouts that became a kind of `Grid`: the JSX element is rewritten and the import follows. */
const GRID_KINDS: ReadonlyMap<string, { kind: string; code: string }> = new Map([
  ['PrimaryRailLayout', { kind: 'main-rail', code: 'PRIMARY_RAIL_LAYOUT_GRID' }],
  ['FormGrid', { kind: 'form', code: 'FORM_GRID_GRID' }],
]);

/** Exports a person migrates: the finding sits on the import (and on a namespace member use). */
const REMOVED: ReadonlyMap<string, { code: string; reason: string }> = new Map([
  ['PageHeader', { code: 'PAGE_HEADER_LOOSE', reason: 'PageHeader is Page internals: pass its props as the `header` of the route Page (data, not an element)' }],
  ['PageHeaderProps', { code: 'PAGE_HEADER_LOOSE', reason: 'PageHeaderProps is gone: type the header as PageHeaderContent' }],
  ['PageContainer', { code: 'PAGE_CONTAINER_LOOSE', reason: 'PageContainer is Page internals: the body of Page is the container (`measure` picks its width); a landing band is a Page section' }],
  ['PageContainerProps', { code: 'PAGE_CONTAINER_LOOSE', reason: 'PageContainerProps is gone: Page takes `measure` itself' }],
  ['Breadcrumbs', { code: 'BREADCRUMBS_LOOSE', reason: 'Breadcrumbs is Page internals: pass the trail as Page `header.breadcrumbs`' }],
  ['BreadcrumbsProps', { code: 'BREADCRUMBS_LOOSE', reason: 'BreadcrumbsProps is gone: type the trail as PageHeaderBreadcrumbs' }],
  ['FillViewport', { code: 'FILL_VIEWPORT_PAGE', reason: 'FillViewport is gone: a page that fills the region is `Page chrome="bleed"` (its body is the measured fill box; `minHeight` is its floor)' }],
  ['FillViewportProps', { code: 'FILL_VIEWPORT_PAGE', reason: 'FillViewportProps is gone: use PageProps with chrome="bleed"' }],
  ['FillViewportMinHeight', { code: 'FILL_VIEWPORT_PAGE', reason: 'FillViewportMinHeight is gone: use PageMinHeight' }],
  ['FillViewportBottomInset', { code: 'FILL_VIEWPORT_PAGE', reason: 'FillViewportBottomInset is gone: a bleed body reaches the viewport edge' }],
  ['Rail', { code: 'RAIL_GRID', reason: 'Rail is gone: the rail slot of `Grid kind="main-rail"` holds the subordinate content' }],
  ['RailProps', { code: 'RAIL_GRID', reason: 'RailProps is gone: the rail is the `rail` slot of Grid kind="main-rail"' }],
  ['NavigationFeatureNav', { code: 'NAVIGATION_FEATURE_NAV_TOP_BAR', reason: 'NavigationFeatureNav is gone: use TopBar (identity is `brand`, the compact trigger is `menu`, the feature row is `subnavigation` with `subnavigationLabel`)' }],
  ['NavigationFeatureNavProps', { code: 'NAVIGATION_FEATURE_NAV_TOP_BAR', reason: 'NavigationFeatureNavProps is gone: use TopBarProps' }],
  ['Subnav', { code: 'REMOVED_COMPONENT', reason: 'Subnav is gone: a section identity is the TopBar `menu`, a second layer is its `subnavigation`' }],
  ['SubnavProps', { code: 'REMOVED_COMPONENT', reason: 'SubnavProps is gone with Subnav' }],
  ['BottomNav', { code: 'REMOVED_COMPONENT', reason: 'BottomNav is gone: a bottom tab bar is refused (R316); navigate with the Sidebar drawer or TopBar menu' }],
  ['BottomNavItem', { code: 'REMOVED_COMPONENT', reason: 'BottomNavItem is gone with BottomNav' }],
  ['BottomNavProps', { code: 'REMOVED_COMPONENT', reason: 'BottomNavProps is gone with BottomNav' }],
  ['PrimaryRailLayoutProps', { code: 'PRIMARY_RAIL_LAYOUT_GRID', reason: 'PrimaryRailLayoutProps is gone: type the layout as GridProps' }],
  ['FormGridProps', { code: 'FORM_GRID_GRID', reason: 'FormGridProps is gone: type the layout as GridProps' }],
]);

/** Migrate the page and navigation names with source edits; a case with no mechanical rewrite keeps its source and gains a finding. */
export function transformPageNavigation({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: PageNavigationChange[]; findings: PageNavigationFinding[] } {
  const changes: PageNavigationChange[] = [];
  const findings: PageNavigationFinding[] = [];
  if (!text.includes('@starci/grammar')) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);

  const bindings = new Map<string, Binding>();
  const namespaces = new Set<string>();
  const foreign = new Set<string>();
  const grammarDeclarations: TsTypes.ImportDeclaration[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const grammar = ts.isStringLiteral(statement.moduleSpecifier) && GRAMMAR.test(statement.moduleSpecifier.text);
      if (grammar) grammarDeclarations.push(statement);
      if (clause?.name) foreign.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) (grammar ? namespaces : foreign).add(named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const specifier of named.elements) {
          if (grammar) bindings.set(specifier.name.text, { imported: specifier.propertyName?.text ?? specifier.name.text, local: specifier.name.text, declaration: statement, specifier });
          else foreign.add(specifier.name.text);
        }
      }
    }
  }
  if (!bindings.size && !namespaces.size) return { text, changes, findings };

  const edits: Edit[] = [];
  const gone = new Set<Node>();
  const additions = new Map<TsTypes.ImportDeclaration, string[]>();
  const edit = (start: number, end: number, replacement: string): void => { edits.push({ start, end, text: replacement }); };
  const flag = (node: Node, code: string, reason: string, component?: string): void => {
    findings.push({ file, ...sourceLocation(source, node), code, reason, ...(component === undefined ? {} : { component }), source: node.getText(source).slice(0, 200) });
  };
  const boundTo = (name: string): Binding | undefined => [...bindings.values()].find(binding => binding.imported === name);

  /** The text to write for `Grid` next to a tag: the namespace member, an existing binding, or a new specifier in the same declaration. */
  const gridFor = (binding: Binding | null, namespace: string | null): string | null => {
    if (namespace) return `${namespace}.Grid`;
    const existing = boundTo('Grid');
    if (existing) return existing.local;
    if (foreign.has('Grid') || !binding) return null;
    if (!(additions.get(binding.declaration) ?? []).includes('Grid')) additions.set(binding.declaration, [...additions.get(binding.declaration) ?? [], 'Grid']);
    return 'Grid';
  };

  // Every reference of a bound name, bar property names and import positions, with the shadowed ones left out.
  const references = new Map<string, TsTypes.Identifier[]>();
  const isReference = (identifier: TsTypes.Identifier): boolean => {
    const parent = identifier.parent;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
    if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isJsxAttribute(parent)) && parent.name === identifier) return false;
    return !(ts.isQualifiedName(parent) && parent.right === identifier);
  };
  const collect = (node: Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && bindings.has(node.text) && isReference(node) && !shadowed(ts, node)) references.set(node.text, [...references.get(node.text) ?? [], node]);
    ts.forEachChild(node, collect);
  };
  collect(source);

  const visitElement = (element: Element, opening: Opening): void => {
    const tag = opening.tagName;
    let name: string | null = null;
    let binding: Binding | null = null;
    let namespace: string | null = null;
    if (ts.isIdentifier(tag)) {
      binding = bindings.get(tag.text) ?? null;
      if (binding && !shadowed(ts, tag)) name = binding.imported;
      else binding = null;
    } else if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && !shadowed(ts, tag.expression)) {
      name = tag.name.text;
      namespace = tag.expression.text;
    }
    if (name === null) return;
    const grid = GRID_KINDS.get(name);
    if (grid === undefined) return;
    const props = opening.attributes.properties;
    if (props.some(ts.isJsxSpreadAttribute)) { flag(element, 'SPREAD_PROPS', `${name} takes a spread: rewrite by hand as Grid kind="${grid.kind}"`, name); return; }
    if (props.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'className')) {
      flag(element, 'LAYOUT_CLASS_NAME', `${name} carries a className and Grid takes none: the kind decides the layout; rewrite by hand as Grid kind="${grid.kind}"`, name);
      return;
    }
    const replacement = gridFor(binding, namespace);
    if (replacement === null) { flag(element, 'IMPORT_NAME_CONFLICT', 'Grid is already bound to something that is not the grammar export; rewrite by hand', name); return; }
    edit(tag.getStart(source), tag.end, `${replacement} kind="${grid.kind}"`);
    if (ts.isIdentifier(tag)) gone.add(tag);
    if (ts.isJsxElement(element)) {
      const closing = element.closingElement.tagName;
      edit(closing.getStart(source), closing.end, replacement);
      if (ts.isIdentifier(closing)) gone.add(closing);
    }
    changes.push({ file, ...sourceLocation(source, element), code: grid.code, from: name, to: `Grid kind="${grid.kind}"` });
  };

  const visit = (node: Node): void => {
    if (ts.isJsxElement(node)) visitElement(node, node.openingElement);
    else if (ts.isJsxSelfClosingElement(node)) visitElement(node, node);
    // Namespace members outside a rewritten tag: removed exports (a tag is a property access too).
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && !ts.isJsxClosingElement(node.parent)) {
      const removed = REMOVED.get(node.name.text);
      const rewritten = GRID_KINDS.has(node.name.text) && (ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent)) && edits.some(item => item.start === node.getStart(source));
      if (removed && !rewritten) flag(node, removed.code, removed.reason);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Imports left for a person.
  for (const binding of bindings.values()) {
    const removed = REMOVED.get(binding.imported);
    if (removed) flag(binding.specifier, removed.code, removed.reason);
    if (GRID_KINDS.has(binding.imported)) {
      const left = (references.get(binding.local) ?? []).filter(identifier => !gone.has(identifier));
      if (left.length) flag(binding.specifier, GRID_KINDS.get(binding.imported)?.code ?? 'REMOVED_COMPONENT', `${binding.imported} is used outside a rewritten tag: use Grid kind="${GRID_KINDS.get(binding.imported)?.kind}" by hand`);
    }
  }

  // Import declarations: drop the layouts nothing references any more, add Grid.
  const dropped = new Set<TsTypes.ImportSpecifier>();
  for (const binding of bindings.values()) {
    if (!GRID_KINDS.has(binding.imported)) continue;
    const refs = references.get(binding.local) ?? [];
    if (refs.length && refs.every(identifier => gone.has(identifier))) dropped.add(binding.specifier);
  }
  for (const declaration of grammarDeclarations) {
    const clause = declaration.importClause;
    const named = clause?.namedBindings;
    if (!clause || !named || !ts.isNamedImports(named)) continue;
    const adds = additions.get(declaration) ?? [];
    if (!adds.length && !named.elements.some(specifier => dropped.has(specifier))) continue;
    const list = [...named.elements.filter(specifier => !dropped.has(specifier)).map(specifier => specifier.getText(source)), ...adds];
    if (!list.length) {
      if (clause.name) edit(clause.name.end, named.end, '');
      else edit(declaration.getStart(source), declaration.end + (text.startsWith('\r\n', declaration.end) ? 2 : text.startsWith('\n', declaration.end) ? 1 : 0), '');
    } else edit(named.getStart(source), named.end, /\n/.test(named.getText(source)) ? `{\n  ${list.join(',\n  ')},\n}` : `{ ${list.join(', ')} }`);
  }

  edits.sort((first, second) => first.start - second.start || first.end - second.end);
  const unique: Edit[] = [];
  for (const current of edits) {
    const previous = unique.at(-1);
    if (previous && previous.start === current.start && previous.end === current.end && previous.text === current.text) continue;
    if (previous && current.start < previous.end) {
      return { text, changes: [], findings: [...findings, { file, line: 1, column: 1, code: 'EDIT_CONFLICT', reason: 'two rewrites overlap: nothing in this file was changed; migrate by hand' }] };
    }
    unique.push(current);
  }
  let output = text;
  for (const current of unique.reverse()) output = output.slice(0, current.start) + current.text + output.slice(current.end);
  return { text: output, changes, findings };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.[jt]sx$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply the safe rewrites in one app's FE tree; every unresolved case is retained in the returned report. */
export function migratePageNavigation({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): PageNavigationReport {
  if (!ts) throw new Error('page-navigation needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('page-navigation runs at an app root with a fe/ directory');
  const report: PageNavigationReport = { schema: 'starci/page-navigation-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformPageNavigation({ ts, text: original, file });
    report.filesScanned += 1;
    report.changes.push(...result.changes);
    report.findings.push(...result.findings);
    if (result.text !== original) {
      report.filesChanged.push(file);
      if (write) fs.writeFileSync(target, result.text);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function pageNavigationMarkdown(report: PageNavigationReport): string {
  const out = ['# page-navigation', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(`${finding.file}:${finding.line}:${finding.column}`)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Rewrites', '', '| location | code | from | to |', '|---|---|---|---|');
    for (const item of report.changes) out.push(`| ${cell(`${item.file}:${item.line}:${item.column}`)} | ${item.code} | \`${cell(item.from)}\` | \`${cell(item.to)}\` |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

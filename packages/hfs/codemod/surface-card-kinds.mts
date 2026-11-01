import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import type * as TsTypes from 'typescript';

type Ts = typeof import('typescript');
type Node = TsTypes.Node;
type Opening = TsTypes.JsxOpeningElement | TsTypes.JsxSelfClosingElement;
type Element = TsTypes.JsxElement | TsTypes.JsxSelfClosingElement;

/** One safe rewrite of the report. */
export interface SurfaceCardKindsChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface SurfaceCardKindsFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod surface-card-kinds`). */
export interface SurfaceCardKindsReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: SurfaceCardKindsChange[]; findings: SurfaceCardKindsFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);
/** Props of `SurfaceListCard` that have no counterpart on `SurfaceCard kind="list"`. */
const LIST_DROPPED = new Set(['depth', 'labelHidden', 'isVerdict', 'isScrollable']);
/** Props of `ListRow` a mechanical rewrite can carry into a list item. */
const ROW_PROPS = new Set(['title', 'description', 'state', 'verdict', 'key']);
/** Props of the card that are gone: dropped when they only restate the default, reported otherwise. */
const CARD_GONE: ReadonlyMap<string, { code: string; reason: string; defaultValue?: string }> = new Map([
  ['composition', { code: 'JOINED_TO_BANDS', reason: 'composition="joined" is gone: a joined card is kind="bands" (body, figures or media faces, then at most one collection); each one needs a look', defaultValue: 'single' }],
  ['placement', { code: 'PANEL_CARD', reason: 'placement="panel" is gone: a docked panel is a Pane of a PaneGrid, not a card', defaultValue: 'floating' }],
  ['scroll', { code: 'CARD_SCROLL', reason: 'scroll is gone: a card sizes to its content; a region that scrolls is a Pane', defaultValue: 'page' }],
  ['isScrollable', { code: 'CARD_SCROLL', reason: 'isScrollable is gone: a card sizes to its content; a region that scrolls is a Pane' }],
]);
const REMOVED = new Map([
  ['SurfaceListCard', 'SurfaceListCard is gone: a list is SurfaceCard kind="list"'],
  ['SurfaceAccordionCard', 'SurfaceAccordionCard is gone: an accordion is SurfaceCard kind="accordion" with title, meta and body per item'],
  ['StaticStateRow', 'StaticStateRow is gone: a row is an item of SurfaceCard kind="list"'],
  ['ListRow', 'ListRow is internal: a row is an item of SurfaceCard kind="list"'],
]);

interface Edit { start: number; end: number; text: string }

/** Migrate the list, stat-strip and dropped-prop uses of the card with source edits; every other case gains a finding. */
export function transformSurfaceCardKinds({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: SurfaceCardKindsChange[]; findings: SurfaceCardKindsFinding[] } {
  const changes: SurfaceCardKindsChange[] = [];
  const findings: SurfaceCardKindsFinding[] = [];
  if (!text.includes('@starci/grammar')) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);

  const bindings = new Map<string, { imported: string; specifier: TsTypes.ImportSpecifier; declaration: TsTypes.ImportDeclaration }>();
  const namespaces = new Set<string>();
  const declarations: TsTypes.ImportDeclaration[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !GRAMMAR.test(statement.moduleSpecifier.text)) continue;
    declarations.push(statement);
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) for (const specifier of named.elements) bindings.set(specifier.name.text, { imported: specifier.propertyName?.text ?? specifier.name.text, specifier, declaration: statement });
  }
  if (!bindings.size && !namespaces.size) return { text, changes, findings };

  const edits: Edit[] = [];
  const edit = (start: number, end: number, replacement: string): void => { edits.push({ start, end, text: replacement }); };
  const flag = (node: Node, code: string, reason: string, component?: string): void => {
    findings.push({ file, ...sourceLocation(source, node), code, reason, ...(component === undefined ? {} : { component }), source: node.getText(source).slice(0, 200) });
  };
  const change = (node: Node, code: string, from: string, to: string): void => { changes.push({ file, ...sourceLocation(source, node), code, from, to }); };
  const gone = new Set<Node>();
  let needsCard = false;

  const exportOf = (tag: TsTypes.JsxTagNameExpression): string | null => {
    if (ts.isIdentifier(tag)) return bindings.get(tag.text)?.imported ?? null;
    return ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) ? tag.name.text : null;
  };
  const cardLocal = [...bindings.values()].find(binding => binding.imported === 'SurfaceCard');
  const cardTag = (tag: TsTypes.JsxTagNameExpression): string => ts.isPropertyAccessExpression(tag) ? `${tag.expression.getText(source)}.SurfaceCard` : cardLocal ? cardLocal.specifier.name.text : 'SurfaceCard';
  const attributes = (opening: Opening): Map<string, TsTypes.JsxAttribute> => new Map(opening.attributes.properties.filter(ts.isJsxAttribute).map((prop): [string, TsTypes.JsxAttribute] => [prop.name.getText(source), prop]));
  const spread = (opening: Opening): boolean => opening.attributes.properties.some(ts.isJsxSpreadAttribute);
  const literal = (attribute: TsTypes.JsxAttribute | undefined): string | null => {
    const value = attribute?.initializer;
    if (value && ts.isStringLiteralLike(value)) return value.text;
    return value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression) ? value.expression.text : null;
  };
  /** The expression text of a prop value: a string literal as written, `{x}` as `x`. */
  const valueText = (attribute: TsTypes.JsxAttribute): string | null => {
    const value = attribute.initializer;
    if (!value) return null;
    if (ts.isJsxExpression(value)) return value.expression ? value.expression.getText(source) : null;
    return value.getText(source);
  };
  const meaningful = (element: Element): TsTypes.JsxChild[] => ts.isJsxElement(element) ? element.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)) : [];

  /** A row element as the text of its list item, or the reason it cannot be one. */
  const rowItem = (element: TsTypes.JsxChild | TsTypes.Expression): { item: string } | { reason: string } => {
    if (!(ts.isJsxElement(element) || ts.isJsxSelfClosingElement(element))) return { reason: 'a row is not a ListRow or StaticStateRow element' };
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const name = exportOf(opening.tagName);
    if (spread(opening)) return { reason: 'a row has spread props' };
    const props = attributes(opening);
    if (name === 'ListRow') {
      if (ts.isJsxElement(element) && meaningful(element).length) return { reason: 'a ListRow has children (a detail region): move them to the item `detail`' };
      const other = [...props.keys()].filter(prop => !ROW_PROPS.has(prop));
      if (other.length) return { reason: `a ListRow carries ${other.join(', ')}: rewrite the leading, badges and actions as item data by hand` };
      const key = props.get('key');
      const id = key ? valueText(key) : null;
      const title = props.get('title');
      const title_ = title ? valueText(title) : null;
      if (id === null || title_ === null) return { reason: 'a ListRow without a key or a title cannot become an item' };
      const parts = [`id: ${id}`, `title: ${title_}`];
      for (const prop of ['description', 'state', 'verdict']) { const attribute = props.get(prop); const value = attribute ? valueText(attribute) : null; if (value !== null) parts.push(`${prop}: ${value}`); }
      return { item: `{ ${parts.join(', ')} }` };
    }
    if (name === 'StaticStateRow') {
      const item = props.get('item')?.initializer;
      const expression = item && ts.isJsxExpression(item) ? item.expression : undefined;
      if (!expression || !ts.isObjectLiteralExpression(expression)) return { reason: 'a StaticStateRow item is not an object literal' };
      const parts: string[] = [];
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return { reason: 'a StaticStateRow item has a spread or a method' };
        const key = property.name.getText(source);
        const value = ts.isPropertyAssignment(property) ? property.initializer.getText(source) : key;
        parts.push(`${key === 'label' ? 'title' : key}: ${value}`);
      }
      return { item: `{ ${parts.join(', ')} }` };
    }
    return { reason: 'a row is not a ListRow or StaticStateRow element' };
  };

  const convertList = (element: Element, opening: Opening): void => {
    const component = opening.tagName.getText(source);
    if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry removed props; rewrite by hand', component); return; }
    const rows = meaningful(element);
    let itemsText: string;
    let rowEdit: Edit | null = null;
    if (rows.length === 0) itemsText = '[]';
    else if (rows.every(row => ts.isJsxElement(row) || ts.isJsxSelfClosingElement(row))) {
      const items = rows.map(row => rowItem(row));
      const bad = items.find((entry): entry is { reason: string } => 'reason' in entry);
      if (bad) { flag(element, 'LIST_ROW_SHAPE', bad.reason, component); return; }
      itemsText = `[${items.map(entry => 'item' in entry ? entry.item : '').join(', ')}]`;
    } else if (rows.length === 1 && rows[0] && ts.isJsxExpression(rows[0]) && rows[0].expression) {
      const expression = rows[0].expression;
      const call = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'map' ? expression : null;
      const callback = call?.arguments[0];
      if (!call || !callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) { flag(element, 'LIST_CHILDREN', 'the rows are not written as direct rows or one .map', component); return; }
      let returned: TsTypes.Expression | undefined = ts.isArrowFunction(callback) && !ts.isBlock(callback.body) ? callback.body : undefined;
      let wrapped = false;
      if (returned && ts.isParenthesizedExpression(returned)) { returned = returned.expression; wrapped = true; }
      const only = ts.isBlock(callback.body) && callback.body.statements.length === 1 ? callback.body.statements[0] : undefined;
      if (!returned && only && ts.isReturnStatement(only)) {
        returned = only.expression;
        wrapped = true;
      }
      const entry = returned ? rowItem(returned) : { reason: 'the .map callback does not return one row' };
      if ('reason' in entry) { flag(element, 'LIST_ROW_SHAPE', entry.reason, component); return; }
      if (!returned) return;
      const base = expression.getStart(source);
      rowEdit = { start: returned.getStart(source) - base, end: returned.end - base, text: wrapped ? entry.item : `(${entry.item})` };
      itemsText = expression.getText(source);
    } else { flag(element, 'LIST_CHILDREN', 'the rows are not written as direct rows or one .map', component); return; }

    const kept: string[] = [];
    let hasEmpty = false;
    for (const prop of opening.attributes.properties) {
      if (!ts.isJsxAttribute(prop)) continue;
      const name = prop.name.getText(source);
      if (LIST_DROPPED.has(name)) { change(prop, 'LIST_PROP_DROPPED', prop.getText(source), ''); continue; }
      if (name === 'empty') hasEmpty = true;
      kept.push(name === 'isLoading' ? prop.getText(source).replace('isLoading', 'isSkeleton') : prop.getText(source));
    }
    if (!hasEmpty) {
      kept.push('empty={null}');
      flag(element, 'LIST_EMPTY', 'a list answers for its empty state: `empty={null}` was added as a placeholder; give it an EmptyNotice', component);
    }
    let itemsAttribute = `items={${itemsText}}`;
    if (rowEdit) itemsAttribute = `items={${itemsText.slice(0, rowEdit.start)}${rowEdit.text}${itemsText.slice(rowEdit.end)}}`;
    const tag = cardTag(opening.tagName);
    needsCard = true;
    edit(element.getStart(source), element.end, `<${tag} kind="list" ${kept.join(' ')} ${itemsAttribute} />`);
    const markGone = (node: Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxClosingElement(node)) && ts.isIdentifier(node.tagName)) gone.add(node.tagName);
      ts.forEachChild(node, markGone);
    };
    markGone(element);
    change(element, 'SURFACE_LIST_CARD_KIND', 'SurfaceListCard', 'SurfaceCard kind="list"');
  };

  const convertCard = (element: Element, opening: Opening): void => {
    const component = opening.tagName.getText(source);
    const props = attributes(opening);
    // Stat strip as the card's one child becomes kind="figures".
    const children = meaningful(element);
    const only = children.length === 1 ? children[0] : undefined;
    if (only && (ts.isJsxElement(only) || ts.isJsxSelfClosingElement(only))) {
      const inner = ts.isJsxElement(only) ? only.openingElement : only;
      if (exportOf(inner.tagName) === 'DescriptionList' && literal(attributes(inner).get('layout')) === 'stat-strip') {
        const innerProps = attributes(inner);
        const itemsInitializer = innerProps.get('items')?.initializer;
        const array = itemsInitializer && ts.isJsxExpression(itemsInitializer) ? itemsInitializer.expression : undefined;
        const elements = array && ts.isArrayLiteralExpression(array) ? [...array.elements] : undefined;
        const objects = elements?.filter(ts.isObjectLiteralExpression);
        if (!objects || objects.length !== elements?.length || spread(opening) || spread(inner) || props.has('composition')) {
          flag(element, 'FIGURES_BY_HAND', 'the stat strip is not an array literal of object literals in a card of its own: move it to SurfaceCard kind="figures" by hand', component);
          return;
        }
        const renamed = objects.map(object => `{ ${object.properties.map(property => {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return property.getText(source);
          const key = property.name.getText(source);
          return key === 'description' && ts.isPropertyAssignment(property) ? `value: ${property.initializer.getText(source)}` : property.getText(source);
        }).join(', ')} }`);
        const kept = opening.attributes.properties.filter(ts.isJsxAttribute).filter(prop => !CARD_GONE.has(prop.name.getText(source))).map(prop => prop.getText(source));
        const loading = innerProps.get('isLoading');
        if (loading) kept.push(loading.getText(source).replace('isLoading', 'isSkeleton'));
        if (!props.has('label') && !props.has('ariaLabel')) flag(element, 'FIGURES_NEED_NAME', 'a figures card needs a label or an ariaLabel', component);
        edit(element.getStart(source), element.end, `<${component} kind="figures" ${kept.join(' ')} items={[${renamed.join(', ')}]} />`);
        for (const tagName of [inner.tagName]) if (ts.isIdentifier(tagName)) gone.add(tagName);
        change(element, 'STAT_STRIP_FIGURES', 'SurfaceCard > DescriptionList layout="stat-strip"', 'SurfaceCard kind="figures"');
        return;
      }
    }
    for (const [name, gonePart] of CARD_GONE) {
      const attribute = props.get(name);
      if (!attribute) continue;
      if (gonePart.defaultValue !== undefined && literal(attribute) === gonePart.defaultValue) { change(attribute, 'CARD_PROP_DEFAULT', attribute.getText(source), ''); edit(attribute.getFullStart(), attribute.end, ''); continue; }
      flag(attribute, gonePart.code, gonePart.reason, component);
    }
    const height = props.get('height');
    if (height && literal(height) === 'auto') { change(height, 'CARD_PROP_DEFAULT', height.getText(source), ''); edit(height.getFullStart(), height.end, ''); }
    // A card inside a card is a design decision.
    for (let at: Node | undefined = element.parent; at; at = at.parent) {
      if ((ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) && exportOf((ts.isJsxElement(at) ? at.openingElement : at).tagName) === 'SurfaceCard') {
        flag(element, 'NESTED_CARD', 'a surface never stands inside another surface: make the inner card a body band of kind="bands", or lift it out', component);
        break;
      }
    }
  };

  const visit = (node: Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = exportOf(opening.tagName);
      if (name === 'SurfaceListCard') convertList(node, opening);
      else if (name === 'SurfaceCard') convertCard(node, opening);
      else if (name === 'SurfaceAccordionCard') flag(node, 'ACCORDION_BY_HAND', REMOVED.get('SurfaceAccordionCard') ?? '', opening.tagName.getText(source));
      else if (name === 'Grid' && literal(attributes(opening).get('kind')) === 'cards') {
        const labelled = ts.isJsxElement(node) ? node.children.filter(child => (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && exportOf((ts.isJsxElement(child) ? child.openingElement : child).tagName) === 'SurfaceCard' && attributes(ts.isJsxElement(child) ? child.openingElement : child).has('label')) : [];
        if (labelled.length >= 2) flag(node, 'LABEL_IN_GRID', 'labelled cards repeated in a Grid of cards are tiles: use SurfaceCard kind="tile" (name, mark, description, badge, action), or one kind="list" card when the peers are compared', opening.tagName.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Imports: add SurfaceCard when a rewrite needs it, drop what nothing uses, report what is still used.
  const stillUsed = new Map<string, Node>();
  const scan = (node: Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && bindings.has(node.text) && !gone.has(node)) {
      const parent = node.parent;
      const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isJsxAttribute(parent) && parent.name === node);
      if (!isName && !stillUsed.has(node.text)) stillUsed.set(node.text, node);
    }
    ts.forEachChild(node, scan);
  };
  scan(source);
  const dropped = new Set<TsTypes.ImportSpecifier>();
  for (const [local, binding] of bindings) {
    if (!REMOVED.has(binding.imported)) continue;
    if (stillUsed.has(local)) flag(binding.specifier, 'REMOVED_COMPONENT', REMOVED.get(binding.imported) ?? '');
    else dropped.add(binding.specifier);
  }
  const addCard = needsCard && !cardLocal;
  let added = false;
  for (const declaration of declarations) {
    const clause = declaration.importClause;
    const named = clause?.namedBindings;
    if (!clause || !named || !ts.isNamedImports(named)) continue;
    const insert: boolean = addCard && !added;
    if (!insert && !named.elements.some(specifier => dropped.has(specifier))) continue;
    added = added || insert;
    const kept = named.elements.filter(specifier => !dropped.has(specifier)).map(specifier => specifier.getText(source));
    const list = [...kept, ...(insert ? ['SurfaceCard'] : [])];
    if (!list.length) edit(declaration.getStart(source), declaration.end + (text.startsWith('\r\n', declaration.end) ? 2 : text.startsWith('\n', declaration.end) ? 1 : 0), '');
    else edit(named.getStart(source), named.end, /\n/.test(named.getText(source)) ? `{\n  ${list.join(',\n  ')},\n}` : `{ ${list.join(', ')} }`);
  }

  edits.sort((first, second) => first.start - second.start || first.end - second.end);
  const unique: Edit[] = [];
  for (const current of edits) {
    const previous = unique.at(-1);
    if (previous && previous.start === current.start && previous.end === current.end && previous.text === current.text) continue;
    if (previous && current.start < previous.end) {
      return { text, changes: [], findings: [...findings, { file, line: 1, column: 1, code: 'EDIT_CONFLICT', reason: 'two rewrites overlap (a card inside a rewritten card): nothing in this file was changed; migrate by hand' }] };
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

/** Preview or apply the safe card rewrites in one app's FE tree; every unresolved case is retained in the returned report. */
export function migrateSurfaceCardKinds({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): SurfaceCardKindsReport {
  if (!ts) throw new Error('surface-card-kinds needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('surface-card-kinds runs at an app root with a fe/ directory');
  const report: SurfaceCardKindsReport = { schema: 'starci/surface-card-kinds-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformSurfaceCardKinds({ ts, text: original, file });
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
export function surfaceCardKindsMarkdown(report: SurfaceCardKindsReport): string {
  const out = ['# surface-card-kinds', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
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

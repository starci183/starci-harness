import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import type * as TsTypes from 'typescript';
import { shadowed } from './small-renames.mjs';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');
type Node = TsTypes.Node;
type Opening = TsTypes.JsxOpeningElement | TsTypes.JsxSelfClosingElement;

/** One text edit of the source. */
interface Edit { start: number; end: number; text: string }
/** One safe rewrite of the report. */
export interface LoadingStatesChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface LoadingStatesFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod loading-states`). */
export interface LoadingStatesReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: LoadingStatesChange[]; findings: LoadingStatesFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.git', 'storybook-static']);
/** A file worth parsing at all: it names something this codemod looks at. */
const RELEVANT = /isSkeleton|loadingRows|loadingContent|DataSlot|Skeleton|Placeholder|isValidating|Slot\b|\?\?\s*\[\s*\]|\brows\b/;

/** Grammar components that lost `loadingRows`: the Grammar draws its own default rows. */
const LOADING_ROWS = new Set(['Section', 'SurfaceCard', 'ListBox', 'Timeline', 'DataTable']);
const HAND_SKELETONS = new Set(['Skeleton', 'ChatBubbleSkeletons', 'MessageBubbleSkeletons']);
/** The status flags a DataSlot member is made of; `items` belongs to the ready member only. */
const FLAG_KEYS = new Set(['isLoading', 'isError', 'isForbidden', 'isEmpty']);
const SLOT_LITERAL_REASON = 'build the slot with slotOfQuery, slotOfReads, mapSlot, or one flag member';
const LOADING_NAME = /^(?:isLoading|loading|isPending|status)$/;
const STATUS_KEYS = new Set(['isLoading', 'isError', 'error']);
const SLOT_NAME = /slot$/i;
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const VALIDATING_REASON = 'a background refresh never drives a loading flag or a status: a skeleton is isLoading (no data yet) alone';

/** Migrate the loading-state vocabulary with source edits; a case with no mechanical rewrite keeps its source and gains a finding. */
export function transformLoadingStates({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: LoadingStatesChange[]; findings: LoadingStatesFinding[] } {
  const changes: LoadingStatesChange[] = [];
  const findings: LoadingStatesFinding[] = [];
  if (!RELEVANT.test(text)) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const normalized = file.replaceAll('\\', '/');
  const reportsFindings = !TEST_FILE.test(normalized);
  const inHooks = /(?:^|\/)hooks\//.test(normalized) && !/(?:^|\/)hooks\/swr\//.test(normalized);

  const flag = (node: Node, code: string, reason: string, component?: string): void => {
    if (!reportsFindings) return;
    findings.push({ file, ...sourceLocation(source, node), code, reason, ...(component === undefined ? {} : { component }), source: node.getText(source).slice(0, 200) });
  };
  const change = (node: Node, code: string, from: string, to: string): void => { changes.push({ file, ...sourceLocation(source, node), code, from, to }); };
  const edits: Edit[] = [];
  const edit = (start: number, end: number, replacement: string): void => { edits.push({ start, end, text: replacement }); };

  // Grammar imports: bindings by local name and namespaces.
  const bindings = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !GRAMMAR.test(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) for (const specifier of named.elements) bindings.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
  }

  /** The Grammar export a JSX tag names (through an import, an alias or a namespace), or null. */
  const grammarExport = (tag: TsTypes.JsxTagNameExpression): string | null => {
    if (ts.isIdentifier(tag)) return shadowed(ts, tag) ? null : bindings.get(tag.text) ?? null;
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && !shadowed(ts, tag.expression)) return tag.name.text;
    return null;
  };
  const tagLocalName = (tag: TsTypes.JsxTagNameExpression): string | null => ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? tag.name.text : null;
  const attributeOf = (opening: Opening, name: string): TsTypes.JsxAttribute | undefined =>
    opening.attributes.properties.find((attribute): attribute is TsTypes.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name);

  // Data slots: names declared with a `DataSlot<...>` annotation (variable, parameter or property signature) anywhere in the file.
  const isSlotType = (type: TsTypes.TypeNode | undefined): boolean => {
    if (!type) return false;
    if (ts.isParenthesizedTypeNode(type)) return isSlotType(type.type);
    if (ts.isUnionTypeNode(type)) return type.types.some(isSlotType);
    if (!ts.isTypeReferenceNode(type)) return false;
    const name = type.typeName;
    return (ts.isIdentifier(name) ? name.text : name.right.text) === 'DataSlot';
  };
  const nameOf = (name: TsTypes.PropertyName | TsTypes.BindingName): string | null => ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
  const slotNames = new Set<string>();
  const collect = (node: Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && isSlotType(node.type)) {
      const name = nameOf(node.name);
      if (name) slotNames.add(name);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  /** Functions of the file declared to return a DataSlot: an object literal passed to one is in a slot context. */
  const slotFunctions = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isSlotType(statement.type)) slotFunctions.add(statement.name.text);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && isSlotType(init.type)) slotFunctions.add(declaration.name.text);
    }
  }

  const unwrap = (node: TsTypes.Expression): TsTypes.Expression => {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    return current;
  };
  /** An identifier or property access named like a declared DataSlot. */
  const isSlotRef = (node: TsTypes.Expression): boolean => {
    const value = unwrap(node);
    if (ts.isIdentifier(value)) return slotNames.has(value.text);
    return ts.isPropertyAccessExpression(value) && slotNames.has(value.name.text);
  };
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Whether `node` sits in a branch that narrows `receiver` by a flag or by `"items" in receiver`. */
  const narrowed = (node: Node, receiver: string): boolean => {
    const name = escapeRegExp(receiver);
    const narrows = new RegExp(`"items"\\s+in\\s+${name}\\b|\\b${name}\\.is(?:Loading|Error|Forbidden|Empty)\\b`);
    const mentions = (expression: Node): boolean => narrows.test(expression.getText(source).replaceAll('?.', '.'));
    for (let child: Node = node, at: Node | undefined = node.parent; at; child = at, at = at.parent) {
      if (ts.isIfStatement(at) && at.thenStatement === child && mentions(at.expression)) return true;
      if (ts.isConditionalExpression(at) && at.whenTrue === child && mentions(at.condition)) return true;
      if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && at.right === child && mentions(at.left)) return true;
      if (ts.isCaseClause(at) && ts.isCaseBlock(at.parent) && ts.isSwitchStatement(at.parent.parent) && mentions(at.parent.parent.expression)) return true;
      if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
    }
    return false;
  };

  const hasKey = (literal: TsTypes.ObjectLiteralExpression, matches: (key: string) => boolean): boolean =>
    literal.properties.some(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && matches(nameOf(property.name) ?? ''));
  const slotLiterals = new Set<TsTypes.ObjectLiteralExpression>();
  const legacyLiterals = new Set<TsTypes.ObjectLiteralExpression>();
  const itemsOf = (literal: TsTypes.ObjectLiteralExpression): TsTypes.PropertyAssignment | undefined =>
    literal.properties.find((property): property is TsTypes.PropertyAssignment => ts.isPropertyAssignment(property) && nameOf(property.name) === 'items');
  const isUndefined = (expression: TsTypes.Expression): boolean => { const value = unwrap(expression); return ts.isIdentifier(value) && value.text === 'undefined'; };
  /** The object literals a typed slot position yields: the expression itself, through parentheses and conditional branches. */
  const literalsOf = (expression: TsTypes.Expression | undefined): TsTypes.ObjectLiteralExpression[] => {
    if (!expression) return [];
    const value = unwrap(expression);
    if (ts.isObjectLiteralExpression(value)) return [value];
    if (ts.isConditionalExpression(value)) return [...literalsOf(value.whenTrue), ...literalsOf(value.whenFalse)];
    return [];
  };

  /** Whether the file reads the status of the read `name`: `name.isLoading`, `name.error`, or `isLoading` destructured (for a bare `data`). */
  const readsStatus = (name: string): boolean => {
    const escaped = escapeRegExp(name);
    return new RegExp(`\\b${escaped}\\??\\.(?:isLoading|error|isError)\\b`).test(text) || new RegExp(`\\{[^}]*\\b(?:isLoading|error)\\b[^}]*\\}\\s*=\\s*${escaped}\\b`).test(text) || (name === 'data' && /\bisLoading\b/.test(text));
  };
  const rootOf = (input: TsTypes.Expression): string | null => {
    let current = unwrap(input);
    for (;;) {
      if (ts.isIdentifier(current)) return current.text;
      if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isCallExpression(current)) current = unwrap(current.expression);
      else return null;
    }
  };
  const placeholder = (node: Node, initializer: TsTypes.Expression | undefined): void => {
    if (!initializer) return;
    let value = initializer;
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
    if (!ts.isObjectLiteralExpression(value)) return;
    const emptied = value.properties.some(property => ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer) && property.initializer.elements.length === 0);
    if (emptied) flag(node, 'PLACEHOLDER_OBJECT', 'a placeholder is the ready tree with its data stripped to []: let the component rest as itself with a loading flag');
  };

  /** Whether `node` is inside a JSX attribute of an element that resolves to a Grammar export (a breadcrumb item, for one). */
  const insideGrammarAttribute = (node: Node): boolean => {
    for (let at: Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isJsxAttribute(at)) {
        const opening = at.parent.parent;
        return (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) && grammarExport(opening.tagName) !== null;
      }
      if (ts.isSourceFile(at)) return false;
    }
    return false;
  };

  const visit = (node: Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const exported = grammarExport(node.tagName);
      const local = tagLocalName(node.tagName);
      if (exported !== null) {
        const skeleton = attributeOf(node, 'isSkeleton');
        if (skeleton && attributeOf(node, 'isLoading')) flag(skeleton, 'LOADING_NAME_CONFLICT', 'the element has isSkeleton and isLoading both: merge them into isLoading by hand', exported);
        else if (skeleton) {
          edit(skeleton.name.getStart(source), skeleton.name.end, 'isLoading');
          change(skeleton, 'RENAME_IS_SKELETON', 'isSkeleton', 'isLoading');
        }
        const loadingRows = attributeOf(node, 'loadingRows');
        if (loadingRows && LOADING_ROWS.has(exported)) {
          edit(loadingRows.getFullStart(), loadingRows.end, '');
          change(loadingRows, 'REMOVE_LOADING_ROWS', loadingRows.getText(source), '');
        }
        const rows = attributeOf(node, 'rows');
        if (rows && exported === 'MessageBubble' && (skeleton || attributeOf(node, 'isLoading'))) {
          edit(rows.getFullStart(), rows.end, '');
          change(rows, 'REMOVE_BUBBLE_ROWS', rows.getText(source), '');
        }
        const content = attributeOf(node, 'loadingContent');
        if (content && exported === 'DataTable') flag(content, 'LOADING_CONTENT', 'loadingContent is removed: the table draws its own loading rows', exported);
      }
      if (local !== null && HAND_SKELETONS.has(local)) flag(node, 'HAND_SKELETON', 'the Grammar component draws its loading structure from isLoading; pass the status, not a skeleton', local);
    }

    if (ts.isPropertyAccessExpression(node) && node.name.text === 'items' && isSlotRef(node.expression) && !narrowed(node, unwrap(node.expression).getText(source).replaceAll('?.', '.'))) {
      flag(node, 'SLOT_ITEMS_ACCESS', 'items exists only on the ready member: narrow with `"items" in slot` or render through SlotView');
    }

    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && isSlotType(node.type)) for (const literal of literalsOf(node.initializer)) slotLiterals.add(literal);
    if (ts.isArrowFunction(node) && isSlotType(node.type) && !ts.isBlock(node.body)) for (const literal of literalsOf(node.body)) slotLiterals.add(literal);
    if (ts.isReturnStatement(node)) {
      for (let at: Node | undefined = node.parent; at; at = at.parent) {
        if (!ts.isFunctionLike(at)) continue;
        if (isSlotType(at.type)) for (const literal of literalsOf(node.expression)) slotLiterals.add(literal);
        break;
      }
    }
    if (ts.isObjectLiteralExpression(node) && hasKey(node, key => key === 'items') && hasKey(node, key => FLAG_KEYS.has(key))) legacyLiterals.add(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && slotFunctions.has(node.expression.text)) for (const argument of node.arguments) for (const literal of literalsOf(argument)) slotLiterals.add(literal);
    if (ts.isParameter(node) && isSlotType(node.type)) for (const literal of literalsOf(node.initializer)) slotLiterals.add(literal);

    if (inHooks && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && ts.isArrayLiteralExpression(node.right) && node.right.elements.length === 0) {
      const left = unwrap(node.left);
      const isData = (ts.isPropertyAccessExpression(left) && left.name.text === 'data') || (ts.isIdentifier(left) && left.text === 'data');
      const isMap = ts.isCallExpression(left) && ts.isPropertyAccessExpression(left.expression) && left.expression.name.text === 'map';
      const root = isData || isMap ? rootOf(left) : null;
      if (root !== null && !readsStatus(root)) flag(node, 'SWR_DEFAULT_ARRAY', "return the read's status with the list, or fold every read of the frame with slotOfReads");
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (LOADING_NAME.test(node.name.text) && node.initializer && /\bisValidating\b/.test(node.initializer.getText(source))) flag(node, 'VALIDATING_AS_LOADING', VALIDATING_REASON);
      if (/Placeholder$/.test(node.name.text)) placeholder(node, node.initializer);
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && nameOf(node.name) === 'isSkeleton' && insideGrammarAttribute(node)) {
      if (ts.isPropertyAssignment(node) && !hasKey(node.parent, key => key === 'isLoading')) {
        edit(node.name.getStart(source), node.name.end, 'isLoading');
        change(node, 'RENAME_IS_SKELETON', 'isSkeleton', 'isLoading');
      } else flag(node, 'IS_SKELETON_KEY', 'isSkeleton is now isLoading: rename the key by hand (a shorthand or a second isLoading key blocks the rewrite)');
    }
    if (ts.isPropertyAssignment(node)) {
      const key = nameOf(node.name);
      if (key !== null && LOADING_NAME.test(key) && /\bisValidating\b/.test(node.initializer.getText(source))) flag(node, 'VALIDATING_AS_LOADING', VALIDATING_REASON);
      if (key !== null && /Placeholder$/.test(key)) placeholder(node, node.initializer);
      const value = unwrap(node.initializer);
      if (key !== null && STATUS_KEYS.has(key) && ts.isPropertyAccessExpression(value) && value.name.text === key) {
        const owner = unwrap(value.expression);
        const ownerName = ts.isIdentifier(owner) ? owner.text : ts.isPropertyAccessExpression(owner) ? owner.name.text : null;
        if (ownerName !== null && SLOT_NAME.test(ownerName)) flag(node, 'FOREIGN_SLOT_STATUS', "a slot takes its loading and error from its own reads, never from another slot's: build it with slotOfReads");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const literal of slotLiterals) {
    legacyLiterals.delete(literal);
    const items = itemsOf(literal);
    if (literal.properties.some(property => ts.isSpreadAssignment(property)) || (items && ts.isConditionalExpression(unwrap(items.initializer)))) { flag(literal, 'SLOT_LITERAL', SLOT_LITERAL_REASON); continue; }
    if (!items) continue;
    const others = literal.properties.filter(property => property !== items);
    const flagged = others.filter(property => FLAG_KEYS.has(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) ? nameOf(property.name) ?? '' : ''));
    if (!isUndefined(items.initializer)) {
      if (flagged.length) flag(literal, 'SLOT_LITERAL', SLOT_LITERAL_REASON);
      continue;
    }
    if (!others.length) {
      edit(literal.getStart(source), literal.end, '{ isEmpty: true }');
      change(literal, 'SLOT_LITERAL_FLAGS', literal.getText(source), '{ isEmpty: true }');
      continue;
    }
    const [only] = others;
    if (others.length === 1 && only && ts.isPropertyAssignment(only) && ['isLoading', 'isError', 'isForbidden'].includes(nameOf(only.name) ?? '') && only.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      edit(literal.getStart(source), literal.end, `{ ${only.getText(source)} }`);
      change(literal, 'SLOT_LITERAL_FLAGS', literal.getText(source), `{ ${only.getText(source)} }`);
    } else flag(literal, 'SLOT_LITERAL', SLOT_LITERAL_REASON);
  }
  for (const literal of legacyLiterals) flag(literal, 'SLOT_LITERAL', SLOT_LITERAL_REASON);

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
  findings.sort((first, second) => first.line - second.line || first.column - second.column);
  return { text: output, changes, findings };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.tsx?$/i.test(entry.name) && !/\.d\.[cm]?ts$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply the safe rewrites in one app (its fe/ tree, else the root); every unresolved case is retained in the returned report. */
export function migrateLoadingStates({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): LoadingStatesReport {
  if (!ts) throw new Error('loading-states needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  const base = fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory() ? frontend : root;
  const report: LoadingStatesReport = { schema: 'starci/loading-states-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(base)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformLoadingStates({ ts, text: original, file });
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
export function loadingStatesMarkdown(report: LoadingStatesReport): string {
  const out = ['# loading-states', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
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

// Import and namespace consumption analysis shared by dead-export edges.
import path from 'node:path';
import type {
  CompilerOptions, EntityName, ExportDeclaration, ImportDeclaration, ImportTypeNode, NamespaceImport, Node, ObjectBindingPattern,
  ObjectLiteralExpression, SourceFile, Symbol as TsSymbol, TypeChecker,
} from 'typescript';
import type { TypeScriptApi } from './config.mjs';

/** One name an import/export takes from its target (`exported` is set for a re-export under another name). */
export interface BindingPair {
  imported: string;
  exported: string | null;
}

/** Names an import/export declaration takes from its target: everything, or the listed pairs. */
export interface Bindings {
  all: boolean;
  pairs: BindingPair[];
}

/** The part of the dead-export analysis context the binding analysis reads and caches into. */
export interface BindingsContext {
  ts: TypeScriptApi;
  checkerFor?: (fileName: string) => TypeChecker;
  namespaceCheckers: WeakMap<SourceFile, TypeChecker>;
  namespaceUses: WeakMap<NamespaceImport, Bindings>;
}

/** An expression wrapper that does not change the value it wraps. */
type TransparentExpression = Node & { expression: Node };

/** Disk/staged test consumers have no production checker; bind their local names without resolving dependencies. */
const namespaceChecker = (context: BindingsContext, sourceFile: SourceFile, namespace: NamespaceImport): TypeChecker => {
  const cached = context.namespaceCheckers.get(sourceFile);
  if (cached) return cached;
  const { ts } = context;
  let checker = context.checkerFor?.(sourceFile.fileName);
  if (!checker?.getSymbolAtLocation(namespace.name)) {
    const options: CompilerOptions = { noResolve: true, noLib: true, types: [], allowJs: true, target: ts.ScriptTarget.Latest };
    const host = ts.createCompilerHost(options);
    const filename = path.resolve(sourceFile.fileName);
    host.getSourceFile = file => path.resolve(file) === filename ? sourceFile : undefined;
    host.fileExists = file => path.resolve(file) === filename;
    host.readFile = file => path.resolve(file) === filename ? sourceFile.text : undefined;
    checker = ts.createProgram([filename], options, host).getTypeChecker();
  }
  context.namespaceCheckers.set(sourceFile, checker);
  return checker;
};

const transparentExpression = (ts: TypeScriptApi, node: Node | null | undefined): node is TransparentExpression => !!node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
  || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node));

const literalMember = (ts: TypeScriptApi, input: Node): string | null => {
  let node = input;
  while (transparentExpression(ts, node)) node = node.expression;
  return node && (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null;
};

const destructuredMember = (ts: TypeScriptApi, name: Node): string | null => {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return literalMember(ts, name.expression);
  return literalMember(ts, name);
};

/** A destructuring alias consumes the property's name, while a rest/computed binding may consume every export. */
const destructuredBindings = (ts: TypeScriptApi, pattern: ObjectBindingPattern | ObjectLiteralExpression): Bindings => {
  const names: string[] = [];
  const elements = ts.isObjectBindingPattern(pattern) ? pattern.elements : pattern.properties;
  for (const element of elements) {
    if (ts.isSpreadAssignment(element) || (ts.isBindingElement(element) && element.dotDotDotToken)) return { all: true, pairs: [] };
    const name = destructuredMember(ts, ts.isBindingElement(element) ? element.propertyName ?? element.name : element.name);
    if (name === null) return { all: true, pairs: [] };
    names.push(name);
  }
  return { all: false, pairs: names.map(imported => ({ imported, exported: null })) };
};

const namespaceReference = (ts: TypeScriptApi, checker: TypeChecker, symbol: TsSymbol | undefined, node: Node): boolean => {
  if (checker.getSymbolAtLocation(node) === symbol) return true;
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return checker.getShorthandAssignmentValueSymbol(parent) === symbol;
  return ts.isExportSpecifier(parent) && node === (parent.propertyName ?? parent.name)
    && checker.getExportSpecifierLocalTargetSymbol(parent) === symbol;
};

const unwrappedNamespace = (ts: TypeScriptApi, input: Node): Node => {
  let node = input;
  while (transparentExpression(ts, node.parent)) node = node.parent;
  return node;
};

const indexedNamespaceMember = (ts: TypeScriptApi, node: Node): string | null => {
  if (!ts.isTypeQueryNode(node.parent) || node.parent.exprName !== node) return null;
  let query: Node = node.parent;
  while (ts.isParenthesizedTypeNode(query.parent)) query = query.parent;
  const indexed = query.parent;
  return ts.isIndexedAccessTypeNode(indexed) && indexed.objectType === query && ts.isLiteralTypeNode(indexed.indexType)
    ? literalMember(ts, indexed.indexType.literal) : null;
};

/** The first member is the entry export even in a chain such as namespace.Enum.Member or namespace.Type.Inner. */
const namespaceUse = (ts: TypeScriptApi, reference: Node): Bindings => {
  const node = unwrappedNamespace(ts, reference);
  const parent = node.parent;
  let name: string | null = null;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) name = parent.name.text;
  else if (ts.isQualifiedName(parent) && parent.left === node) name = parent.right.text;
  else if (ts.isElementAccessExpression(parent) && parent.expression === node) name = literalMember(ts, parent.argumentExpression);
  else if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) return destructuredBindings(ts, parent.name);
  else if (ts.isBinaryExpression(parent) && parent.right === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isObjectLiteralExpression(parent.left)) return destructuredBindings(ts, parent.left);
  else name = indexedNamespaceMember(ts, node);
  return name === null ? { all: true, pairs: [] } : { all: false, pairs: [{ imported: name, exported: null }] };
};

const namespaceBindings = (context: BindingsContext, declaration: ImportDeclaration, namespace: NamespaceImport): Bindings => {
  const cached = context.namespaceUses.get(namespace);
  if (cached) return cached;
  const { ts } = context;
  const sourceFile = declaration.getSourceFile();
  const checker = namespaceChecker(context, sourceFile, namespace);
  const symbol = checker.getSymbolAtLocation(namespace.name);
  const result: Bindings = { all: false, pairs: [] };
  const visit = (node: Node): void => {
    if (ts.isJSDocSeeTag(node) || ts.isJSDocLink(node) || ts.isJSDocLinkCode(node) || ts.isJSDocLinkPlain(node)) return;
    if (ts.isIdentifier(node) && node !== namespace.name && namespaceReference(ts, checker, symbol, node)) {
      const used = namespaceUse(ts, node);
      result.all ||= used.all;
      result.pairs.push(...used.pairs);
    }
    if (!result.all) {
      ts.forEachChild(node, visit);
      // `jsDoc` is a compiler-internal field of the nodes that carry documentation comments.
      for (const doc of (node as Node & { jsDoc?: Node[] }).jsDoc ?? []) visit(doc);
    }
  };
  // An unavailable binding must never turn an unknown consumer into a false unused-export finding.
  if (symbol) visit(sourceFile);
  else result.all = true;
  context.namespaceUses.set(namespace, result);
  return result;
};

const importBindings = (context: BindingsContext, declaration: ImportDeclaration): Bindings => {
  const { ts } = context;
  const clause = declaration.importClause;
  if (!clause) return { all: false, pairs: [] }; // side-effect import: uses nothing
  const pairs: BindingPair[] = [];
  if (clause.name) pairs.push({ imported: 'default', exported: null });
  const named = clause.namedBindings;
  if (named && named.kind === ts.SyntaxKind.NamespaceImport) {
    const namespace = namespaceBindings(context, declaration, named);
    return { all: namespace.all, pairs: [...pairs, ...namespace.pairs] };
  }
  if (named) for (const element of named.elements) pairs.push({ imported: (element.propertyName ?? element.name).text, exported: null });
  return { all: false, pairs };
};

const exportBindings = (ts: TypeScriptApi, declaration: ExportDeclaration): Bindings => {
  const clause = declaration.exportClause;
  if (!clause || clause.kind === ts.SyntaxKind.NamespaceExport) return { all: true, pairs: [] };
  return { all: false, pairs: clause.elements.map(element => ({ imported: (element.propertyName ?? element.name).text, exported: element.name.text })) };
};

const importTypeBindings = (ts: TypeScriptApi, declaration: ImportTypeNode): Bindings => {
  let qualifier: EntityName | undefined = declaration.qualifier;
  if (!qualifier) return { all: true, pairs: [] };
  while (qualifier.kind === ts.SyntaxKind.QualifiedName) qualifier = qualifier.left;
  return { all: false, pairs: [{ imported: qualifier.text, exported: null }] };
};

/** Names an import/export declaration takes from its target: {all} or {pairs: [{imported, exported}]}. */
export function bindingsOf(context: BindingsContext, declaration: Node | null | undefined): Bindings {
  const { ts } = context;
  if (!declaration) return { all: true, pairs: [] };
  if (ts.isImportDeclaration(declaration)) return importBindings(context, declaration);
  if (ts.isExportDeclaration(declaration)) return exportBindings(ts, declaration);
  if (ts.isImportTypeNode(declaration)) return importTypeBindings(ts, declaration);
  // ImportEqualsDeclaration, dynamic import(), require(): the whole module is taken.
  return { all: true, pairs: [] };
}

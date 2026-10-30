/** Imported JSX components receive repeated data contracts; executable prop values remain compared. */
import type {
  BindingName, Expression, Identifier, ImportDeclaration, JsxTagNameExpression, Node, ObjectLiteralElementLike, SourceFile,
  SyntaxKind as Kind, VariableDeclaration,
} from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import { unwrapExpression as unwrap } from '../../lib/ts-analysis.mjs';

/** What a name is bound to in a lexical scope. `namespace` carries the module it imports, `constant` its declaration. */
type Binding =
  | { kind: 'component' | 'translation-factory'; declaration?: VariableDeclaration }
  | { kind: 'local'; declaration?: VariableDeclaration }
  | { kind: 'namespace'; module: string }
  | { kind: 'constant'; declaration: VariableDeclaration };

/** One lexical scope: its names, its parent and the function scope that `var`-like names hoist to. */
interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
  functionScope: Scope | null;
}

/** The binding an identifier resolves to, or null (undefined when its node was never visited). */
type BindingOf = (identifier: Identifier) => Binding | null | undefined;

/** Whether an expression is pure data (literals, names, member reads, translator calls). */
type Mapping = (value: Expression | undefined) => boolean;

const TRANSLATION_MODULES = new Set(['next-intl', 'next-intl/server']);
const TRANSLATION_FACTORIES = new Set(['useTranslations', 'getTranslations']);
const uppercase = (name: string): boolean => /^[A-Z]/.test(name);

function bindName(ts: TypeScriptApi, scope: Scope, name: BindingName, binding: Binding): void {
  if (ts.isIdentifier(name)) scope.bindings.set(name.text, binding);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) if (ts.isBindingElement(element)) bindName(ts, scope, element.name, binding);
  }
}

function importBindings(ts: TypeScriptApi, scope: Scope, statement: ImportDeclaration): void {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) return;
  const module = statement.moduleSpecifier.text;
  if (clause.name) scope.bindings.set(clause.name.text, { kind: 'component' });
  const named = clause.namedBindings;
  if (!named) return;
  if (ts.isNamespaceImport(named)) scope.bindings.set(named.name.text, { kind: 'namespace', module });
  else for (const element of named.elements) {
    if (element.isTypeOnly) continue;
    const imported = element.propertyName?.text ?? element.name.text;
    const kind = TRANSLATION_MODULES.has(module) && TRANSLATION_FACTORIES.has(imported) ? 'translation-factory' : 'component';
    scope.bindings.set(element.name.text, { kind });
  }
}

function lexicalBindings(ts: TypeScriptApi, sourceFile: SourceFile): BindingOf {
  const scopes = new WeakMap<Node, Scope>();
  const root: Scope = { parent: null, bindings: new Map(), functionScope: null };
  root.functionScope = root;
  const visit = (node: Node, outer: Scope): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) bindName(ts, outer, node.name, { kind: 'local' });
    const functionScope = ts.isFunctionLike(node);
    const nested = functionScope || ts.isBlock(node) || ts.isCatchClause(node) || ts.isClassExpression(node)
      || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
    const scope: Scope = nested ? { parent: outer, bindings: new Map(), functionScope: functionScope ? null : outer.functionScope } : outer;
    if (functionScope) scope.functionScope = scope;
    scopes.set(node, scope);
    if (ts.isImportDeclaration(node)) importBindings(ts, scope, node);
    if (ts.isParameter(node)) bindName(ts, scope, node.name, { kind: 'local' });
    if (ts.isFunctionExpression(node) && node.name) bindName(ts, scope, node.name, { kind: 'local' });
    if (ts.isVariableDeclaration(node)) {
      const flags = node.parent?.flags ?? ts.NodeFlags.Const;
      bindName(ts, flags & ts.NodeFlags.BlockScoped ? scope : scope.functionScope as Scope, node.name,
        { kind: flags & ts.NodeFlags.Const ? 'constant' : 'local', declaration: node });
    }
    ts.forEachChild(node, (child) => { visit(child, scope); });
  };
  visit(sourceFile, root);
  return (identifier: Identifier) => {
    for (let scope: Scope | null | undefined = scopes.get(identifier); scope; scope = scope.parent) {
      if (scope.bindings.has(identifier.text)) return scope.bindings.get(identifier.text);
    }
    return null;
  };
}

function translationFactory(ts: TypeScriptApi, node: Node, bindingOf: BindingOf): boolean {
  node = unwrap(ts, node);
  if (ts.isIdentifier(node)) return bindingOf(node)?.kind === 'translation-factory';
  if (!(ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && TRANSLATION_FACTORIES.has(node.name.text))) return false;
  const namespace = bindingOf(node.expression);
  return namespace?.kind === 'namespace' && TRANSLATION_MODULES.has(namespace.module);
}

function translator(ts: TypeScriptApi, node: Node, bindingOf: BindingOf): boolean {
  if (!ts.isIdentifier(node)) return false;
  const binding = bindingOf(node);
  if (binding?.kind !== 'constant') return false;
  let initializer = unwrap(ts, binding.declaration.initializer);
  if (initializer && ts.isAwaitExpression(initializer)) initializer = unwrap(ts, initializer.expression);
  return Boolean(initializer && ts.isCallExpression(initializer) && translationFactory(ts, initializer.expression, bindingOf));
}

function importedComponent(ts: TypeScriptApi, tag: JsxTagNameExpression, bindingOf: BindingOf): boolean {
  if (ts.isIdentifier(tag)) return uppercase(tag.text) && bindingOf(tag)?.kind === 'component';
  if (!ts.isPropertyAccessExpression(tag) || !uppercase(tag.name.text)) return false;
  let root: Expression = tag.expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  return ts.isIdentifier(root) && bindingOf(root)?.kind === 'namespace';
}

function dataProperty(ts: TypeScriptApi, property: ObjectLiteralElementLike, mapping: Mapping): boolean {
  if (ts.isSpreadAssignment(property)) return mapping(property.expression);
  if (ts.isShorthandPropertyAssignment(property)) return !property.objectAssignmentInitializer;
  if (!ts.isPropertyAssignment(property)) return false;
  return (!ts.isComputedPropertyName(property.name) || mapping(property.name.expression)) && mapping(property.initializer);
}

function dataMapping(ts: TypeScriptApi, expression: Node | undefined, bindingOf: BindingOf): boolean {
  const node: Node | undefined = unwrap(ts, expression);
  if (!node) return false;
  const mapping: Mapping = (value) => dataMapping(ts, value, bindingOf);
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(node)) return mapping(node.expression);
  if (ts.isElementAccessExpression(node)) return mapping(node.expression) && mapping(node.argumentExpression);
  if (ts.isObjectLiteralExpression(node)) return node.properties.every((property) => dataProperty(ts, property, mapping));
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => ts.isOmittedExpression(element)
    || mapping(ts.isSpreadElement(element) ? element.expression : element));
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => mapping(span.expression));
  if (ts.isPrefixUnaryExpression(node)) return ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken] as Kind[]).includes(node.operator)
    && ts.isNumericLiteral(node.operand);
  return ts.isCallExpression(node) && translator(ts, node.expression, bindingOf) && node.arguments.every(mapping);
}

/** Only object/array values belong to the prop contract; do not descend into a call or function body. */
function nestedDataObjects(ts: TypeScriptApi, expression: Node | undefined, bindingOf: BindingOf, excluded: Set<Node>): void {
  const node: Node | undefined = unwrap(ts, expression);
  if (!node) return;
  if (ts.isObjectLiteralExpression(node)) {
    if (dataMapping(ts, node, bindingOf)) { excluded.add(node); return; }
    for (const property of node.properties) if (ts.isPropertyAssignment(property)) {
      nestedDataObjects(ts, property.initializer, bindingOf, excluded);
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) if (!ts.isSpreadElement(element)) nestedDataObjects(ts, element, bindingOf, excluded);
  }
}

/** Canon data prop objects qualify through an imported component binding, never its chosen name or file path. */
export function canonJsxCloneNodes(ts: TypeScriptApi, sourceFile: SourceFile): Set<Node> {
  const bindingOf = lexicalBindings(ts, sourceFile);
  const excluded = new Set<Node>();
  const visit = (node: Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && importedComponent(ts, node.tagName, bindingOf)) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) continue;
        const value = unwrap(ts, attribute.initializer.expression);
        if (!value || !ts.isObjectLiteralExpression(value)) continue;
        if (dataMapping(ts, value, bindingOf)) excluded.add(attribute);
        else nestedDataObjects(ts, value, bindingOf, excluded);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return excluded;
}

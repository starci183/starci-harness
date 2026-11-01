/**
 * The render graph: which component draws which, and where each places the `children` and slot props it is given.
 *
 * One ESLint file sees one component. An app splits a screen across files, so a card inside a card, a table inside a card or a
 * grid in the wrong page can stand in three files. This module reads the source of the program (no type checker: the parsed files
 * of the HFS graph and its resolved import edges) and answers one question for the checks built on it: starting from a component,
 * what is drawn inside what, once every app component is replaced by what it draws and every `{children}` or `{props.slot}` by what
 * its caller handed it.
 *
 * Limits, stated because a check built here is only as honest as they are:
 *   - conditional JSX counts as drawn (both branches), a `.map` callback counts as drawn once and is marked `repeated`;
 *   - a render prop (a function passed as a prop) is not followed;
 *   - a component reached through a variable, a prop or a dynamic import is not followed;
 *   - a local render helper (`renderRow(x)`) is followed to three levels.
 */
import type {
  CallExpression, Expression, FunctionLikeDeclaration, JsxAttributeLike, JsxChild, JsxOpeningLikeElement, Node, SourceFile,
} from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { HfsGraph } from './hfs-graph.mjs';
import { unwrapExpression } from '../../lib/ts-analysis.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';

/** What a JSX tag names. */
export type Tag =
  | { readonly kind: 'grammar'; readonly name: string }
  | { readonly kind: 'component'; readonly file: string; readonly name: string }
  | { readonly kind: 'host'; readonly name: string }
  | { readonly kind: 'unknown'; readonly name: string };

/** A JSX attribute as the graph keeps it: its literal text when it has one, and the elements it carries. */
export interface RenderAttribute {
  readonly name: string;
  /** The string of a string literal or `{"..."}`, `'true'` for a bare attribute or `{true}`, `'false'` for `{false}`, otherwise null. */
  readonly text: string | null;
  readonly parts: readonly RenderPart[];
}

/** One element of a render. */
export interface RenderElement {
  readonly kind: 'element';
  readonly tag: Tag;
  readonly attributes: ReadonlyMap<string, RenderAttribute>;
  readonly children: readonly RenderPart[];
  /** True when the element is made by a `.map` callback: one of several. */
  readonly repeated: boolean;
  readonly file: string;
  readonly node: Node;
}

/** Where a component places something its caller handed it: `children`, or the named slot prop. */
export interface RenderPlacement {
  readonly kind: 'placement';
  readonly prop: string;
  readonly file: string;
  readonly node: Node;
}

/** A piece of a render. */
export type RenderPart = RenderElement | RenderPlacement;

/** An app component: where it is declared and what it draws. */
export interface ComponentDefinition {
  readonly file: string;
  readonly name: string;
  readonly returns: readonly RenderPart[];
}

/** What a caller handed a component, with the supplier of the caller's own render. */
export interface Supplier {
  readonly children: readonly RenderPart[];
  readonly slots: ReadonlyMap<string, readonly RenderPart[]>;
  readonly outer: Supplier | null;
}

/** An element on the way down: a grammar or host element that encloses what is being walked. */
export interface Ancestor {
  readonly element: RenderElement;
}

/** What a walk reports to a check. */
export interface RenderVisitor {
  /** An element, with its grammar ancestors outermost first and the component stack that led to it. */
  enter?(element: RenderElement, ancestors: readonly Ancestor[], stack: readonly string[]): void;
  /** The elements one parent draws side by side, placements and fragments resolved, in order. */
  siblings?(elements: readonly RenderElement[], ancestors: readonly Ancestor[], stack: readonly string[]): void;
  /** A grammar or host element with the elements it draws directly, placements resolved. */
  parent?(element: RenderElement, drawn: readonly RenderElement[], ancestors: readonly Ancestor[], stack: readonly string[]): void;
}

const GRAMMAR_PACKAGE = /^@starci\/grammar(?:\/|$)/u;
const MAX_DEPTH = 14;
const HELPER_DEPTH = 3;
const MAP_METHODS = new Set(['map', 'flatMap']);

/** Everything the walk needs about the files of one program. */
export class RenderGraph {
  readonly ts: TypeScriptApi;
  readonly graph: HfsGraph;
  private readonly components = new Map<string, Map<string, ComponentDefinition>>();
  private readonly imports = new Map<string, Map<string, { grammar: string } | { file: string; name: string } | { external: true }>>();
  private readonly exportsCache = new Map<string, Map<string, { file: string; name: string }>>();
  private readonly fileEdges = new Map<string, Map<string, string>>();

  constructor(ts: TypeScriptApi, graph: HfsGraph) {
    this.ts = ts;
    this.graph = graph;
    for (const edge of graph.edges) {
      let bySpecifier = this.fileEdges.get(edge.from);
      if (!bySpecifier) {
        bySpecifier = new Map();
        this.fileEdges.set(edge.from, bySpecifier);
      }
      bySpecifier.set(edge.specifier, edge.to);
    }
    for (const file of graph.files.values()) if (/\.tsx$/u.test(file.rel) && !/\.(?:spec|test|stories)\.tsx$/u.test(file.rel)) this.readComponents(file.rel, file.sourceFile);
  }

  /** Every app component of the program. */
  allComponents(): ComponentDefinition[] {
    return [...this.components.values()].flatMap(byName => [...byName.values()]);
  }

  /** The component a file declares under a name. */
  componentOf(file: string, name: string): ComponentDefinition | null {
    return this.components.get(file)?.get(name) ?? null;
  }

  /** The location of a node, 1-based. */
  locate(element: { readonly file: string; readonly node: Node }): { path: string; line: number; column: number } {
    const file = this.graph.files.get(element.file);
    return { path: element.file, ...(file ? sourceLocation(file.sourceFile, element.node) : { line: 1, column: 1 }) };
  }

  // --- reading a file -------------------------------------------------------------------------------------------------------

  private readComponents(rel: string, sourceFile: SourceFile): void {
    const { ts } = this;
    const byName = new Map<string, ComponentDefinition>();
    const functions = new Map<string, FunctionLikeDeclaration>();
    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const fn = ts.isIdentifier(declaration.name) ? this.functionOf(declaration.initializer) : null;
          if (fn && ts.isIdentifier(declaration.name)) functions.set(declaration.name.text, fn);
        }
      }
    }
    for (const [name, fn] of functions) {
      if (!/^[A-Z]/u.test(name)) continue;
      const returns = this.returnsOf(rel, fn, functions);
      if (returns.length > 0) byName.set(name, { file: rel, name, returns });
    }
    if (byName.size > 0) this.components.set(rel, byName);
  }

  /** The function a declaration initializer is or wraps (`memo(fn)`, `forwardRef(fn)`). */
  private functionOf(initializer: Expression | undefined): FunctionLikeDeclaration | null {
    const { ts } = this;
    const value = unwrapExpression(ts, initializer);
    if (!value) return null;
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    if (ts.isCallExpression(value) && value.arguments[0]) return this.functionOf(value.arguments[0]);
    return null;
  }

  private returnsOf(rel: string, fn: FunctionLikeDeclaration, siblings: ReadonlyMap<string, FunctionLikeDeclaration>): RenderPart[] {
    const { ts } = this;
    const propNames = new Set<string>();
    let propsIdentifier: string | null = null;
    const first = fn.parameters[0];
    if (first) {
      if (ts.isIdentifier(first.name)) propsIdentifier = first.name.text;
      else if (ts.isObjectBindingPattern(first.name)) {
        for (const element of first.name.elements) {
          if (ts.isIdentifier(element.name)) propNames.add(element.propertyName && ts.isIdentifier(element.propertyName) ? `${element.name.text}\u0000${element.propertyName.text}` : element.name.text);
        }
      }
    }
    // destructured local names -> prop name
    const propOfLocal = new Map<string, string>();
    for (const entry of propNames) {
      const [local, prop] = entry.split('\u0000');
      propOfLocal.set(local as string, prop ?? (local as string));
    }
    const locals = new Map<string, Expression>();
    const returned: Expression[] = [];
    const scan = (node: Node): void => {
      if (ts.isFunctionLike(node) && node !== fn) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        locals.set(node.name.text, node.initializer);
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === propsIdentifier) {
        for (const element of node.name.elements) if (ts.isIdentifier(element.name)) propOfLocal.set(element.name.text, element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text);
      }
      if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
      ts.forEachChild(node, scan);
    };
    if (fn.body && !ts.isBlock(fn.body)) returned.push(fn.body);
    else if (fn.body) ts.forEachChild(fn.body, scan);
    const reader = new PartReader(this, rel, { locals, propOfLocal, propsIdentifier, siblings });
    return returned.flatMap(expression => reader.read(expression, false, 0));
  }

  // --- names ----------------------------------------------------------------------------------------------------------------

  private importsOf(rel: string): Map<string, { grammar: string } | { file: string; name: string } | { external: true }> {
    const cached = this.imports.get(rel);
    if (cached) return cached;
    const { ts } = this;
    const bindings = new Map<string, { grammar: string } | { file: string; name: string } | { external: true }>();
    const sourceFile = this.graph.files.get(rel)?.sourceFile;
    this.imports.set(rel, bindings);
    if (!sourceFile) return bindings;
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const target = this.fileEdges.get(rel)?.get(specifier) ?? null;
      const grammar = GRAMMAR_PACKAGE.test(specifier);
      const bind = (local: string, imported: string): void => {
        if (grammar) bindings.set(local, { grammar: imported });
        else if (target) {
          const resolved = this.resolveExport(target, imported, new Set());
          bindings.set(local, resolved ?? { external: true });
        } else bindings.set(local, { external: true });
      };
      if (clause.name) bind(clause.name.text, 'default');
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, grammar ? { grammar: '*' } : { external: true });
      else if (named) for (const element of named.elements) if (!element.isTypeOnly) bind(element.name.text, element.propertyName?.text ?? element.name.text);
    }
    return bindings;
  }

  /** The file and local name that declare what `file` exports under `name`, following re-exports. */
  private resolveExport(file: string, name: string, seen: Set<string>): { file: string; name: string } | null {
    const key = `${file}\u0000${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (this.components.get(file)?.has(name)) return { file, name };
    const table = this.exportTable(file);
    const direct = table.get(name);
    if (direct) return direct.file === file && direct.name === name ? direct : this.resolveExport(direct.file, direct.name, seen);
    const star = table.get('*');
    if (star) return this.resolveExport(star.file, name, seen);
    return null;
  }

  private exportTable(file: string): Map<string, { file: string; name: string }> {
    const cached = this.exportsCache.get(file);
    if (cached) return cached;
    const table = new Map<string, { file: string; name: string }>();
    this.exportsCache.set(file, table);
    const { ts } = this;
    const sourceFile = this.graph.files.get(file)?.sourceFile;
    if (!sourceFile) return table;
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        const target = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? this.fileEdges.get(file)?.get(statement.moduleSpecifier.text) ?? null : null;
        if (!statement.exportClause) {
          if (target) table.set('*', { file: target, name: '*' });
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const local = element.propertyName?.text ?? element.name.text;
            table.set(element.name.text, { file: target ?? file, name: local });
          }
        }
      } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
        table.set('default', { file, name: statement.expression.text });
      } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        table.set('default', { file, name: statement.name.text });
      }
    }
    return table;
  }

  /** What the JSX tag `tagName` of a file names. */
  tagOf(rel: string, tagName: Node): Tag {
    const { ts } = this;
    if (ts.isIdentifier(tagName)) {
      const name = tagName.text;
      if (/^[a-z]/u.test(name)) return { kind: 'host', name };
      if (this.components.get(rel)?.has(name)) return { kind: 'component', file: rel, name };
      const bound = this.importsOf(rel).get(name);
      if (bound && 'grammar' in bound) return { kind: 'grammar', name: bound.grammar };
      if (bound && 'file' in bound) return { kind: 'component', file: bound.file, name: bound.name };
      return { kind: 'unknown', name };
    }
    if (ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression)) {
      const bound = this.importsOf(rel).get(tagName.expression.text);
      if (bound && 'grammar' in bound && bound.grammar === '*') return { kind: 'grammar', name: tagName.name.text };
      return { kind: 'unknown', name: `${tagName.expression.text}.${tagName.name.text}` };
    }
    return { kind: 'unknown', name: '?' };
  }

  // --- walking --------------------------------------------------------------------------------------------------------------

  /** Walks everything `root` draws with the empty context, reporting each element and each run of siblings to the visitor. */
  walkFrom(root: ComponentDefinition, visitor: RenderVisitor): void {
    this.walk(root.returns, [], null, [`${root.file}#${root.name}`], visitor, 0);
  }

  private walk(parts: readonly RenderPart[], ancestors: readonly Ancestor[], supplier: Supplier | null, stack: readonly string[], visitor: RenderVisitor, depth: number): void {
    if (depth > MAX_DEPTH) return;
    const flat = this.flatten(parts, supplier);
    const elements = flat.filter((entry): entry is { element: RenderElement; supplier: Supplier | null } => entry.element !== null);
    if (visitor.siblings && elements.length > 1) visitor.siblings(elements.map(entry => entry.element), ancestors, stack);
    for (const { element, supplier: supplied } of elements) {
      visitor.enter?.(element, ancestors, stack);
      const { tag } = element;
      if (tag.kind === 'component') {
        const definition = this.componentOf(tag.file, tag.name);
        const key = `${tag.file}#${tag.name}`;
        if (!definition || stack.includes(key)) continue;
        const slots = new Map<string, readonly RenderPart[]>();
        for (const attribute of element.attributes.values()) if (attribute.parts.length > 0) slots.set(attribute.name, attribute.parts);
        this.walk(definition.returns, ancestors, { children: element.children, slots, outer: supplied }, [...stack, key], visitor, depth + 1);
      } else {
        const inner = tag.kind === 'grammar' || tag.kind === 'host' ? [...ancestors, { element }] : ancestors;
        const slotParts = [...element.attributes.values()].flatMap(attribute => attribute.parts);
        if (visitor.parent) visitor.parent(element, this.flatten(element.children, supplied).flatMap(entry => (entry.element ? [entry.element] : [])), ancestors, stack);
        this.walk([...slotParts, ...element.children], inner, supplied, stack, visitor, depth + 1);
      }
    }
  }

  /** Parts with placements replaced by what the supplier handed over; each element keeps the supplier its own placements read. */
  private flatten(parts: readonly RenderPart[], supplier: Supplier | null): { element: RenderElement | null; supplier: Supplier | null }[] {
    const out: { element: RenderElement | null; supplier: Supplier | null }[] = [];
    for (const part of parts) {
      if (part.kind === 'element') {
        out.push({ element: part, supplier });
        continue;
      }
      if (!supplier) continue;
      const handed = part.prop === 'children' ? supplier.children : supplier.slots.get(part.prop) ?? [];
      out.push(...this.flatten(handed, supplier.outer));
    }
    return out;
  }

  /** The one element a component element draws at its root, or null when it draws several things or none. */
  rootOf(element: RenderElement): RenderElement | null {
    if (element.tag.kind !== 'component') return element;
    const definition = this.componentOf(element.tag.file, element.tag.name);
    const roots = definition?.returns.filter((part): part is RenderElement => part.kind === 'element') ?? [];
    const only = roots.length === 1 && definition?.returns.length === 1 ? roots[0] : undefined;
    return only ?? null;
  }
}

interface ReaderScope {
  readonly locals: ReadonlyMap<string, Expression>;
  readonly propOfLocal: ReadonlyMap<string, string>;
  readonly propsIdentifier: string | null;
  readonly siblings: ReadonlyMap<string, FunctionLikeDeclaration>;
}

/** Reads the expressions of one function into render parts. */
class PartReader {
  private readonly graph: RenderGraph;
  private readonly rel: string;
  private readonly scope: ReaderScope;
  private readonly followed = new Set<Node>();

  constructor(graph: RenderGraph, rel: string, scope: ReaderScope) {
    this.graph = graph;
    this.rel = rel;
    this.scope = scope;
  }

  read(input: Expression | JsxChild | undefined, repeated: boolean, depth: number): RenderPart[] {
    const { ts } = this.graph;
    const expression = unwrapExpression(ts, input as Expression | undefined);
    if (!expression || depth > 12) return [];
    if (ts.isJsxElement(expression)) return [this.element(expression.openingElement, expression.children, repeated, depth)];
    if (ts.isJsxSelfClosingElement(expression)) return [this.element(expression, [], repeated, depth)];
    if (ts.isJsxFragment(expression)) return this.children(expression.children, repeated, depth);
    if (ts.isJsxExpression(expression)) return expression.expression ? this.read(expression.expression, repeated, depth + 1) : [];
    if (ts.isConditionalExpression(expression)) return [...this.read(expression.whenTrue, repeated, depth + 1), ...this.read(expression.whenFalse, repeated, depth + 1)];
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return this.read(expression.right, repeated, depth + 1);
      if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken) return [...this.read(expression.left, repeated, depth + 1), ...this.read(expression.right, repeated, depth + 1)];
      return [];
    }
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.flatMap(item => this.read(item, repeated, depth + 1));
    if (ts.isIdentifier(expression)) return this.identifier(expression.text, expression, repeated, depth);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === this.scope.propsIdentifier) {
      return [{ kind: 'placement', prop: expression.name.text, file: this.rel, node: expression }];
    }
    if (ts.isCallExpression(expression)) return this.call(expression, repeated, depth);
    return [];
  }

  private identifier(name: string, node: Node, repeated: boolean, depth: number): RenderPart[] {
    const prop = this.scope.propOfLocal.get(name);
    if (prop !== undefined) return [{ kind: 'placement', prop, file: this.rel, node }];
    const local = this.scope.locals.get(name);
    if (local && !this.followed.has(local)) {
      this.followed.add(local);
      const parts = this.read(local, repeated, depth + 1);
      this.followed.delete(local);
      return parts;
    }
    return [];
  }

  private call(call: CallExpression, repeated: boolean, depth: number): RenderPart[] {
    const { ts } = this.graph;
    const callee = unwrapExpression(ts, call.expression);
    if (ts.isPropertyAccessExpression(callee) && MAP_METHODS.has(callee.name.text)) {
      const callback = call.arguments[0];
      const fn = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : null;
      if (!fn) return [];
      const returned: Expression[] = [];
      const scan = (node: Node): void => {
        if (ts.isFunctionLike(node) && node !== fn) return;
        if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
        ts.forEachChild(node, scan);
      };
      if (!ts.isBlock(fn.body)) returned.push(fn.body);
      else ts.forEachChild(fn.body, scan);
      return returned.flatMap(expression => this.read(expression, true, depth + 1));
    }
    if (ts.isIdentifier(callee) && depth < HELPER_DEPTH * 4) {
      const helper = this.scope.siblings.get(callee.text);
      if (helper && !/^[A-Z]/u.test(callee.text) && !this.followed.has(helper)) {
        this.followed.add(helper);
        const returned: Expression[] = [];
        const scan = (node: Node): void => {
          if (ts.isFunctionLike(node) && node !== helper) return;
          if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
          ts.forEachChild(node, scan);
        };
        if (helper.body && !ts.isBlock(helper.body)) returned.push(helper.body);
        else if (helper.body) ts.forEachChild(helper.body, scan);
        const parts = returned.flatMap(expression => this.read(expression, repeated, depth + 4));
        this.followed.delete(helper);
        return parts;
      }
    }
    return [];
  }

  private children(children: readonly JsxChild[], repeated: boolean, depth: number): RenderPart[] {
    return children.flatMap(child => this.read(child, repeated, depth + 1));
  }

  private element(opening: JsxOpeningLikeElement, children: readonly JsxChild[], repeated: boolean, depth: number): RenderElement {
    const { ts } = this.graph;
    const attributes = new Map<string, RenderAttribute>();
    for (const attribute of opening.attributes.properties as readonly JsxAttributeLike[]) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        attributes.set('...', { name: '...', text: null, parts: [] });
        continue;
      }
      if (!ts.isIdentifier(attribute.name)) continue;
      const name = attribute.name.text;
      const initializer = attribute.initializer;
      let text: string | null = null;
      let parts: RenderPart[] = [];
      if (!initializer) text = 'true';
      else if (ts.isStringLiteralLike(initializer)) text = initializer.text;
      else if (ts.isJsxExpression(initializer) && initializer.expression) {
        const value = unwrapExpression(ts, initializer.expression);
        if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) text = value.text;
        else if (value.kind === ts.SyntaxKind.TrueKeyword) text = 'true';
        else if (value.kind === ts.SyntaxKind.FalseKeyword) text = 'false';
        else if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) parts = this.read(value, false, depth + 1);
      }
      attributes.set(name, { name, text, parts });
    }
    return {
      kind: 'element',
      tag: this.graph.tagOf(this.rel, opening.tagName),
      attributes,
      children: this.children(children, repeated, depth),
      repeated,
      file: this.rel,
      node: opening,
    };
  }
}

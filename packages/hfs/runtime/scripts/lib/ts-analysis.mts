import type { Expression, Node, SourceFile, TypeChecker } from 'typescript';
import type { TypeScript } from './ts-ast.mjs';

/** The wrappers of an expression a contract may look through. */
export interface UnwrapOptions { awaitExpressions?: boolean; typeAssertions?: boolean; nonNullExpressions?: boolean; satisfiesExpressions?: boolean }

/** What unwrapping `N` yields: every wrapper holds an Expression, so an Expression stays one; null and undefined pass through. */
export type Unwrapped<N> = N extends Expression ? Expression : N extends Node ? Node : N;

/** The expression under the wrappers selected by an AST check's contract. */
export function unwrapExpression<N extends Node | null | undefined>(ts: TypeScript, expression: N, { awaitExpressions = false, typeAssertions = true, nonNullExpressions = true, satisfiesExpressions = true }: UnwrapOptions = {}): Unwrapped<N> {
  let current: Node | null | undefined = expression;
  while (current) {
    const wrapper = ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
      || (typeAssertions && ts.isTypeAssertionExpression(current)) || (nonNullExpressions && ts.isNonNullExpression(current))
      || (satisfiesExpressions && (ts.isSatisfiesExpression?.(current) ?? false))
      || (awaitExpressions && ts.isAwaitExpression(current));
    if (!wrapper) break;
    current = (current as Node & { readonly expression: Node }).expression;
  }
  return current as Unwrapped<N>;
}

/** Local name -> imported name and module; callers select their existing module key and literal policy. */
export function importsOf(ts: TypeScript, sourceFile: SourceFile, { moduleKey = 'module', stringLiteralsOnly = false }: { moduleKey?: string; stringLiteralsOnly?: boolean } = {}): Map<string, { name: string } & Record<string, string>> {
  const imports = new Map<string, { name: string } & Record<string, string>>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || (stringLiteralsOnly && !ts.isStringLiteralLike(statement.moduleSpecifier))) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) imports.set(binding.name.text, { name: (binding.propertyName ?? binding.name).text, [moduleKey]: (statement.moduleSpecifier as import('typescript').StringLiteral).text });
  }
  return imports;
}

/** Catalog values unwrap parentheses, `as`, and `satisfies`, preserving assertions and non-null nodes. */
export const unwrapCatalogExpression = <N extends Node | undefined>(ts: TypeScript, node: N): Node | N => unwrapExpression(ts, node, { typeAssertions: false, nonNullExpressions: false });

/** Bind this file in isolation: the compiler resolves lexical names, but imports and library files are never loaded. */
export function lexicalChecker(ts: TypeScript, source: SourceFile): TypeChecker {
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (file) => file === source.fileName ? source : undefined;
  host.fileExists = () => false;
  host.readFile = () => undefined;
  return ts.createProgram([source.fileName], options, host).getTypeChecker();
}

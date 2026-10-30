// Symbol reads shared by declared and inferred SWR lifecycle checks.
import type { ArrowFunction, Declaration, Expression, FunctionDeclaration, FunctionExpression, Node, Symbol as TypeScriptSymbol, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import { unwrapExpression } from './typescript.mjs';
import { normalizedSymbol, normalizedSymbolValue } from './ast-walks.mjs';
import { isConstVariable } from '../../lib/ts-ast.mjs';

export function functionNode(ts: TypeScriptApi, declaration: Declaration): FunctionDeclaration | ArrowFunction | FunctionExpression | null {
  if (ts.isFunctionDeclaration(declaration) && declaration.body) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const value = unwrapExpression(ts, declaration.initializer);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  }
  return null;
}

export function constInitializer(ts: TypeScriptApi, symbol: TypeScriptSymbol | null | undefined): Expression | null {
  const declarations = symbol?.getDeclarations?.() ?? [];
  const [declaration] = declarations;
  if (declarations.length !== 1 || !declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer
    || !isConstVariable(ts, declaration)) return null;
  return declaration.initializer;
}

export function inferredSymbol(ts: TypeScriptApi, checker: TypeChecker, node: Node) {
  return ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
    ? normalizedSymbolValue(ts, checker, checker.getShorthandAssignmentValueSymbol(node.parent))
    : normalizedSymbol(ts, checker, node);
}

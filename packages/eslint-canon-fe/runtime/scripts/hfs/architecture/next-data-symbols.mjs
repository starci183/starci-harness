import { unwrapExpression } from './typescript.mjs';
import { normalizedSymbol, normalizedSymbolValue } from './ast-walks.mjs';
import { isConstVariable } from '../../lib/ts-ast.mjs';
export function functionNode(ts, declaration) {
    if (ts.isFunctionDeclaration(declaration) && declaration.body)
        return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const value = unwrapExpression(ts, declaration.initializer);
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
            return value;
    }
    return null;
}
export function constInitializer(ts, symbol) {
    const declarations = symbol?.getDeclarations?.() ?? [];
    const [declaration] = declarations;
    if (declarations.length !== 1 || !declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer
        || !isConstVariable(ts, declaration))
        return null;
    return declaration.initializer;
}
export function inferredSymbol(ts, checker, node) {
    return ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
        ? normalizedSymbolValue(ts, checker, checker.getShorthandAssignmentValueSymbol(node.parent))
        : normalizedSymbol(ts, checker, node);
}

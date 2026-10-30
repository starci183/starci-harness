/** The expression under the wrappers selected by an AST check's contract. */
export function unwrapExpression(ts, expression, { awaitExpressions = false, typeAssertions = true, nonNullExpressions = true, satisfiesExpressions = true } = {}) {
    let current = expression;
    while (current) {
        const wrapper = ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
            || (typeAssertions && ts.isTypeAssertionExpression(current)) || (nonNullExpressions && ts.isNonNullExpression(current))
            || (satisfiesExpressions && (ts.isSatisfiesExpression?.(current) ?? false))
            || (awaitExpressions && ts.isAwaitExpression(current));
        if (!wrapper)
            break;
        current = current.expression;
    }
    return current;
}
/** Local name -> imported name and module; callers select their existing module key and literal policy. */
export function importsOf(ts, sourceFile, { moduleKey = 'module', stringLiteralsOnly = false } = {}) {
    const imports = new Map();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || (stringLiteralsOnly && !ts.isStringLiteralLike(statement.moduleSpecifier)))
            continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings))
            continue;
        for (const binding of bindings.elements)
            imports.set(binding.name.text, { name: (binding.propertyName ?? binding.name).text, [moduleKey]: statement.moduleSpecifier.text });
    }
    return imports;
}
/** Catalog values unwrap parentheses, `as`, and `satisfies`, preserving assertions and non-null nodes. */
export const unwrapCatalogExpression = (ts, node) => unwrapExpression(ts, node, { typeAssertions: false, nonNullExpressions: false });
/** Bind this file in isolation: the compiler resolves lexical names, but imports and library files are never loaded. */
export function lexicalChecker(ts, source) {
    const options = { noLib: true, noResolve: true, allowJs: true };
    const host = ts.createCompilerHost(options);
    host.getSourceFile = (file) => file === source.fileName ? source : undefined;
    host.fileExists = () => false;
    host.readFile = () => undefined;
    return ts.createProgram([source.fileName], options, host).getTypeChecker();
}

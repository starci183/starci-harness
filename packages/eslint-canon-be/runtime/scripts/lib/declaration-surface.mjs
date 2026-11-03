/** A script file (`.js`, `.mjs`, `.cjs`, `.jsx`): it has no declaration emit and stands for its content. */
export const SCRIPT = /\.(?:[cm]?jsx?)$/;
/** A declaration file: it is its own surface. */
export const DECLARATION = /\.d\.[cm]?ts$/;
/** A TypeScript source file whose surface the declaration emit writes. */
export const TYPESCRIPT = /\.(?:[cm]?tsx?)$/;
/** Whether `file` is a TypeScript source (not a declaration file) the declaration emit reads. */
export const isEmittableSource = (file) => TYPESCRIPT.test(file) && !DECLARATION.test(file);
/** Whether `expression` is a JSX element, fragment, `null` or `undefined`, or a conditional of those: its type does not depend on any other file. */
function isJsxValue(ts, expression) {
    if (expression === undefined)
        return false;
    let node = expression;
    while (ts.isParenthesizedExpression(node))
        node = node.expression;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || node.kind === ts.SyntaxKind.NullKeyword)
        return true;
    if (ts.isIdentifier(node))
        return node.text === 'undefined';
    return ts.isConditionalExpression(node) && isJsxValue(ts, node.whenTrue) && isJsxValue(ts, node.whenFalse);
}
/**
 * Whether the function (or method) the declaration diagnostic at `start` points at has the type `JSX.Element | null | undefined` whatever its body
 * reads: not async, not a generator, and every `return` of its own (and its concise body) a JSX value. A React component written without a return
 * type is the common case; its inferred type is one the JSX namespace of the installed packages gives, which a lockfile change dirties as a whole.
 */
function returnsOnlyJsx(ts, source, start) {
    let found;
    const find = (node) => {
        if (found !== undefined || start < node.getFullStart() || start >= node.end)
            return;
        const named = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined && node.name.getStart(source) === start;
        if (named || ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.getStart(source) === start)) {
            found = node;
            return;
        }
        ts.forEachChild(node, find);
    };
    find(source);
    const fn = found;
    if (fn === undefined || fn.type !== undefined || fn.body === undefined)
        return false;
    if (fn.asteriskToken !== undefined || (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0)
        return false;
    if (!ts.isBlock(fn.body))
        return isJsxValue(ts, fn.body);
    let only = true;
    const visit = (node) => {
        if (!only || ts.isFunctionLike(node) || ts.isClassLike(node))
            return;
        if (ts.isReturnStatement(node) && node.expression !== undefined && !isJsxValue(ts, node.expression))
            only = false;
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
    return only;
}
/** The package whose module-definition helpers return a type they state in their own declaration (R368 accepts a destructured export of their call). */
export const STATED_SURFACE_PACKAGE = '@starci/nest-kit';
/** The helpers of that package: each is called with the options type as a type argument and returns the explicitly typed definition. */
export const STATED_SURFACE_HELPERS = new Set(['defineConfigurableModule', 'defineCapabilityModule']);
/** The local names under which `source` imports a stated-surface helper from its package (`import { defineConfigurableModule as define }` gives `define`). */
function statedHelperNames(ts, source) {
    const names = new Set();
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== STATED_SURFACE_PACKAGE)
            continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings))
            continue;
        for (const element of bindings.elements)
            if (STATED_SURFACE_HELPERS.has((element.propertyName ?? element.name).text))
                names.add(element.name.text);
    }
    return names;
}
/**
 * Whether the destructured export the diagnostic at `start` points at is `export const { A, B } = helper<Options>()` for a stated-surface helper:
 * each name has the type the helper's declaration gives it, written there, so the file states its surface by naming the helper and the options
 * type, exactly as `export const A: Host["A"] = built.A` states it through `Host`.
 */
function statesSurfaceThroughHelper(ts, source, start) {
    const helpers = statedHelperNames(ts, source);
    if (helpers.size === 0)
        return null;
    let innermost = source;
    const descend = (node) => {
        if (start < node.getFullStart() || start >= node.end)
            return;
        innermost = node;
        ts.forEachChild(node, descend);
    };
    ts.forEachChild(source, descend);
    for (let node = innermost; node !== undefined && node !== source; node = node.parent) {
        if (!ts.isVariableDeclaration(node))
            continue;
        const call = node.initializer;
        const stated = ts.isObjectBindingPattern(node.name) && call !== undefined && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && helpers.has(call.expression.text)
            && (call.typeArguments?.length ?? 0) > 0 && node.name.elements.every((element) => ts.isIdentifier(element.name) && element.dotDotDotToken === undefined);
        return stated && call !== undefined ? call.getText(source) : null;
    }
    return null;
}
/** What to annotate for each isolated-declaration diagnostic code; any other code asks for the exported value's type. */
const ANNOTATE = new Map([
    [9007, 'return type'], [9008, 'return type'], [9009, 'accessor type'], [9010, 'variable type'], [9011, 'parameter type'], [9012, 'property type'],
    [9019, 'destructured export'], [9025, 'parameter type'],
]);
/** The declaration kinds whose name labels the export a diagnostic sits in, innermost first. */
function nameOf(ts, source, start) {
    let innermost = source;
    const descend = (node) => {
        if (start < node.getFullStart() || start >= node.end)
            return;
        innermost = node;
        ts.forEachChild(node, descend);
    };
    ts.forEachChild(source, descend);
    for (let node = innermost; node !== undefined && node !== source; node = node.parent) {
        if (ts.isExportAssignment(node))
            return 'default export';
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name))
            return node.name.text;
        if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) || ts.isGetAccessorDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name))
            return node.name.text;
        if (ts.isFunctionDeclaration(node) && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0)
            return 'default export';
    }
    return 'default export';
}
/**
 * The declaration emit of one TypeScript source and the exports it could not write explicitly (a type inferred from bodies and other files), or null
 * when the compiler has no `transpileDeclaration` (before TypeScript 5.5). A declaration whose only diagnostics are components returning JSX has the
 * surface its emit shows. `module` is the side's `module` compiler option, which the emit reads. A throw from the compiler propagates: the caller
 * decides what an unreadable file means.
 */
export function declarationSurface(ts, file, text, module) {
    const emit = ts.transpileDeclaration;
    if (emit === undefined)
        return null;
    const declared = emit.call(ts, text, { compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, ...(module === undefined ? {} : { module }) }, fileName: file, reportDiagnostics: true });
    const diagnostics = (declared.diagnostics ?? []);
    if (diagnostics.length === 0)
        return { outputText: declared.outputText, problems: [] };
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const problems = [];
    // The emit writes `any` for a destructured export; the call that states its type joins the digest, so a change of the options type reaches the importers.
    const stated = new Set();
    for (const diagnostic of diagnostics) {
        const call = diagnostic.code === 9019 && diagnostic.start !== undefined ? statesSurfaceThroughHelper(ts, source, diagnostic.start) : null;
        if (call !== null) {
            stated.add(call);
            continue;
        }
        const exempt = (diagnostic.code === 9007 || diagnostic.code === 9008) && diagnostic.start !== undefined && returnsOnlyJsx(ts, source, diagnostic.start);
        if (exempt)
            continue;
        const start = diagnostic.start ?? 0;
        problems.push({
            code: diagnostic.code, start, length: diagnostic.length ?? 0, name: nameOf(ts, source, start), annotate: ANNOTATE.get(diagnostic.code) ?? 'exported value',
            reason: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0] ?? '',
        });
    }
    const outputText = stated.size === 0 ? declared.outputText : `${declared.outputText}${[...stated].sort().map((call) => `// stated by ${call}\n`).join('')}`;
    return { outputText, problems };
}

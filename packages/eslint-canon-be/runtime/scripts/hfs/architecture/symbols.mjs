import { canonical } from './config.mjs';
import { hasAnyFlag } from '../../lib/ts-ast.mjs';
import { entryOf } from './dead-exports.mjs';
export const SYMBOL_RULE_IDS = ['HFS_DUPLICATE_SYMBOL', 'HFS_ALIAS_REEXPORT'];
const lineOf = (sourceFile, node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
/** The modifiers a statement carries (none for a statement that cannot have any). */
const modifiersOf = (ts, statement) => (ts.canHaveModifiers(statement) ? statement.modifiers : undefined) ?? [];
/** The names a source file declares at top level and exports: Map<name, line>. Re-exports from another module declare nothing. */
function addBindingNames(ts, sourceFile, name, into, node) {
    if (ts.isIdentifier(name)) {
        into.set(name.text, lineOf(sourceFile, node));
        return;
    }
    for (const element of name.elements) {
        if (ts.isBindingElement(element))
            addBindingNames(ts, sourceFile, element.name, into, node);
    }
}
function recordStatementDeclarations(ts, sourceFile, statement, declared, exported) {
    const kind = ts.SyntaxKind;
    const modifiers = modifiersOf(ts, statement);
    const publish = modifiers.some(modifier => modifier.kind === kind.ExportKeyword) && !modifiers.some(modifier => modifier.kind === kind.DefaultKeyword);
    const into = publish ? exported : declared;
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
            addBindingNames(ts, sourceFile, declaration.name, into, declaration);
        return;
    }
    const declares = [kind.FunctionDeclaration, kind.ClassDeclaration, kind.EnumDeclaration, kind.TypeAliasDeclaration, kind.InterfaceDeclaration];
    const name = statement.name;
    if (name && ts.isIdentifier(name) && declares.includes(statement.kind)) {
        into.set(name.text, lineOf(sourceFile, statement));
    }
}
function exposeLocalExports(localLists, declared, exported) {
    for (const element of localLists) {
        const local = (element.propertyName ?? element.name).text;
        if (declared.has(local))
            exported.set(element.name.text, declared.get(local));
    }
}
function declaredExports(ts, sourceFile) {
    const declared = new Map();
    const exported = new Map();
    const localLists = [];
    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
            if (!statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause))
                localLists.push(...statement.exportClause.elements);
            continue;
        }
        recordStatementDeclarations(ts, sourceFile, statement, declared, exported);
    }
    // `export { local }` of a name declared in this file makes that declaration exported.
    exposeLocalExports(localLists, declared, exported);
    return exported;
}
/** The declaration an export of an entry resolves to: its repository-relative file and its own name, or null. */
function declaringFile(ts, checker, graph, symbol) {
    const resolved = hasAnyFlag(symbol.flags, ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    for (const declaration of resolved?.declarations ?? []) {
        const rel = graph.abs(canonical(declaration.getSourceFile().fileName));
        if (rel)
            return { rel, name: resolved.getName() };
    }
    return null;
}
function declarationIndex(ts, graph) {
    const declarations = new Map(); // name -> Map<rel, line>
    for (const [rel, node] of graph.files) {
        for (const [name, line] of declaredExports(ts, node.sourceFile)) {
            if (name === 'default')
                continue;
            let byFile = declarations.get(name);
            if (!byFile) {
                byFile = new Map();
                declarations.set(name, byFile);
            }
            byFile.set(rel, line);
        }
    }
    return declarations;
}
function duplicateViolation(scan, symbol, owner, entry) {
    const { ts, checker, graph, declarations, seen } = scan;
    const declaration = declaringFile(ts, checker, graph, symbol);
    if (!declaration || declaration.name === 'default')
        return null;
    const { rel: home, name } = declaration;
    const others = [...(declarations.get(name) ?? [])].filter(([rel]) => rel !== home);
    if (!others.length || seen.has(`${home}\0${name}`))
        return null;
    seen.add(`${home}\0${name}`);
    const where = others.map(([rel, at]) => `${rel}:${at}`);
    return {
        ruleId: 'HFS_DUPLICATE_SYMBOL',
        path: home, line: declarations.get(name)?.get(home) ?? 1, column: 1, name, owner: owner.root, entry,
        otherDeclarations: where,
        message: `${name} is exported through the public entry ${entry} (declared in ${home}) and also declared and exported in ${where.join(', ')}; one name, one declaration: rename or delete the copy.`,
    };
}
function inspectPublicOwner(ts, context, graph, config, declarations, seen, [key, owner]) {
    if (owner.tier === 'app')
        return { violations: [], surface: 0 };
    const entry = entryOf(graph, config, key, owner);
    if (!entry)
        return { violations: [], surface: 0 };
    const entryFile = graph.files.get(entry);
    const checker = context.checkerFor(entryFile.abs);
    const moduleSymbol = checker?.getSymbolAtLocation(entryFile.sourceFile);
    if (!moduleSymbol)
        return { violations: [], surface: 0 };
    const violations = [];
    const scan = { ts, checker, graph, declarations, seen };
    let surface = 0;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        surface += 1;
        const violation = duplicateViolation(scan, symbol, owner, entry);
        if (violation)
            violations.push(violation);
    }
    return { violations, surface };
}
function duplicateSymbols({ context, graph, config }) {
    const declarations = declarationIndex(context.ts, graph);
    const violations = [];
    const seen = new Set();
    let surface = 0;
    for (const item of graph.ownerRoots) {
        const result = inspectPublicOwner(context.ts, context, graph, config, declarations, seen, item);
        violations.push(...result.violations);
        surface += result.surface;
    }
    return { violations, surface };
}
const isExported = (ts, statement) => modifiersOf(ts, statement).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && !modifiersOf(ts, statement).some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
const bareAliasExpression = (ts, expression) => ts.isIdentifier(expression)
    || (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name) && (ts.isIdentifier(expression.expression) || ts.isPropertyAccessExpression(expression.expression)));
/** The declaration `node` (an identifier, a member or a qualified name) resolves to when a repository file declares it as one of `kinds`, else null. */
function repositoryDeclaration(ts, checker, graph, node, kinds) {
    let target = node;
    if (ts.isPropertyAccessExpression(node))
        target = node.name;
    else if (ts.isQualifiedName(node))
        target = node.right;
    const symbol = checker?.getSymbolAtLocation(target);
    if (!symbol)
        return null;
    const resolved = hasAnyFlag(symbol.flags, ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    const home = (resolved?.declarations ?? []).some(declaration => kinds.includes(declaration.kind) && graph.abs(canonical(declaration.getSourceFile().fileName)));
    return home ? resolved.getName() : null;
}
/**
 * The exported declarations of one top-level statement that only rename another declaration of the repository:
 * `export const Y = X` and `export const Y = X.y` (X or y a function, class, const or enum), `export type Y = X` and
 * `export interface Y extends X {}` with no body, no type arguments and no type parameters.
 */
function variableAliases(ts, checker, graph, statement, kind) {
    const found = [];
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !bareAliasExpression(ts, declaration.initializer))
            continue;
        const of = repositoryDeclaration(ts, checker, graph, declaration.initializer, [kind.FunctionDeclaration, kind.ClassDeclaration, kind.VariableDeclaration, kind.EnumDeclaration]);
        if (of && of !== declaration.name.text)
            found.push({ node: declaration, name: declaration.name.text, of, form: `export const ${declaration.name.text} = ${declaration.initializer.getText()}` });
    }
    return found;
}
function typeAliasOf(ts, checker, graph, statement, kind) {
    if (statement.typeParameters?.length || !ts.isTypeReferenceNode(statement.type) || statement.type.typeArguments?.length)
        return [];
    const of = repositoryDeclaration(ts, checker, graph, statement.type.typeName, [kind.InterfaceDeclaration, kind.TypeAliasDeclaration, kind.ClassDeclaration, kind.EnumDeclaration]);
    return of && of !== statement.name.text
        ? [{ node: statement, name: statement.name.text, of, form: `export type ${statement.name.text} = ${statement.type.getText()}` }]
        : [];
}
function interfaceAliasOf(ts, checker, graph, statement, kind) {
    if (statement.members.length || statement.typeParameters?.length)
        return [];
    const heritage = (statement.heritageClauses ?? []).flatMap((clause) => clause.types);
    const only = heritage[0];
    if (heritage.length !== 1 || !only || only.typeArguments?.length || !bareAliasExpression(ts, only.expression))
        return [];
    const of = repositoryDeclaration(ts, checker, graph, only.expression, [kind.InterfaceDeclaration, kind.TypeAliasDeclaration, kind.ClassDeclaration]);
    return of && of !== statement.name.text
        ? [{ node: statement, name: statement.name.text, of, form: `export interface ${statement.name.text} extends ${only.expression.getText()} {}` }]
        : [];
}
function declarationAliases(ts, checker, graph, statement) {
    const kind = ts.SyntaxKind;
    if (!checker || !isExported(ts, statement))
        return [];
    if (ts.isVariableStatement(statement))
        return variableAliases(ts, checker, graph, statement, kind);
    if (ts.isTypeAliasDeclaration(statement))
        return typeAliasOf(ts, checker, graph, statement, kind);
    if (ts.isInterfaceDeclaration(statement))
        return interfaceAliasOf(ts, checker, graph, statement, kind);
    return [];
}
/** The names Next.js reads from a route segment file (layout, page, route, ...): the framework fixes them. */
const NEXT_SEGMENT_EXPORTS = new Set([
    'generateMetadata', 'metadata', 'generateViewport', 'viewport', 'generateStaticParams', 'generateImageMetadata', 'generateSitemaps',
    'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration',
]);
const ROUTE_SLOT = 'fe.route';
function isFrameworkName(node, name) {
    return node.slot === ROUTE_SLOT && NEXT_SEGMENT_EXPORTS.has(name);
}
function addDeclarationAliasViolations(env, rel, node, statement, point, violations) {
    const { ts, checker, graph } = env;
    for (const alias of declarationAliases(ts, checker, graph, statement)) {
        if (isFrameworkName(node, alias.name))
            continue;
        const at = point(alias.node);
        violations.push({
            ruleId: 'HFS_ALIAS_REEXPORT', path: rel, line: at.line + 1, column: at.character + 1, name: alias.name, aliasOf: alias.of,
            message: `${alias.form} in ${rel} gives the declaration ${alias.of} a second name: use ${alias.of} where ${alias.name} is used and delete ${alias.name}.`,
        });
    }
}
function addNamespaceAliasViolation(rel, statement, clause, point, violations) {
    const at = point(statement);
    violations.push({
        ruleId: 'HFS_ALIAS_REEXPORT', path: rel, line: at.line + 1, column: at.character + 1, name: clause.name.text,
        message: `export * as ${clause.name.text} in ${rel} publishes a whole module under a second name: export the declarations it holds by their own names.`,
    });
}
function addNamedAliasViolations(rel, node, clause, point, violations) {
    for (const element of clause.elements) {
        if (!element.propertyName || element.propertyName.text === element.name.text || isFrameworkName(node, element.name.text))
            continue;
        const at = point(element);
        violations.push({
            ruleId: 'HFS_ALIAS_REEXPORT', path: rel, line: at.line + 1, column: at.character + 1,
            name: element.name.text, aliasOf: element.propertyName.text,
            message: `export { ${element.propertyName.text} as ${element.name.text} } in ${rel} gives one declaration a second name: rename the declaration to ${element.name.text}, or import and export it as ${element.propertyName.text}.`,
        });
    }
}
function addExportAliasViolations(ts, rel, node, statement, point, violations) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause)
        return;
    const clause = statement.exportClause;
    if (ts.isNamespaceExport(clause)) {
        addNamespaceAliasViolation(rel, statement, clause, point, violations);
        return;
    }
    addNamedAliasViolations(rel, node, clause, point, violations);
}
function addStatementAliasViolations(context, graph, rel, node, statement, checker, violations) {
    const point = (target) => node.sourceFile.getLineAndCharacterOfPosition(target.getStart(node.sourceFile));
    addDeclarationAliasViolations({ ts: context.ts, checker, graph }, rel, node, statement, point, violations);
    addExportAliasViolations(context.ts, rel, node, statement, point, violations);
}
function aliasReexports({ context, graph }) {
    const violations = [];
    for (const [rel, node] of graph.files) {
        const checker = context.checkerFor(node.abs);
        for (const statement of node.sourceFile.statements)
            addStatementAliasViolations(context, graph, rel, node, statement, checker, violations);
    }
    return { violations };
}
export function checkSymbols(input) {
    const duplicates = duplicateSymbols(input);
    const aliases = aliasReexports(input);
    return {
        violations: [...duplicates.violations, ...aliases.violations],
        coverage: { status: 'checked', publicNames: duplicates.surface, duplicates: duplicates.violations.length, aliases: aliases.violations.length },
    };
}

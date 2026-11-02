import { unwrapExpression as unwrap } from '../../lib/ts-analysis.mjs';
const TRANSLATION_MODULES = new Set(['next-intl', 'next-intl/server']);
const TRANSLATION_FACTORIES = new Set(['useTranslations', 'getTranslations']);
const uppercase = (name) => /^[A-Z]/.test(name);
function bindName(ts, scope, name, binding) {
    if (ts.isIdentifier(name))
        scope.bindings.set(name.text, binding);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const element of name.elements)
            if (ts.isBindingElement(element))
                bindName(ts, scope, element.name, binding);
    }
}
function importBindings(ts, scope, statement) {
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier))
        return;
    const module = statement.moduleSpecifier.text;
    if (clause.name)
        scope.bindings.set(clause.name.text, { kind: 'component', module, name: 'default' });
    const named = clause.namedBindings;
    if (!named)
        return;
    if (ts.isNamespaceImport(named))
        scope.bindings.set(named.name.text, { kind: 'namespace', module });
    else
        for (const element of named.elements) {
            if (element.isTypeOnly)
                continue;
            const imported = element.propertyName?.text ?? element.name.text;
            const binding = TRANSLATION_MODULES.has(module) && TRANSLATION_FACTORIES.has(imported)
                ? { kind: 'translation-factory' } : { kind: 'component', module, name: imported };
            scope.bindings.set(element.name.text, binding);
        }
}
function lexicalBindings(ts, sourceFile) {
    const scopes = new WeakMap();
    const root = { parent: null, bindings: new Map(), functionScope: null };
    root.functionScope = root;
    const visit = (node, outer) => {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
            bindName(ts, outer, node.name, { kind: 'local' });
        const functionScope = ts.isFunctionLike(node);
        const nested = functionScope || ts.isBlock(node) || ts.isCatchClause(node) || ts.isClassExpression(node)
            || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
        const scope = nested ? { parent: outer, bindings: new Map(), functionScope: functionScope ? null : outer.functionScope } : outer;
        if (functionScope)
            scope.functionScope = scope;
        scopes.set(node, scope);
        if (ts.isImportDeclaration(node))
            importBindings(ts, scope, node);
        if (ts.isParameter(node))
            bindName(ts, scope, node.name, { kind: 'local' });
        if (ts.isFunctionExpression(node) && node.name)
            bindName(ts, scope, node.name, { kind: 'local' });
        if (ts.isVariableDeclaration(node)) {
            const flags = node.parent?.flags ?? ts.NodeFlags.Const;
            bindName(ts, flags & ts.NodeFlags.BlockScoped ? scope : scope.functionScope, node.name, { kind: flags & ts.NodeFlags.Const ? 'constant' : 'local', declaration: node });
        }
        ts.forEachChild(node, (child) => { visit(child, scope); });
    };
    visit(sourceFile, root);
    return (identifier) => {
        for (let scope = scopes.get(identifier); scope; scope = scope.parent) {
            if (scope.bindings.has(identifier.text))
                return scope.bindings.get(identifier.text);
        }
        return null;
    };
}
function translationFactory(ts, node, bindingOf) {
    node = unwrap(ts, node);
    if (ts.isIdentifier(node))
        return bindingOf(node)?.kind === 'translation-factory';
    if (!(ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && TRANSLATION_FACTORIES.has(node.name.text)))
        return false;
    const namespace = bindingOf(node.expression);
    return namespace?.kind === 'namespace' && TRANSLATION_MODULES.has(namespace.module);
}
function translator(ts, node, bindingOf) {
    if (!ts.isIdentifier(node))
        return false;
    const binding = bindingOf(node);
    if (binding?.kind !== 'constant')
        return false;
    let initializer = unwrap(ts, binding.declaration.initializer);
    if (initializer && ts.isAwaitExpression(initializer))
        initializer = unwrap(ts, initializer.expression);
    return Boolean(initializer && ts.isCallExpression(initializer) && translationFactory(ts, initializer.expression, bindingOf));
}
function importedComponent(ts, tag, bindingOf) {
    if (ts.isIdentifier(tag))
        return uppercase(tag.text) && bindingOf(tag)?.kind === 'component';
    if (!ts.isPropertyAccessExpression(tag) || !uppercase(tag.name.text))
        return false;
    let root = tag.expression;
    while (ts.isPropertyAccessExpression(root))
        root = root.expression;
    return ts.isIdentifier(root) && bindingOf(root)?.kind === 'namespace';
}
function dataProperty(ts, property, mapping) {
    if (ts.isSpreadAssignment(property))
        return mapping(property.expression);
    if (ts.isShorthandPropertyAssignment(property))
        return !property.objectAssignmentInitializer;
    if (!ts.isPropertyAssignment(property))
        return false;
    return (!ts.isComputedPropertyName(property.name) || mapping(property.name.expression)) && mapping(property.initializer);
}
function dataMapping(ts, expression, bindingOf) {
    const node = unwrap(ts, expression);
    if (!node)
        return false;
    const mapping = (value) => dataMapping(ts, value, bindingOf);
    if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword
        || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.ThisKeyword)
        return true;
    if (ts.isPropertyAccessExpression(node))
        return mapping(node.expression);
    if (ts.isElementAccessExpression(node))
        return mapping(node.expression) && mapping(node.argumentExpression);
    if (ts.isObjectLiteralExpression(node))
        return node.properties.every((property) => dataProperty(ts, property, mapping));
    if (ts.isArrayLiteralExpression(node))
        return node.elements.every((element) => ts.isOmittedExpression(element)
            || mapping(ts.isSpreadElement(element) ? element.expression : element));
    if (ts.isTemplateExpression(node))
        return node.templateSpans.every((span) => mapping(span.expression));
    if (ts.isPrefixUnaryExpression(node))
        return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)
            && ts.isNumericLiteral(node.operand);
    return ts.isCallExpression(node) && translator(ts, node.expression, bindingOf) && node.arguments.every(mapping);
}
/** Only object/array values belong to the prop contract; do not descend into a call or function body. */
function nestedDataObjects(ts, expression, bindingOf, excluded) {
    const node = unwrap(ts, expression);
    if (!node)
        return;
    if (ts.isObjectLiteralExpression(node)) {
        if (dataMapping(ts, node, bindingOf)) {
            excluded.add(node);
            return;
        }
        for (const property of node.properties)
            if (ts.isPropertyAssignment(property)) {
                nestedDataObjects(ts, property.initializer, bindingOf, excluded);
            }
    }
    else if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements)
            if (!ts.isSpreadElement(element))
                nestedDataObjects(ts, element, bindingOf, excluded);
    }
}
/** Resolve the canonical status owner through its import binding, including aliases and namespaces. */
function statusOwner(ts, tag, bindingOf) {
    const binding = ts.isIdentifier(tag) ? bindingOf(tag) : ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) ? bindingOf(tag.expression) : null;
    const module = binding?.kind === 'component' || binding?.kind === 'namespace' ? binding.module : null;
    const name = binding?.kind === 'component' ? binding.name : ts.isPropertyAccessExpression(tag) ? tag.name.text : null;
    return name === 'SlotView' && module !== null && /(?:^|\/)components\/composites\/SlotView(?:\/index)?(?:\.[cm]?tsx?)?$/.test(module);
}
/** The mandated status wiring breaks clone windows; its render body remains ordinary compared code. */
function statusRecipe(ts, opening, bindingOf, excluded) {
    if (!statusOwner(ts, opening.tagName, bindingOf))
        return;
    const attributes = opening.attributes.properties;
    const render = attributes.find(attribute => ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'render');
    const value = render && ts.isJsxAttribute(render) && render.initializer && ts.isJsxExpression(render.initializer) ? unwrap(ts, render.initializer.expression) : undefined;
    if (!value || !ts.isArrowFunction(value) || value.parameters.length !== 2 || ts.isBlock(value.body))
        return;
    const waiting = value.parameters[1];
    if (!waiting || !ts.isIdentifier(waiting.name) || waiting.initializer || waiting.dotDotDotToken)
        return;
    const waitingBinding = bindingOf(waiting.name);
    let forwardsLoading = false;
    const visit = (node) => {
        if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'isLoading'
            && node.initializer && ts.isJsxExpression(node.initializer)) {
            const flag = unwrap(ts, node.initializer.expression);
            if (flag && ts.isIdentifier(flag) && waitingBinding && bindingOf(flag) === waitingBinding)
                forwardsLoading = true;
        }
        ts.forEachChild(node, visit);
    };
    visit(value.body);
    if (!forwardsLoading)
        return;
    const wiring = attributes.filter(attribute => ts.isJsxSpreadAttribute(attribute) ? dataMapping(ts, attribute.expression, bindingOf)
        : ts.isIdentifier(attribute.name) && ['slot', 'placeholder', 'labels', 'onRetry'].includes(attribute.name.text)
            && !!attribute.initializer && ts.isJsxExpression(attribute.initializer) && dataMapping(ts, attribute.initializer.expression, bindingOf));
    const hasSlot = wiring.some(attribute => ts.isJsxSpreadAttribute(attribute) || ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'slot');
    if (!hasSlot)
        return;
    for (const attribute of wiring)
        excluded.add(attribute);
}
/** Canon data prop objects qualify through an imported component binding, never its chosen name or file path. */
export function canonJsxCloneNodes(ts, sourceFile) {
    const bindingOf = lexicalBindings(ts, sourceFile);
    const excluded = new Set();
    const visit = (node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && importedComponent(ts, node.tagName, bindingOf)) {
            statusRecipe(ts, node, bindingOf, excluded);
            for (const attribute of node.attributes.properties) {
                if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer))
                    continue;
                const value = unwrap(ts, attribute.initializer.expression);
                if (!value || !ts.isObjectLiteralExpression(value))
                    continue;
                if (dataMapping(ts, value, bindingOf))
                    excluded.add(attribute);
                else
                    nestedDataObjects(ts, value, bindingOf, excluded);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return excluded;
}

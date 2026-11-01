import { unwrapExpression } from '../../lib/ts-analysis.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
const GRAMMAR_PACKAGE = /^@starci\/grammar(?:\/|$)/u;
const MAX_DEPTH = 14;
const HELPER_DEPTH = 3;
const MAP_METHODS = new Set(['map', 'flatMap']);
/** Everything the walk needs about the files of one program. */
export class RenderGraph {
    ts;
    graph;
    components = new Map();
    imports = new Map();
    exportsCache = new Map();
    fileEdges = new Map();
    constructor(ts, graph) {
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
        for (const file of graph.files.values())
            if (/\.tsx$/u.test(file.rel) && !/\.(?:spec|test|stories)\.tsx$/u.test(file.rel))
                this.readComponents(file.rel, file.sourceFile);
    }
    /** Every app component of the program. */
    allComponents() {
        return [...this.components.values()].flatMap(byName => [...byName.values()]);
    }
    /** The component a file declares under a name. */
    componentOf(file, name) {
        return this.components.get(file)?.get(name) ?? null;
    }
    /** The location of a node, 1-based. */
    locate(element) {
        const file = this.graph.files.get(element.file);
        return { path: element.file, ...(file ? sourceLocation(file.sourceFile, element.node) : { line: 1, column: 1 }) };
    }
    // --- reading a file -------------------------------------------------------------------------------------------------------
    readComponents(rel, sourceFile) {
        const { ts } = this;
        const byName = new Map();
        const functions = new Map();
        for (const statement of sourceFile.statements) {
            if (ts.isFunctionDeclaration(statement) && statement.name)
                functions.set(statement.name.text, statement);
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    const fn = ts.isIdentifier(declaration.name) ? this.functionOf(declaration.initializer) : null;
                    if (fn && ts.isIdentifier(declaration.name))
                        functions.set(declaration.name.text, fn);
                }
            }
        }
        for (const [name, fn] of functions) {
            if (!/^[A-Z]/u.test(name))
                continue;
            const returns = this.returnsOf(rel, fn, functions);
            if (returns.length > 0)
                byName.set(name, { file: rel, name, returns });
        }
        if (byName.size > 0)
            this.components.set(rel, byName);
    }
    /** The function a declaration initializer is or wraps (`memo(fn)`, `forwardRef(fn)`). */
    functionOf(initializer) {
        const { ts } = this;
        const value = unwrapExpression(ts, initializer);
        if (!value)
            return null;
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
            return value;
        if (ts.isCallExpression(value) && value.arguments[0])
            return this.functionOf(value.arguments[0]);
        return null;
    }
    returnsOf(rel, fn, siblings) {
        const { ts } = this;
        const propNames = new Set();
        let propsIdentifier = null;
        const first = fn.parameters[0];
        if (first) {
            if (ts.isIdentifier(first.name))
                propsIdentifier = first.name.text;
            else if (ts.isObjectBindingPattern(first.name)) {
                for (const element of first.name.elements) {
                    if (ts.isIdentifier(element.name))
                        propNames.add(element.propertyName && ts.isIdentifier(element.propertyName) ? `${element.name.text}\u0000${element.propertyName.text}` : element.name.text);
                }
            }
        }
        // destructured local names -> prop name
        const propOfLocal = new Map();
        for (const entry of propNames) {
            const [local, prop] = entry.split('\u0000');
            propOfLocal.set(local, prop ?? local);
        }
        const locals = new Map();
        const returned = [];
        const scan = (node) => {
            if (ts.isFunctionLike(node) && node !== fn)
                return;
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
                locals.set(node.name.text, node.initializer);
            }
            if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === propsIdentifier) {
                for (const element of node.name.elements)
                    if (ts.isIdentifier(element.name))
                        propOfLocal.set(element.name.text, element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text);
            }
            if (ts.isReturnStatement(node) && node.expression)
                returned.push(node.expression);
            ts.forEachChild(node, scan);
        };
        if (fn.body && !ts.isBlock(fn.body))
            returned.push(fn.body);
        else if (fn.body)
            ts.forEachChild(fn.body, scan);
        const reader = new PartReader(this, rel, { locals, propOfLocal, propsIdentifier, siblings });
        return returned.flatMap(expression => reader.read(expression, false, 0));
    }
    // --- names ----------------------------------------------------------------------------------------------------------------
    importsOf(rel) {
        const cached = this.imports.get(rel);
        if (cached)
            return cached;
        const { ts } = this;
        const bindings = new Map();
        const sourceFile = this.graph.files.get(rel)?.sourceFile;
        this.imports.set(rel, bindings);
        if (!sourceFile)
            return bindings;
        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
                continue;
            const specifier = statement.moduleSpecifier.text;
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly)
                continue;
            const target = this.fileEdges.get(rel)?.get(specifier) ?? null;
            const grammar = GRAMMAR_PACKAGE.test(specifier);
            const bind = (local, imported) => {
                if (grammar)
                    bindings.set(local, { grammar: imported });
                else if (target) {
                    const resolved = this.resolveExport(target, imported, new Set());
                    bindings.set(local, resolved ?? { external: true });
                }
                else
                    bindings.set(local, { external: true });
            };
            if (clause.name)
                bind(clause.name.text, 'default');
            const named = clause.namedBindings;
            if (named && ts.isNamespaceImport(named))
                bindings.set(named.name.text, grammar ? { grammar: '*' } : { external: true });
            else if (named)
                for (const element of named.elements)
                    if (!element.isTypeOnly)
                        bind(element.name.text, element.propertyName?.text ?? element.name.text);
        }
        return bindings;
    }
    /** The file and local name that declare what `file` exports under `name`, following re-exports. */
    resolveExport(file, name, seen) {
        const key = `${file}\u0000${name}`;
        if (seen.has(key))
            return null;
        seen.add(key);
        if (this.components.get(file)?.has(name))
            return { file, name };
        const table = this.exportTable(file);
        const direct = table.get(name);
        if (direct)
            return direct.file === file && direct.name === name ? direct : this.resolveExport(direct.file, direct.name, seen);
        const star = table.get('*');
        if (star)
            return this.resolveExport(star.file, name, seen);
        return null;
    }
    exportTable(file) {
        const cached = this.exportsCache.get(file);
        if (cached)
            return cached;
        const table = new Map();
        this.exportsCache.set(file, table);
        const { ts } = this;
        const sourceFile = this.graph.files.get(file)?.sourceFile;
        if (!sourceFile)
            return table;
        for (const statement of sourceFile.statements) {
            if (ts.isExportDeclaration(statement)) {
                const target = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? this.fileEdges.get(file)?.get(statement.moduleSpecifier.text) ?? null : null;
                if (!statement.exportClause) {
                    if (target)
                        table.set('*', { file: target, name: '*' });
                }
                else if (ts.isNamedExports(statement.exportClause)) {
                    for (const element of statement.exportClause.elements) {
                        const local = element.propertyName?.text ?? element.name.text;
                        table.set(element.name.text, { file: target ?? file, name: local });
                    }
                }
            }
            else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
                table.set('default', { file, name: statement.expression.text });
            }
            else if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
                table.set('default', { file, name: statement.name.text });
            }
        }
        return table;
    }
    /** What the JSX tag `tagName` of a file names. */
    tagOf(rel, tagName) {
        const { ts } = this;
        if (ts.isIdentifier(tagName)) {
            const name = tagName.text;
            if (/^[a-z]/u.test(name))
                return { kind: 'host', name };
            if (this.components.get(rel)?.has(name))
                return { kind: 'component', file: rel, name };
            const bound = this.importsOf(rel).get(name);
            if (bound && 'grammar' in bound)
                return { kind: 'grammar', name: bound.grammar };
            if (bound && 'file' in bound)
                return { kind: 'component', file: bound.file, name: bound.name };
            return { kind: 'unknown', name };
        }
        if (ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression)) {
            const bound = this.importsOf(rel).get(tagName.expression.text);
            if (bound && 'grammar' in bound && bound.grammar === '*')
                return { kind: 'grammar', name: tagName.name.text };
            return { kind: 'unknown', name: `${tagName.expression.text}.${tagName.name.text}` };
        }
        return { kind: 'unknown', name: '?' };
    }
    // --- walking --------------------------------------------------------------------------------------------------------------
    /** Walks everything `root` draws with the empty context, reporting each element and each run of siblings to the visitor. */
    walkFrom(root, visitor) {
        this.walk(root.returns, [], null, [`${root.file}#${root.name}`], visitor, 0);
    }
    walk(parts, ancestors, supplier, stack, visitor, depth) {
        if (depth > MAX_DEPTH)
            return;
        const flat = this.flatten(parts, supplier);
        const elements = flat.filter((entry) => entry.element !== null);
        if (visitor.siblings && elements.length > 1)
            visitor.siblings(elements.map(entry => entry.element), ancestors, stack);
        for (const { element, supplier: supplied } of elements) {
            visitor.enter?.(element, ancestors, stack);
            const { tag } = element;
            if (tag.kind === 'component') {
                const definition = this.componentOf(tag.file, tag.name);
                const key = `${tag.file}#${tag.name}`;
                if (!definition || stack.includes(key))
                    continue;
                const slots = new Map();
                for (const attribute of element.attributes.values())
                    if (attribute.parts.length > 0)
                        slots.set(attribute.name, attribute.parts);
                this.walk(definition.returns, ancestors, { children: element.children, slots, outer: supplied }, [...stack, key], visitor, depth + 1);
            }
            else {
                const inner = tag.kind === 'grammar' || tag.kind === 'host' ? [...ancestors, { element }] : ancestors;
                const slotParts = [...element.attributes.values()].flatMap(attribute => attribute.parts);
                if (visitor.parent)
                    visitor.parent(element, this.flatten(element.children, supplied).flatMap(entry => (entry.element ? [entry.element] : [])), ancestors, stack);
                this.walk([...slotParts, ...element.children], inner, supplied, stack, visitor, depth + 1);
            }
        }
    }
    /** Parts with placements replaced by what the supplier handed over; each element keeps the supplier its own placements read. */
    flatten(parts, supplier) {
        const out = [];
        for (const part of parts) {
            if (part.kind === 'element') {
                out.push({ element: part, supplier });
                continue;
            }
            if (!supplier)
                continue;
            const handed = part.prop === 'children' ? supplier.children : supplier.slots.get(part.prop) ?? [];
            out.push(...this.flatten(handed, supplier.outer));
        }
        return out;
    }
    /** The one element a component element draws at its root, or null when it draws several things or none. */
    rootOf(element) {
        if (element.tag.kind !== 'component')
            return element;
        const definition = this.componentOf(element.tag.file, element.tag.name);
        const roots = definition?.returns.filter((part) => part.kind === 'element') ?? [];
        const only = roots.length === 1 && definition?.returns.length === 1 ? roots[0] : undefined;
        return only ?? null;
    }
}
/** Reads the expressions of one function into render parts. */
class PartReader {
    graph;
    rel;
    scope;
    followed = new Set();
    constructor(graph, rel, scope) {
        this.graph = graph;
        this.rel = rel;
        this.scope = scope;
    }
    read(input, repeated, depth) {
        const { ts } = this.graph;
        const expression = unwrapExpression(ts, input);
        if (!expression || depth > 12)
            return [];
        if (ts.isJsxElement(expression))
            return [this.element(expression.openingElement, expression.children, repeated, depth)];
        if (ts.isJsxSelfClosingElement(expression))
            return [this.element(expression, [], repeated, depth)];
        if (ts.isJsxFragment(expression))
            return this.children(expression.children, repeated, depth);
        if (ts.isJsxExpression(expression))
            return expression.expression ? this.read(expression.expression, repeated, depth + 1) : [];
        if (ts.isConditionalExpression(expression))
            return [...this.read(expression.whenTrue, repeated, depth + 1), ...this.read(expression.whenFalse, repeated, depth + 1)];
        if (ts.isBinaryExpression(expression)) {
            const kind = expression.operatorToken.kind;
            if (kind === ts.SyntaxKind.AmpersandAmpersandToken)
                return this.read(expression.right, repeated, depth + 1);
            if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken)
                return [...this.read(expression.left, repeated, depth + 1), ...this.read(expression.right, repeated, depth + 1)];
            return [];
        }
        if (ts.isArrayLiteralExpression(expression))
            return expression.elements.flatMap(item => this.read(item, repeated, depth + 1));
        if (ts.isIdentifier(expression))
            return this.identifier(expression.text, expression, repeated, depth);
        if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === this.scope.propsIdentifier) {
            return [{ kind: 'placement', prop: expression.name.text, file: this.rel, node: expression }];
        }
        if (ts.isCallExpression(expression))
            return this.call(expression, repeated, depth);
        return [];
    }
    identifier(name, node, repeated, depth) {
        const prop = this.scope.propOfLocal.get(name);
        if (prop !== undefined)
            return [{ kind: 'placement', prop, file: this.rel, node }];
        const local = this.scope.locals.get(name);
        if (local && !this.followed.has(local)) {
            this.followed.add(local);
            const parts = this.read(local, repeated, depth + 1);
            this.followed.delete(local);
            return parts;
        }
        return [];
    }
    call(call, repeated, depth) {
        const { ts } = this.graph;
        const callee = unwrapExpression(ts, call.expression);
        if (ts.isPropertyAccessExpression(callee) && MAP_METHODS.has(callee.name.text)) {
            const callback = call.arguments[0];
            const fn = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : null;
            if (!fn)
                return [];
            const returned = [];
            const scan = (node) => {
                if (ts.isFunctionLike(node) && node !== fn)
                    return;
                if (ts.isReturnStatement(node) && node.expression)
                    returned.push(node.expression);
                ts.forEachChild(node, scan);
            };
            if (!ts.isBlock(fn.body))
                returned.push(fn.body);
            else
                ts.forEachChild(fn.body, scan);
            return returned.flatMap(expression => this.read(expression, true, depth + 1));
        }
        if (ts.isIdentifier(callee) && depth < HELPER_DEPTH * 4) {
            const helper = this.scope.siblings.get(callee.text);
            if (helper && !/^[A-Z]/u.test(callee.text) && !this.followed.has(helper)) {
                this.followed.add(helper);
                const returned = [];
                const scan = (node) => {
                    if (ts.isFunctionLike(node) && node !== helper)
                        return;
                    if (ts.isReturnStatement(node) && node.expression)
                        returned.push(node.expression);
                    ts.forEachChild(node, scan);
                };
                if (helper.body && !ts.isBlock(helper.body))
                    returned.push(helper.body);
                else if (helper.body)
                    ts.forEachChild(helper.body, scan);
                const parts = returned.flatMap(expression => this.read(expression, repeated, depth + 4));
                this.followed.delete(helper);
                return parts;
            }
        }
        return [];
    }
    children(children, repeated, depth) {
        return children.flatMap(child => this.read(child, repeated, depth + 1));
    }
    element(opening, children, repeated, depth) {
        const { ts } = this.graph;
        const attributes = new Map();
        for (const attribute of opening.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attribute)) {
                attributes.set('...', { name: '...', text: null, parts: [] });
                continue;
            }
            if (!ts.isIdentifier(attribute.name))
                continue;
            const name = attribute.name.text;
            const initializer = attribute.initializer;
            let text = null;
            let parts = [];
            if (!initializer)
                text = 'true';
            else if (ts.isStringLiteralLike(initializer))
                text = initializer.text;
            else if (ts.isJsxExpression(initializer) && initializer.expression) {
                const value = unwrapExpression(ts, initializer.expression);
                if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value))
                    text = value.text;
                else if (value.kind === ts.SyntaxKind.TrueKeyword)
                    text = 'true';
                else if (value.kind === ts.SyntaxKind.FalseKeyword)
                    text = 'false';
                else if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value))
                    parts = this.read(value, false, depth + 1);
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

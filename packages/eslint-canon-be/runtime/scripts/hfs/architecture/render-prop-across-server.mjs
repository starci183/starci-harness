import { RenderGraph } from './render-graph.mjs';
/**
 * R361 `render-prop-across-server` (FE_RENDER_PROP_ACROSS_SERVER): a function cannot cross from a server file into a client
 * component. React serialises props across that line, and a function is not serialisable, so `<Client render={() => ...} />`
 * from a server file fails at run time (or, with `'use server'`, becomes an action nobody meant). The check reads the render
 * graph: a JSX element in a file with no `'use client'` directive whose tag is an app component declared in a file that has
 * one, and one of whose props is an arrow or function expression (an inline `'use server'` function is an action and is let
 * through). What a block takes as data it renders itself; a callback belongs on the client branch that owns the interaction.
 */
export const RENDER_PROP_ACROSS_SERVER_RULE_IDS = ['FE_RENDER_PROP_ACROSS_SERVER'];
const RULE = 'FE_RENDER_PROP_ACROSS_SERVER';
/** Whether a file or a function body opens with the directive prologue string `directive`. */
const hasDirective = (ts, container, directive) => {
    for (const statement of container.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
            return false;
        if (statement.expression.text === directive)
            return true;
    }
    return false;
};
export function checkRenderPropAcrossServer(input) {
    const { ts } = input.context;
    const graph = new RenderGraph(ts, input.graph);
    const violations = [];
    let serverFiles = 0;
    for (const file of input.graph.files.values()) {
        if (!/\.tsx$/u.test(file.rel) || /\.(?:spec|test|stories)\.tsx$/u.test(file.rel) || hasDirective(ts, file.sourceFile, 'use client'))
            continue;
        serverFiles += 1;
        const visit = (node) => {
            if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
                const tag = graph.tagOf(file.rel, node.tagName);
                const target = tag.kind === 'component' ? input.graph.files.get(tag.file) : undefined;
                if (tag.kind === 'component' && target && tag.file !== file.rel && hasDirective(ts, target.sourceFile, 'use client')) {
                    for (const attribute of node.attributes.properties) {
                        if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression)
                            continue;
                        const value = attribute.initializer.expression;
                        if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value))
                            continue;
                        const body = value.body;
                        if (ts.isBlock(body) && hasDirective(ts, body, 'use server'))
                            continue;
                        const where = graph.locate({ file: file.rel, node: attribute });
                        violations.push({
                            ruleId: RULE, ...where, component: tag.name,
                            message: `${file.rel} passes a function as \`${ts.isIdentifier(attribute.name) ? attribute.name.text : 'a prop'}\` to ${tag.name}, a client component (${tag.file}), from a server file: a function does not cross the server-client line. Pass data and let ${tag.name} render it, or move the callback into a client branch that owns the interaction.`,
                        });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(file.sourceFile);
    }
    return { violations, coverage: { status: 'checked', serverFiles } };
}

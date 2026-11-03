import { declarationSurface, isEmittableSource } from '../lib/declaration-surface.mjs';
/** What to write, by what the classifier says to annotate. */
const HINTS = {
    'return type': 'Write the return type after the parameter list: `(): Result =>` or `function name(): Result`.',
    'variable type': 'Give the variable a type: `export const name: Result = ...`.',
    'parameter type': 'Give the parameter a type: `(value: Input)`.',
    'property type': 'Give the property a type: `name: Result = ...`.',
    'accessor type': 'Give the accessor a type: `get name(): Result` (a setter takes it from its parameter).',
    'destructured export': 'A destructuring pattern cannot carry a type per name: export each name as its own variable with a type, `export const name: Type = source.name`; a module definition is `export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<XOptions>()` (or `defineConfigurableModule`) of @starci/nest-kit, which states the types (`starci app codemod module-definition` writes it).',
    'exported value': 'Declare the type (an interface or a type alias) and annotate the export with it: `export const name: Shape = ...`.',
};
/** The `--isolatedDeclarations` flag name TypeScript ends its reasons with says nothing to the reader. */
const plain = (reason) => reason.replace(/ with --isolatedDeclarations\.?/, '').replace(/\.$/, '');
/**
 * The rule. `ts` is the canon's own TypeScript (its peer dependency); the side's `module` option comes from the typed program when the file is linted with one.
 *
 * @param input - `ts` is the compiler.
 * @returns An ESLint rule reporting each export of a TypeScript source whose type is inferred.
 */
export const explicitSurfaceRule = ({ ts }) => ({
    meta: {
        type: 'problem',
        docs: { description: 'An exported declaration states its type: the return type, variable type or parameter type is written, not inferred from a body or from other files.' },
        schema: [],
        messages: {
            inferred: 'HFS_EXPLICIT_EXPORT_SURFACE: `{{name}}` is exported with an inferred type ({{reason}}), so importers cannot read it from this file and every one of them is linted again whenever the file changes. Annotate the {{annotate}}. {{hint}}',
        },
    },
    create(context) {
        return {
            Program() {
                const file = context.filename;
                if (!isEmittableSource(file))
                    return;
                const { sourceCode } = context;
                const module = sourceCode.parserServices?.program?.getCompilerOptions().module;
                const whole = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
                let surface;
                try {
                    surface = declarationSurface(ts, file, sourceCode.text, module);
                }
                catch {
                    surface = null;
                }
                if (surface === null) {
                    context.report({ loc: whole, messageId: 'inferred', data: { name: 'this file', reason: 'the declaration emit could not read it', annotate: 'exported value', hint: HINTS['exported value'] } });
                    return;
                }
                for (const problem of surface.problems) {
                    context.report({
                        loc: { start: sourceCode.getLocFromIndex(problem.start), end: sourceCode.getLocFromIndex(problem.start + problem.length) },
                        messageId: 'inferred',
                        data: { name: problem.name, reason: plain(problem.reason), annotate: problem.annotate, hint: HINTS[problem.annotate] },
                    });
                }
            },
        };
    },
});

// explicit-surface-rule.mjs — the factory of the `explicit-export-surface` lint rule, built by both lint canons (HFS R368, HFS_EXPLICIT_EXPORT_SURFACE).
//
// An exported declaration whose type the isolated declaration emit cannot write without inference is a surface its importers cannot read from the
// file's signature: the type moves with the body and the files the body reads, so the lint result cache must lint every importer again whenever the
// file changes. The rule reports each such export where it is written and says what to annotate. It judges nothing itself: the classifier is
// `declarationSurface` of lib/declaration-surface.mjs, the one the cache reads, so the rule reports exactly what the cache counts as open.
import type { TypeScript } from '../lib/ts-ast.mjs';
import { declarationSurface, isEmittableSource } from '../lib/declaration-surface.mjs';

/** The part of an ESLint rule context the rule reads (typescript-eslint's context satisfies it). */
export interface SurfaceContext {
  readonly filename: string;
  readonly sourceCode: {
    readonly text: string;
    getLocFromIndex(index: number): { line: number; column: number };
    readonly parserServices?: { readonly program?: { getCompilerOptions(): { module?: number } } | null } | undefined;
  };
  report(descriptor: { loc: { start: { line: number; column: number }; end: { line: number; column: number } }; messageId: string; data: Record<string, string> }): void;
}

/** The rule module the factory returns: a plain ESLint rule with one message. */
export interface SurfaceRule {
  meta: { type: 'problem'; docs: { description: string }; schema: []; messages: { inferred: string } };
  create(context: SurfaceContext): { Program(): void };
}

/** What to write, by what the classifier says to annotate. */
const HINTS: Readonly<Record<string, string>> = {
  'return type': 'Write the return type after the parameter list: `(): Result =>` or `function name(): Result`.',
  'variable type': 'Give the variable a type: `export const name: Result = ...`.',
  'parameter type': 'Give the parameter a type: `(value: Input)`.',
  'property type': 'Give the property a type: `name: Result = ...`.',
  'accessor type': 'Give the accessor a type: `get name(): Result` (a setter takes it from its parameter).',
  'destructured export': 'A destructuring pattern cannot carry a type per name: export each name as its own variable with a type, `export const name: Type = source.name`.',
  'exported value': 'Declare the type (an interface or a type alias) and annotate the export with it: `export const name: Shape = ...`.',
};

/** The `--isolatedDeclarations` flag name TypeScript ends its reasons with says nothing to the reader. */
const plain = (reason: string): string => reason.replace(/ with --isolatedDeclarations\.?/, '').replace(/\.$/, '');

/**
 * The rule. `ts` is the canon's own TypeScript (its peer dependency); the side's `module` option comes from the typed program when the file is linted with one.
 *
 * @param input - `ts` is the compiler.
 * @returns An ESLint rule reporting each export of a TypeScript source whose type is inferred.
 */
export const explicitSurfaceRule = ({ ts }: { ts: TypeScript }): SurfaceRule => ({
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
        if (!isEmittableSource(file)) return;
        const { sourceCode } = context;
        const module = sourceCode.parserServices?.program?.getCompilerOptions().module;
        const whole = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
        let surface: ReturnType<typeof declarationSurface>;
        try { surface = declarationSurface(ts, file, sourceCode.text, module); } catch { surface = null; }
        if (surface === null) {
          context.report({ loc: whole, messageId: 'inferred', data: { name: 'this file', reason: 'the declaration emit could not read it', annotate: 'exported value', hint: HINTS['exported value'] as string } });
          return;
        }
        for (const problem of surface.problems) {
          context.report({
            loc: { start: sourceCode.getLocFromIndex(problem.start), end: sourceCode.getLocFromIndex(problem.start + problem.length) },
            messageId: 'inferred',
            data: { name: problem.name, reason: plain(problem.reason), annotate: problem.annotate, hint: HINTS[problem.annotate] as string },
          });
        }
      },
    };
  },
});

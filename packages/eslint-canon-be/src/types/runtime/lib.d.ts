/**
 * The pure helpers of the bundled runtime's `scripts/lib/` and `engine/` (untyped JavaScript) this package imports, typed by the
 * contract each one documents.
 */
declare module "*/runtime/scripts/lib/line-count.mjs" {
    /** The line count of a text; a trailing newline does not open a line. */
    export function lineCount(text: string): number
    /** The line count above which a file may not grow: the soft budget when `hardGrowth` holds, else no limit. */
    export function hardGrowthLines(fileLines: { readonly soft: number; readonly hardGrowth: boolean }): number
}

declare module "*/runtime/scripts/lib/language.mjs" {
    /** Whether `text` holds a Vietnamese letter, in NFC or NFD spelling. */
    export function hasSecondLanguage(text: unknown): boolean
}

declare module "*/runtime/scripts/lib/jsdoc.mjs" {
    import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
    /** The final adjacent JSDoc of a declaration, when it describes it. */
    export function jsdocBefore(sourceCode: Readonly<TSESLint.SourceCode>, node: TSESTree.Node): TSESTree.Comment | null
    /** The description text of a JSDoc block before its tags, or "". */
    export function jsdocDescription(comment: TSESTree.Comment | undefined | null): string
}

declare module "*/runtime/scripts/lib/sonar-syntax-rules.mjs" {
    import type { TSESLint } from "@typescript-eslint/utils"
    /** The flat-config globs of the files the Sonar scan leaves out (unit and end-to-end specs). */
    export const OUTSIDE_THE_SCAN_FILES: readonly string[]
    /** The syntax rules both canons publish, by published name. */
    export const SONAR_SYNTAX_RULES: Readonly<Record<string, TSESLint.RuleModule<string, unknown[]>>>
}

declare module "*/runtime/scripts/lib/sonar-way.mjs" {
    import type { TSESLint } from "@typescript-eslint/utils"
    /** A Sonar way rule SonarSource implements on an ESLint rule outside eslint-plugin-sonarjs. */
    export interface SonarWayRow {
        readonly sonar: string
        readonly rule: string
        readonly options?: readonly unknown[]
    }
    /** The Sonar way rules outside eslint-plugin-sonarjs. */
    export const SONAR_WAY_EXTRA: readonly SonarWayRow[]
    /** Sonar way rules with no ESLint form for a side's module format, by side then Sonar key. */
    export const SONAR_WAY_NOT_APPLICABLE: Readonly<Record<"be" | "fe", Readonly<Record<string, string>>>>
    /** The sonarjs rules whose Sonar scope is Tests. */
    export const SONAR_WAY_TEST_RULES: readonly string[]
    /** The levels of the test-scoped Sonar way rules, for the specs of the product source. */
    export function sonarWayTestRules(sonarjs: object): Record<string, TSESLint.SharedConfig.RuleEntry>
    /** The Sonar way rule levels for a side, and every `{ sonar, rule }` row they map. */
    export function sonarWayRules(
        sonarjs: object,
        side?: "be" | "fe",
    ): { rules: Record<string, TSESLint.SharedConfig.RuleEntry>; mapped: readonly SonarWayRow[] }
}

declare module "*/runtime/scripts/lib/list.mjs" {
    /** The order `.sort()` gives without a compare function (UTF-16 code units). */
    export function byCodeUnit(a: string, b: string): number
}

declare module "*/runtime/engine/yaml.mjs" {
    /** Parse one YAML 1.2 document (core schema, unique keys). */
    export function parseYaml(source: string): unknown
}

declare module "*/runtime/scripts/hfs/explicit-surface-rule.mjs" {
    import type { TSESLint } from "@typescript-eslint/utils"
    import type ts from "typescript"
    /** The rule reporting each export of a TypeScript source whose type the isolated declaration emit cannot write explicitly. */
    export function explicitSurfaceRule(input: { readonly ts: typeof ts }): TSESLint.RuleModule<"inferred", unknown[]>
}

declare module "*/runtime/scripts/lib/declaration-surface.mjs" {
    import type ts from "typescript"
    /** One export (or part of one) the declaration emit cannot write without inference. */
    export interface SurfaceProblem {
        readonly code: number
        readonly start: number
        readonly length: number
        readonly name: string
        readonly annotate: string
        readonly reason: string
    }
    /** The declaration emit of one file and the exports it could not write explicitly. */
    export interface DeclarationSurface {
        readonly outputText: string
        readonly problems: SurfaceProblem[]
    }
    /** The declaration emit of a TypeScript source and its problems, or null when the compiler has no `transpileDeclaration`. */
    export function declarationSurface(compiler: typeof ts, file: string, text: string, module?: number): DeclarationSurface | null
}

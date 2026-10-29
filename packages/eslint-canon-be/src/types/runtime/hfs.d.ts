/**
 * The bundled runtime's HFS machine modules (`scripts/hfs/**`, `scripts/api/git/**`, untyped JavaScript) this package imports, typed
 * by the contract each documents and by what this package reads of them.
 */
declare module "*/runtime/scripts/hfs/architecture/surface.mjs" {
    /** One lint enforcer of the architecture machine: the rule id, the plugins that publish it and the finding codes it reports. */
    export interface LintEnforcer {
        readonly id: string
        readonly plugins: readonly string[]
        readonly codes: readonly string[]
        readonly description: string
        readonly origin?: string
        readonly via?: string
    }
    /** Every lint enforcer of the machine. */
    export const LINT_ENFORCERS: readonly LintEnforcer[]
}

declare module "*/runtime/scripts/hfs/project-rule.mjs" {
    import type { TSESLint } from "@typescript-eslint/utils"
    /** A rule reporting the project-graph findings of one enforcer's codes on the linted file (`enforcer` is a LINT_ENFORCERS row). */
    export function projectRule(input: {
        enforcer: { readonly id: string; readonly codes: readonly string[]; readonly description: string }
        runtimeRoot: string
        hfsOf: (context: Readonly<TSESLint.RuleContext<string, unknown[]>>) => object
    }): TSESLint.RuleModule<string, unknown[]>
}

declare module "*/runtime/scripts/hfs/slots.mjs" {
    /** One enforcer row of a catalogued rule. */
    export interface CatalogEnforcer {
        readonly kind: string
        readonly id: string
        readonly editions?: readonly string[]
        readonly planned?: boolean
    }
    /** One catalogued rule (`knowledge/hfs/rules.yaml`). */
    export interface CatalogRule {
        readonly id: string
        readonly code: string
        readonly editions?: readonly string[]
        readonly enforcers: readonly CatalogEnforcer[]
    }
    /** The loaded rule catalog. */
    export interface RuleCatalog {
        readonly rules: readonly CatalogRule[]
        /** Whether the enforcer `kind:id` runs under `edition`. */
        enforcerJudgedIn(kind: string, id: string, edition?: string): boolean
    }
    /** Load the rule catalog under a runtime root. */
    export function loadRuleCatalog(input?: { root?: string }): RuleCatalog
    /** The opened slot manifest and resolver of an app or side folder. */
    export interface OpenedHfs {
        readonly manifest: object
        readonly repo: object
    }
    /** Open the manifest under `root` with the resolver of `repoRoot` (or of a parsed declaration). */
    export function openHfs(input?: { root?: string; repoRoot?: string; declaration?: object; side?: string | null }): OpenedHfs
}

declare module "*/runtime/scripts/hfs/edition-slots.mjs" {
    /** One catalogued rule, by the fields the edition judgement reads. */
    export interface EditionRule {
        readonly editions?: readonly string[]
        readonly enforcers: readonly { readonly kind: string; readonly id: string; readonly editions?: readonly string[] }[]
    }
    /** Whether the enforcer `kind:id` of the catalog `rules` runs under `edition`. */
    export function enforcerJudgedInEdition(rules: readonly EditionRule[], kind: string, id: string, edition?: string): boolean
}

declare module "*/runtime/scripts/hfs/architecture/jwt-ast.mjs" {
    import type ts from "typescript"
    /** The R260 (BE_JWT_ALG_PINNED) problems of a `jwtVerify` call, each a message. */
    export function jwtPolicyProblems(tsModule: typeof ts, checker: ts.TypeChecker, call: ts.CallExpression): string[]
}

declare module "*/runtime/scripts/hfs/architecture/function-spec-providers.mjs" {
    import type ts from "typescript"
    /** The callable exports of a function subject, or null when the class-provider check applies. */
    export function functionSubjectExports(tsModule: typeof ts, sourceFile: ts.SourceFile): string[] | null
    /** The value-object classes a module exports, or null when it exports a class that is not one (or none). */
    export function valueObjectSubjects(tsModule: typeof ts, sourceFile: ts.SourceFile): string[] | null
}

declare module "*/runtime/scripts/api/git/recorded-lines.mjs" {
    /** The line count at the branch's merge base, null for a confirmed new file, or `unavailable` for unreadable history. */
    export function recordedLines(filename: string, options?: { source?: string } | string): number | null | "unavailable"
}

declare module "*/runtime/scripts/api/git/lib.mjs" {
    import type { SpawnSyncReturns } from "node:child_process"
    /** `git args` in `cwd`, or `git -C dir args`; `config` prefixes one `-c key=value` per entry. */
    export function runGit(
        args: readonly string[],
        options?: { cwd?: string | null; dir?: string | null; git?: string; config?: Readonly<Record<string, string>> | null },
    ): SpawnSyncReturns<string>
}

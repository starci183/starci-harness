/** The declared contract of ./tester.mjs: the typed RuleTester both canons build, and the fixture HFS view. */
import type { TSESLint } from "@typescript-eslint/utils"
import type { RuleTester } from "eslint"
import type { HfsView } from "../../src/lib/hfs-view.ts"
import type { SideDeclaration } from "../app.mjs"

/** A rule as a canon publishes it. */
export type CanonRule = TSESLint.RuleModule<string, unknown[]>

/** The valid and invalid cases of one `run`. */
export interface CanonTests {
    readonly valid: readonly (string | RuleTester.ValidTestCase)[]
    readonly invalid: readonly RuleTester.InvalidTestCase[]
}

/** ESLint's RuleTester, as the canon specs drive it. */
export interface CanonRuleTester {
    run(name: string, rule: CanonRule, tests: CanonTests): void
}

/** The fixture repository root. */
export declare const TYPED_ROOT: string

/** The default be side of the fixture app (hfs.json sides.be). */
export declare const BE_DECLARATION: SideDeclaration

/** The HFS view of the fixture be side. */
export declare const fixtureHfs: (declaration?: SideDeclaration) => HfsView

/** The absolute filename of a fixture-relative path. */
export declare const at: (rel: string) => string

/** The one typed RuleTester both canons build. */
export declare const ruleTester: (input: {
    root: string
    hfs: object
    jsx?: boolean
    extensions?: readonly string[]
    maxDepth?: number
    maxProjects?: number
}) => CanonRuleTester

/** A RuleTester with typed linting and the fixture HFS settings. */
export declare const typedTester: (input?: { declaration?: SideDeclaration }) => CanonRuleTester

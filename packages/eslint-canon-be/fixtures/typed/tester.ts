/**
 * The typed rule tester: RuleTester over @typescript-eslint/parser with the project service on this directory's
 * tsconfig.json, and `settings.starci.hfs` built from an in-memory hfs.json - the same inputs starciBeConfig gives a
 * repository. A case's `filename` is `at("src/modules/domain/order/order.service.ts")`: the file need not exist; the
 * slot comes from its path and the types from the ambient stubs in ./types.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TSESLint } from "@typescript-eslint/utils"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import type { HfsView } from "../../src/lib/hfs-view.ts"
import { hfsFromDeclaration } from "../../src/lib/hfs.ts"
import { appDeclaration, type SideDeclaration } from "../app.ts"

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
export const TYPED_ROOT: string = dirname(fileURLToPath(import.meta.url))

/** The default be side of the fixture app (hfs.json sides.be). */
export const BE_DECLARATION: SideDeclaration = Object.freeze({
    apps: [{ name: "api", kind: "api" }, { name: "cli", kind: "cli" }],
    connections: [{ name: "primary", envPrefix: "PRIMARY_DB", owner: "api", isolation: "database" }],
})

/** The HFS view of the fixture be side (`declaration` is the be side of the app). */
export const fixtureHfs = (declaration: SideDeclaration = BE_DECLARATION): HfsView => hfsFromDeclaration(appDeclaration("be", declaration), TYPED_ROOT)

/** Globs of every depth a case filename may sit at, per extension (the project service refuses a `**` glob). */
const depthsOf = (extensions: readonly string[] = ["ts"], maxDepth = 8): string[] =>
    Array.from({ length: maxDepth }, (_, depth) => extensions.map((ext) => `${"*/".repeat(depth)}*.${ext}`)).flat()

/** The absolute filename of a fixture-relative path. */
export const at = (rel: string): string => join(TYPED_ROOT, rel)

/** The one typed RuleTester both canons build: the project service on the fixture root's tsconfig, the fixture
 *  HFS in settings; the front end passes jsx, a .tsx second extension and its own depth and project cap. */
export const ruleTester = ({ root, hfs, jsx = false, extensions = ["ts"], maxDepth = 8, maxProjects = 500 }: {
    root: string
    hfs: object
    jsx?: boolean
    extensions?: readonly string[]
    maxDepth?: number
    maxProjects?: number
}): CanonRuleTester => new RuleTester({
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            ...(jsx ? { ecmaFeatures: { jsx: true } } : {}),
            // A case's file need not exist: the default project types it with this directory's tsconfig.json.
            projectService: { allowDefaultProject: depthsOf(extensions, maxDepth), defaultProject: "tsconfig.json", maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: maxProjects },
            tsconfigRootDir: root,
        },
    },
    settings: { starci: { hfs } },
    // ESLint's RuleTester declares ESLint's rule type; the canon's rules are typescript-eslint's, and at run time they are one object.
}) as unknown as CanonRuleTester

/** A RuleTester with typed linting and the fixture HFS settings. */
export const typedTester = ({ declaration }: { declaration?: SideDeclaration } = {}): CanonRuleTester => ruleTester({ root: TYPED_ROOT, hfs: fixtureHfs(declaration) })

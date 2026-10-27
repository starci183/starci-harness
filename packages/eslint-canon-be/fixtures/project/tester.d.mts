/** The declared contract of ./tester.mjs: a hermetic app on disk for the project-graph rules, with its RuleTester. */
import type { SideDeclaration } from "../app.mjs"
import type { CanonRuleTester } from "../typed/tester.mjs"

/** A fixture app: its side root, a side-relative path resolver, the tester and the cleanup. */
export interface ProjectFixture {
    readonly root: string
    readonly at: (rel: string) => string
    readonly tester: CanonRuleTester
    readonly cleanup: () => void
}

/** Write a hermetic app (a git work tree with every file added) and the RuleTester over it. */
export declare const projectFixture: (input?: {
    profile?: "be" | "fe"
    edition?: "full" | "lite"
    files?: Readonly<Record<string, string | null>>
    rootFiles?: Readonly<Record<string, string>>
    declaration?: SideDeclaration
    apps?: readonly { readonly name: string; readonly kind: string }[]
    manifestText?: string
}) => ProjectFixture

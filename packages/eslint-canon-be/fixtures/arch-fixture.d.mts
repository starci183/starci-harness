/** The declared contract of ./arch-fixture.mjs: hermetic apps for the architecture machine specs. */
import type { TestContext } from "node:test"
import type tsModule from "typescript"
import type { AppDeclaration, SideDeclaration } from "./app.mjs"

/** The TypeScript compiler the fixture's apps are typed with. */
export declare const ts: typeof tsModule

/** The default apps of each side. */
export declare const DEFAULT_APPS: Readonly<Record<"be" | "fe", readonly { readonly name: string; readonly kind: string }[]>>

/** Write `files` (relative path to content; null skips) under `root`. */
export declare function writeFiles(root: string, files: Readonly<Record<string, string | null>>): void

/** The app hfs.json of a fixture about one side. */
export declare function appDeclaration(side: "be" | "fe", fields: SideDeclaration, project?: string): AppDeclaration

/** A hermetic app whose `profile` side the machine judges; returns the side root. */
export declare function archFixture(
    t: TestContext,
    input?: {
        profile?: "be" | "fe"
        files?: Readonly<Record<string, string | null>>
        declaration?: SideDeclaration
        apps?: readonly { readonly name: string; readonly kind: string }[]
    },
): string

import { createRequire } from "node:module"
import type * as ts from "typescript"
import { Refusal } from "../shared/errors.js"

/** The TypeScript compiler module, loaded at run time from the app or the CLI's own install. */
export type TypeScript = typeof ts

const resolveQuietly = (require: NodeJS.Require, paths: string[] | undefined): string | undefined => {
    try {
        return paths === undefined ? require.resolve("typescript") : require.resolve("typescript", { paths })
    } catch {
        return undefined
    }
}

/**
 * The compiler a scan parses with: the app's own `typescript` (every StarCi front end has one), else the CLI's. No parser
 * of its own and no new dependency: a tree without either cannot be judged, and the caller says so.
 */
export const loadTypeScript = (appRoot: string): TypeScript => {
    const require = createRequire(import.meta.url)
    for (const paths of [[appRoot], undefined]) {
        const found = resolveQuietly(require, paths)
        if (found !== undefined) return require(found) as TypeScript
    }
    throw new Refusal("TYPESCRIPT_MISSING", `no typescript package resolves from ${appRoot} or the CLI; install the app's dependencies first`)
}

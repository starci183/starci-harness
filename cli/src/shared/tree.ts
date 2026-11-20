import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TreeKind } from "./verb.js"

/** The part of an hfs.json the CLI reads to pick its verbs. */
interface HfsDeclaration {
    readonly kind?: string
}

/** The StarCi tree a directory belongs to and its root. */
export interface TreeLocation {
    readonly tree: TreeKind
    readonly root: string | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const readDeclaration = (file: string): HfsDeclaration => {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (!isRecord(parsed)) return {}
    return {
        ...(typeof parsed.kind === "string" ? { kind: parsed.kind } : {}),
    }
}

/**
 * Walks up from `cwd` to the nearest hfs.json, stopping at the repository root (a `.git` entry) so a stray hfs.json
 * above the project never decides its tree. `kind: runtime` is the runtime itself; any other declaration is an app.
 */
export const locateTree = (cwd: string): TreeLocation => {
    let directory = cwd
    for (;;) {
        const file = join(directory, "hfs.json")
        if (existsSync(file)) {
            const declaration = readDeclaration(file)
            if (declaration.kind === "runtime") return { tree: "runtime", root: directory }
            return { tree: "app", root: directory }
        }
        const parent = dirname(directory)
        if (parent === directory || existsSync(join(directory, ".git"))) return { tree: "none", root: undefined }
        directory = parent
    }
}

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TreeKind } from "./verb.js"

/** The part of an hfs.json the CLI reads to pick its verbs. */
interface HfsDeclaration {
    readonly kind?: string
    readonly edition?: string
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
        ...(typeof parsed.edition === "string" ? { edition: parsed.edition } : {}),
    }
}

/** Walks up from `cwd` to the nearest hfs.json; an app without `edition` is full, `kind: runtime` is the runtime itself. */
export const locateTree = (cwd: string): TreeLocation => {
    let directory = cwd
    for (;;) {
        const file = join(directory, "hfs.json")
        if (existsSync(file)) {
            const declaration = readDeclaration(file)
            if (declaration.kind === "runtime") return { tree: "runtime", root: directory }
            return { tree: declaration.edition === "lite" ? "lite" : "full", root: directory }
        }
        const parent = dirname(directory)
        if (parent === directory) return { tree: "none", root: undefined }
        directory = parent
    }
}

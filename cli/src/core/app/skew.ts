import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { packageVersion } from "../version.js"
import type { HfsVerb } from "./hfs.js"

/** The coded finding of a CLI that judges an app with another version than the app pins (a PATH copy, a lane whose node_modules is stale). */
export const SKEW_CODE = "HFS_CLI_HFS_SKEW"
/** Set to 1 to let a refused write (`sync --execute`, `check --fix`) run under a skewed CLI anyway; the owner's call, never a default. */
export const ALLOW_SKEW_ENV = "STARCI_ALLOW_CLI_SKEW"

/** The harness package an app pins as its devDependency: the CLI that carries @starci/hfs. */
const HARNESS = "starci-harness"
const HFS = "@starci/hfs"
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** The verbs whose verdict or output is a version's own (templates, rules, pins); the others do not depend on which hfs runs them. */
const JUDGING: ReadonlySet<HfsVerb> = new Set<HfsVerb>(["check", "sync", "audit", "uiaudit", "gallery", "coverage", "emit", "codemod", "release", "ci"])

/** What one run was judged with, and what the app asks for. */
export interface SkewInput {
    /** This CLI's version (cli/package.json). */
    readonly cli: string
    /** The @starci/hfs version this CLI requires (its dependency, exact). */
    readonly hfsWanted: string | undefined
    /** The @starci/hfs version the CLI actually loaded. */
    readonly hfsLoaded: string | undefined
    /** The starci-harness version the app pins in its package.json; undefined outside an app. */
    readonly pinned: string | undefined
    /** The starci-harness version installed in the app's node_modules; undefined when none is installed. */
    readonly installed?: string | undefined
}

/** One skew: the code, the sentence that says what differs and what to run, and the versions compared. */
export interface Skew {
    readonly code: typeof SKEW_CODE
    readonly message: string
    readonly input: SkewInput
}

const readJson = (file: string): Record<string, unknown> | undefined => {
    try {
        const value = JSON.parse(readFileSync(file, "utf8")) as unknown
        return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
    } catch {
        return undefined
    }
}

const dependency = (manifest: Record<string, unknown> | undefined, name: string): string | undefined => {
    for (const field of ["dependencies", "devDependencies"] as const) {
        const spec = (manifest?.[field] as Record<string, unknown> | undefined)?.[name]
        if (typeof spec === "string") return spec
    }
    return undefined
}

/** The starci-harness version the app at `root` pins: an exact package.json dependency; undefined when it pins none (not an app, or a range). */
export const appPinnedCli = (root: string): string | undefined => {
    const spec = dependency(readJson(join(root, "package.json")), HARNESS)
    return spec !== undefined && EXACT.test(spec) ? spec : undefined
}

/** The starci-harness version installed under the app's node_modules (the copy its hooks run); undefined when none is. */
export const installedCli = (root: string): string | undefined => {
    const version = readJson(join(root, "node_modules", HARNESS, "package.json"))?.version
    return typeof version === "string" ? version : undefined
}

/** The @starci/hfs version this CLI requires, from its own package.json. */
export const requiredHfs = (): string | undefined => {
    const spec = dependency(readJson(fileURLToPath(new URL("../../../package.json", import.meta.url))), HFS)
    return spec !== undefined && EXACT.test(spec) ? spec : undefined
}

/** The version of the @starci/hfs this process resolves: the package.json above its entry file. */
export const loadedHfs = (): string | undefined => {
    try {
        let folder = dirname(fileURLToPath(import.meta.resolve(HFS)))
        for (let depth = 0; depth < 6; depth += 1, folder = dirname(folder)) {
            const manifest = readJson(join(folder, "package.json"))
            if (manifest?.name === HFS && typeof manifest.version === "string") return manifest.version
            if (!existsSync(dirname(folder)) || dirname(folder) === folder) break
        }
    } catch {
        return undefined
    }
    return undefined
}

/**
 * The skew of one run, or null when the CLI is the one the app pins and loaded the hfs it requires. Three ways to differ: the CLI is
 * not the app's pinned starci-harness (a PATH copy, another worktree's build: its templates and rules are that version's, so
 * `sync` writes and `check` demands what the app's own release does not), or its @starci/hfs is not the one it requires (a stale
 * or hoisted copy in a lane's node_modules); a third: the starci-harness installed under the app's node_modules is not its pin (a stale install, whose hooks run the older CLI). Outside an app (no exact pin) nothing is judged.
 */
export const cliHfsSkew = (input: SkewInput): Skew | null => {
    if (input.pinned === undefined) return null
    const differsCli = input.pinned !== input.cli
    const differsHfs = input.hfsWanted !== undefined && input.hfsLoaded !== undefined && input.hfsWanted !== input.hfsLoaded
    const stale = input.installed !== undefined && input.installed !== input.pinned
    if (!differsCli && !differsHfs && !stale) return null
    const reasons = [
        ...(differsCli ? [`this CLI is starci-harness ${input.cli} (@starci/hfs ${input.hfsLoaded ?? "unknown"}) but the app pins starci-harness ${input.pinned}`] : []),
        ...(differsHfs ? [`the @starci/hfs it loaded is ${input.hfsLoaded}, not the ${input.hfsWanted} it requires (a stale or hoisted copy in node_modules)`] : []),
    ]
    if (stale) reasons.push(`the app's node_modules holds starci-harness ${input.installed ?? "unknown"}, not its pin ${input.pinned} (a stale install: its hooks run that older CLI, which writes and demands what that version did)`)
    const message = `${SKEW_CODE}: ${reasons.join("; ")}: the templates, rules and pins it judges with are not the app's, so sync, check and the pre-push gate can disagree. Run the app's own CLI with \`npx --no-install starci <verb>\` from the app (run \`npm ci\` first when its node_modules is stale)`
    return { code: SKEW_CODE, message, input }
}

/** The skew of a `starci app <verb>` run at `root`, or null when the verb does not depend on the version or nothing differs. */
export const runSkew = (verb: HfsVerb, root: string): Skew | null => {
    if (!JUDGING.has(verb)) return null
    return cliHfsSkew({ cli: packageVersion(), hfsWanted: requiredHfs(), hfsLoaded: loadedHfs(), pinned: appPinnedCli(root), installed: installedCli(root) })
}


/** Whether a forwarded argv of `verb` writes into the app (the writes a skewed CLI refuses): `sync --execute`, `check --fix`. */
export const writes = (verb: HfsVerb, args: readonly string[]): boolean => (verb === "sync" && args.includes("--execute")) || (verb === "check" && args.includes("--fix")) || (verb === "uiaudit" && args[0] === "run") || (verb === "gallery" && args.includes("--execute"))

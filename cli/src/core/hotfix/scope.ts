import { lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { captureGit, CHECK_CACHE_DIR } from "../../shared/git.js"
import { MIGRATIONS_FOLDER } from "../../harness/land-profile.js"
import type { HotfixRules } from "./rules.js"

/** One file a hotfix changes, as the working tree differs from HEAD. */
export interface Change {
    readonly path: string
    /** Added lines (an untracked file: all its lines). */
    readonly added: number
    /** Deleted lines. */
    readonly deleted: number
    /** A binary file: its lines are unknown, so it counts as over the limit. */
    readonly binary: boolean
}

/** The size of a hotfix and whether the owner's limits (ops/hotfix.yaml) hold. */
export interface Scope {
    readonly files: number
    readonly lines: number
    readonly ok: boolean
}

/** The size of `changes` against `rules`: over either limit is not a hotfix. Pure. */
export const scopeOf = (changes: readonly Change[], rules: Pick<HotfixRules, "maxFiles" | "maxLines">): Scope => {
    const files = changes.length
    const lines = changes.reduce((sum, change) => sum + (change.binary ? rules.maxLines + 1 : change.added + change.deleted), 0)
    return { files, lines, ok: files <= rules.maxFiles && lines <= rules.maxLines }
}

/** The refusal of a hotfix over the limit: the owner's words, then the limits. Pure. */
export const tooBigMessage = (scope: Scope, rules: Pick<HotfixRules, "maxFiles" | "maxLines">): string =>
    `quá lớn cho hotfix (${String(scope.files)} file / ${String(scope.lines)} dòng), mở lane\nthe limits are ${String(rules.maxFiles)} files and ${String(rules.maxLines)} changed lines (ops/hotfix.yaml); open a lane: contexts/authority/lanes.md`

/** What makes a hotfix restart with the full sync steps instead of the light restart: a lockfile, a migration, a schema or a workspace package. Pure. */
export const escalationOf = (files: readonly string[]): string[] => {
    const slashed = files.map((file) => file.replaceAll("\\", "/"))
    const reasons: string[] = []
    if (slashed.some((file) => /(^|\/)package(-lock)?\.json$|(^|\/)npm-shrinkwrap\.json$/u.test(file))) reasons.push("a manifest or lockfile changed: npm ci")
    if (slashed.some((file) => file.startsWith(MIGRATIONS_FOLDER))) reasons.push("a migration changed: the stack's migrate step")
    if (slashed.some((file) => /(^|\/)schema\.graphql$/u.test(file))) reasons.push("a schema changed: codegen")
    if (slashed.some((file) => file.startsWith("packages/"))) reasons.push("a workspace package changed: build:modules")
    return reasons
}

const split = (text: string): string[] => text.split("\0").filter((entry) => entry !== "")

const countLines = (root: string, path: string): Change => {
    try {
        if (!lstatSync(join(root, path)).isFile()) return { path, added: 0, deleted: 0, binary: false }
        const raw = readFileSync(join(root, path))
        if (raw.includes(0)) return { path, added: 0, deleted: 0, binary: true }
        const text = raw.toString("utf8")
        return { path, added: text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0), deleted: 0, binary: false }
    } catch {
        return { path, added: 0, deleted: 0, binary: false }
    }
}

/** What the working tree of the dev checkout holds against HEAD. */
export interface Changes {
    /** The hotfix: the tracked changes (or, with `only`, the named paths, new files included), without the check-cache records. */
    readonly changes: Change[]
    /** With `only`: tracked changes outside it, which are not the hotfix and stop it. */
    readonly foreign: string[]
    /** Untracked files the hotfix does not take (a new file is named with `only`; a stray file is never swept in). */
    readonly untracked: string[]
}

/** Whether `path` is named by `only`: an entry ending in a slash names a folder, any other an exact path. Pure. */
export const isNamed = (path: string, only: readonly string[]): boolean =>
    only.some((entry) => {
        const named = entry.replaceAll("\\", "/").replace(/^\.\//u, "")
        return named.endsWith("/") ? path.startsWith(named) : path === named
    })

/**
 * The changes of the working tree at `root` against HEAD, split into the hotfix, the foreign tracked changes and the untracked files left alone. Without `only` every
 * tracked change is the hotfix and no untracked file is; with `only` the hotfix is exactly the named paths (tracked or new), and a tracked change outside them is
 * foreign. The check-cache records a gate writes under `.starcistacks/cache/` are none of these. Reads git only.
 */
export const readChanges = async (root: string, only: readonly string[] = []): Promise<Changes> => {
    const tracked = new Map<string, Change>()
    const numstat = await captureGit(["diff", "HEAD", "--numstat", "--no-renames", "-z"], root)
    // With -z a numstat entry is `added TAB deleted TAB path`, entries NUL separated.
    for (const entry of split(numstat.stdout)) {
        const [added = "", deleted = "", ...rest] = entry.split("	")
        const path = rest.join("	")
        if (path === "" || path.startsWith(CHECK_CACHE_DIR)) continue
        const binary = added === "-" || deleted === "-"
        tracked.set(path, { path, added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted), binary })
    }
    const named = only.length > 0
    const changes: Change[] = []
    const foreign: string[] = []
    for (const change of tracked.values()) {
        if (!named || isNamed(change.path, only)) changes.push(change)
        else foreign.push(change.path)
    }
    const untracked: string[] = []
    const others = await captureGit(["ls-files", "--others", "--exclude-standard", "-z"], root)
    for (const path of split(others.stdout)) {
        if (path.startsWith(CHECK_CACHE_DIR)) continue
        if (named && isNamed(path, only)) changes.push(countLines(root, path))
        else untracked.push(path)
    }
    const order = (left: string, right: string): number => (left < right ? -1 : 1)
    return { changes: changes.toSorted((left, right) => order(left.path, right.path)), foreign: foreign.toSorted(order), untracked: untracked.toSorted(order) }
}

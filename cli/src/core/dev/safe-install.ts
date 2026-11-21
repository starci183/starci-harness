import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"

/**
 * An install that never leaves a half-wiped `node_modules` (`dev sync`). A staging install swapped in by a rename is not sound for an app
 * of npm workspaces: `npm ci` writes the root `node_modules` and a nested one in any workspace that needs its own versions, and links each
 * workspace from the root, so a staging copy would need the whole tree of workspace folders and its links would point into the copy. So:
 *  1. every `node_modules` npm ci replaces (the root's, and each workspace's that exists) is renamed aside first, on the same volume. On
 *     Windows a rename of a folder whose file a process loaded fails at once, before anything is deleted; one bounded retry follows a
 *     short pause (a process that was just ended may still be letting go of its files);
 *  2. npm ci installs into the emptied places;
 *  3. on failure what it wrote is removed and every copy is moved back; on success the copies are renamed to a trash name and removed.
 * A copy left aside by a sync that died halfway is the last whole install: the next sync moves it back before it installs again.
 */

/** The suffix of a `node_modules` moved aside while an install runs. */
export const ASIDE = ".starci-aside"

/** The suffix of an old copy being removed after a swap; never moved back. */
const TRASH = ".starci-trash-"

/** The filesystem seam of an install (renames and removals), real by default and replaced by the specs. */
export interface InstallFs {
    readonly rename: (from: string, to: string) => void
    readonly remove: (path: string) => void
    readonly exists: (path: string) => boolean
}

export const realInstallFs: InstallFs = { rename: renameSync, remove: (path) => { rmSync(path, { recursive: true, force: true }) }, exists: existsSync }

/** How long the one retry of a refused rename waits. */
export const RETRY_MS = 3_000

/** The codes of a rename Windows refuses while a process holds a file inside the folder. */
const BUSY = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"])

const codeOf = (error: unknown): string => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : error instanceof Error ? error.message : String(error))

const matches = (pattern: string, name: string): boolean => new RegExp(`^${pattern.split("*").map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`)).join(".*")}$`, "u").test(name)

/** The folders the root package.json names as workspaces (`*` in a segment; a `**` pattern names none), each an existing folder. */
export const workspaceFolders = (root: string): string[] => {
    let manifest: unknown
    try {
        manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    } catch {
        return []
    }
    const declared = typeof manifest === "object" && manifest !== null && "workspaces" in manifest ? manifest.workspaces : undefined
    const patterns = Array.isArray(declared) ? declared : typeof declared === "object" && declared !== null && "packages" in declared && Array.isArray(declared.packages) ? declared.packages : []
    const found: string[] = []
    for (const pattern of patterns.filter((one): one is string => typeof one === "string" && !one.includes("**"))) {
        let at = [root]
        for (const segment of pattern.replaceAll("\\", "/").split("/").filter((one) => one !== "" && one !== ".")) {
            at = at.flatMap((dir) => {
                if (!segment.includes("*")) return existsSync(join(dir, segment)) ? [join(dir, segment)] : []
                try {
                    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && matches(segment, entry.name)).map((entry) => join(dir, entry.name))
                } catch {
                    return []
                }
            })
        }
        found.push(...at)
    }
    return [...new Set(found)]
}

/** Every place npm ci writes a `node_modules` of the app: the root's, then each workspace's. */
export const installPlaces = (root: string): string[] => [join(root, "node_modules"), ...workspaceFolders(root).map((dir) => join(dir, "node_modules"))]

/** The places whose copy a sync that died halfway left aside. */
export const leftAside = (root: string, fs: InstallFs = realInstallFs): string[] => installPlaces(root).filter((place) => fs.exists(`${place}${ASIDE}`))

/** Moves back every copy a sync that died halfway left aside, over whatever half install stands in its place; the places it restored. */
export const restoreLeftAside = (root: string, fs: InstallFs = realInstallFs): string[] => {
    const restored: string[] = []
    for (const place of leftAside(root, fs)) {
        if (fs.exists(place)) fs.remove(place)
        fs.rename(`${place}${ASIDE}`, place)
        restored.push(place)
    }
    return restored
}

/** Moves back every copy in `moved` (the newest first), over what an install wrote in its place; the first move that failed, if any. */
const moveBack = (moved: readonly string[], fs: InstallFs): string | undefined => {
    let failed: string | undefined
    for (const place of moved.toReversed()) {
        try {
            if (fs.exists(place)) fs.remove(place)
            fs.rename(`${place}${ASIDE}`, place)
        } catch (error) {
            failed ??= `${place}${ASIDE} could not be moved back to ${place} (${codeOf(error)}): rename it by hand`
        }
    }
    return failed
}

/** Renames every existing place aside; on the first refusal moves back what it moved and says which folder refused, and how. */
const moveAside = (places: readonly string[], fs: InstallFs): { readonly moved: readonly string[] } | { readonly held: string; readonly code: string } => {
    const moved: string[] = []
    for (const place of places) {
        try {
            fs.rename(place, `${place}${ASIDE}`)
            moved.push(place)
        } catch (error) {
            const undo = moveBack(moved, fs)
            if (undo !== undefined) throw new Refusal("DEV_SYNC_INSTALL", undo)
            return { held: place, code: codeOf(error) }
        }
    }
    return { moved }
}

/**
 * Runs `install` with every existing `node_modules` of the app moved aside, and puts them back when it fails; the old copies are removed
 * only once it succeeded. A folder still held by a process after the one retry refuses DEV_SYNC_BUSY before anything is deleted.
 */
export const installWithCopyAside = async (root: string, install: () => Promise<void>, say: (line: string) => void, fs: InstallFs = realInstallFs, pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<void> => {
    const all = installPlaces(root)
    const places = all.filter((place) => fs.exists(place))
    let aside = moveAside(places, fs)
    if ("held" in aside && BUSY.has(aside.code)) {
        say(`${aside.held} could not be moved aside (${aside.code}): a process may still hold a file in it; one retry in ${String(RETRY_MS / 1000)} s`)
        await pause(RETRY_MS)
        aside = moveAside(places, fs)
    }
    if ("held" in aside) throw new Refusal("DEV_SYNC_BUSY", `${aside.held} could not be moved aside (${aside.code}): a process still holds a file in it. Nothing was installed or deleted; node_modules is as it was. End what runs from it (starci app stack down --env <env> --execute, or the process named by the error) and sync again`)
    if (places.length > 0) say(`moved ${places.join(", ")} aside (${ASIDE}) until the install passes`)
    try {
        await install()
    } catch (error) {
        // What the install wrote where no copy stood is removed too: the places come back as they were.
        for (const place of all.filter((one) => !places.includes(one) && fs.exists(one))) fs.remove(place)
        const undo = moveBack(aside.moved, fs)
        if (undo !== undefined) throw new Refusal("DEV_SYNC_INSTALL", `${error instanceof Error ? error.message : String(error)}\n${undo}`)
        say("the install failed: the previous node_modules is back in place")
        throw error
    }
    for (const place of aside.moved) {
        const trash = `${place}${TRASH}${String(Date.now())}`
        try {
            fs.rename(`${place}${ASIDE}`, trash)
            fs.remove(trash)
        } catch (error) {
            say(`the old copy ${place}${ASIDE} could not be removed (${codeOf(error)}); remove it by hand`)
        }
    }
}

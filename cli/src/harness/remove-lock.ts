import { createHash } from "node:crypto"
import { linkSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname, uptime } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import { sharedStateBase } from "./ledger.js"

/**
 * The removal lock of a worktree (`starci lane remove`): while it is held, no install path of the harness (`slot run npm`, any
 * heavy npm command, the install cache) runs in that worktree or under it, so no new directory junction appears while
 * `lane remove` is unlinking the ones there are. One lock file per worktree in the slot root (STARCI_LANES_DIR, else
 * `<shared harness state>/slots`), named by the hash of the worktree path and written in the slot line format of harness/slots.ts:
 * `<lane> <taken> pid=<pid> boot=<host boot> host=<host> path=<url-encoded worktree>`. It is taken whole and alone (a hard link of a
 * written file) and released only by the holder it names. It is stale only on evidence: its pid is not alive, or the host booted after it.
 */

const PREFIX = "_remove-"
const BOOT_TOLERANCE_MS = 300_000

/** The folder that holds the removal locks: the slot root. */
export const removeLockRoot = (): string => {
    const env = process.env.STARCI_LANES_DIR
    return env !== undefined && env !== "" ? resolve(env) : join(sharedStateBase(), "slots")
}

const spell = (path: string): string => {
    const text = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? text.toLowerCase() : text
}

/** The lock file of a worktree. */
export const removeLockFile = (root: string, worktree: string): string => join(root, `${PREFIX}${createHash("sha1").update(spell(worktree)).digest("hex").slice(0, 16)}.lock`)

const bootIso = (): string => new Date(Math.round((Date.now() - uptime() * 1000) / 1000) * 1000).toISOString()

/** What a removal lock file says. */
export interface RemoveLock {
    readonly file: string
    readonly lane: string
    readonly at: string
    readonly pid: number | null
    readonly bootMs: number | null
    readonly host: string | null
    readonly worktree: string | null
    readonly content: string
}

const readLock = (file: string): RemoveLock | undefined => {
    let content: string
    try {
        content = readFileSync(file, "utf8")
    } catch {
        return undefined
    }
    const words = content.trim().split(/\s+/)
    const pid = Number(/\bpid=(\d+)/.exec(content)?.[1] ?? "0")
    const boot = Date.parse(/\bboot=(\S+)/.exec(content)?.[1] ?? "")
    const path = /\bpath=(\S+)/.exec(content)?.[1]
    return { file, lane: words[0] ?? "", at: words[1] ?? "", pid: pid > 0 ? pid : null, bootMs: Number.isFinite(boot) ? boot : null, host: /\bhost=(\S+)/.exec(content)?.[1] ?? null, worktree: path === undefined ? null : decodeURIComponent(path), content }
}

/** True when the lock's holder may still be running: another host's lock is held, a dead pid or another boot is not. */
const live = (lock: RemoveLock): boolean => {
    if (lock.host !== null && lock.host !== hostname()) return true
    if (lock.pid !== null && !pidAlive(lock.pid)) return false
    if (lock.bootMs !== null && Math.abs(lock.bootMs - Date.parse(bootIso())) > BOOT_TOLERANCE_MS) return false
    return true
}

const lineOf = (lane: string, worktree: string): string => `${lane} ${new Date().toISOString()} pid=${String(process.pid)} boot=${bootIso()} host=${hostname()} path=${encodeURIComponent(resolve(worktree))}`

const takeFile = (file: string, content: string): boolean => {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`
    writeFileSync(temporary, content)
    try {
        linkSync(temporary, file)
        return true
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") return false
        throw error
    } finally {
        unlinkSync(temporary)
    }
}

/** The live removal lock over a worktree, if any. */
export const removeLockOf = (worktree: string, root: string = removeLockRoot()): RemoveLock | undefined => {
    const lock = readLock(removeLockFile(root, worktree))
    return lock !== undefined && live(lock) ? lock : undefined
}

/** Takes the removal lock of a worktree for `lane`; refused WORKTREE_REMOVING when a live holder has it, a stale one is reclaimed first. */
export const takeRemoveLock = (worktree: string, lane: string, root: string = removeLockRoot()): RemoveLock => {
    const file = removeLockFile(root, worktree)
    for (let attempt = 0; attempt < 3; attempt++) {
        if (takeFile(file, lineOf(lane, worktree))) {
            const mine = readLock(file)
            if (mine !== undefined) return mine
            continue
        }
        const held = readLock(file)
        if (held === undefined) continue
        if (live(held)) throw new Refusal("WORKTREE_REMOVING", `${worktree} is already being removed by ${held.lane} (pid ${String(held.pid)}, ${held.at}): ${file}`)
        const aside = `${file}.reclaim.${String(process.pid)}.${String(Date.now())}`
        try {
            renameSync(file, aside)
            unlinkSync(aside)
        } catch {
            // another reclaimer won; the next pass takes or refuses
        }
    }
    throw new Refusal("WORKTREE_REMOVING", `could not take the removal lock ${file}`)
}

/** Releases a removal lock, only once read and found to name this holder and pid. */
export const releaseRemoveLock = (lock: RemoveLock): boolean => {
    const read = readLock(lock.file)
    if (read?.content !== lock.content) return false
    try {
        unlinkSync(lock.file)
        return true
    } catch {
        return false
    }
}

/**
 * Refuses when `dir` is a worktree under removal or inside one: the guard every install path calls before it writes a `node_modules` or
 * links one. Cheap: it lists the lock files of the slot root and reads the ones named `_remove-*`.
 */
export const assertNotRemoving = (dir: string, root: string = removeLockRoot()): void => {
    let names: string[]
    try {
        names = readdirSync(root).filter((name) => name.startsWith(PREFIX) && name.endsWith(".lock"))
    } catch {
        return
    }
    const here = spell(dir)
    for (const name of names) {
        const lock = readLock(join(root, name))
        if (lock?.worktree === null || lock === undefined || !live(lock)) continue
        const base = spell(lock.worktree)
        if (here === base || here.startsWith(`${base}/`) || here.startsWith(`${base}${sep}`)) {
            throw new Refusal("WORKTREE_REMOVING", `${lock.worktree} is being removed by ${lock.lane} (pid ${String(lock.pid)}, ${lock.at}); no install runs in it: wait for starci lane remove to end (${lock.file})`)
        }
    }
}

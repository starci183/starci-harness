import { createHash } from "node:crypto"
import { readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { pidAlive } from "../../shared/exec.js"
import { takeLockFile } from "../../harness/slots.js"

/** How long a sync waits for another sync of the same checkout before it gives up (the other one is an npm ci and a rebuild: minutes). */
export const SYNC_LOCK_WAIT_MS = 30 * 60_000

/** The lock file of one checkout: one per normalised path under the machine's temp folder, so every lander and every hand run of this machine meets at it. Pure. */
export const syncLockFile = (checkout: string, base: string = tmpdir()): string => {
    const key = resolve(checkout).replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "")
    return join(base, "starci-dev-sync-locks", `${createHash("sha1").update(key).digest("hex").slice(0, 16)}.lock`)
}

/**
 * Runs `work` while this process alone holds the checkout's sync lock. A second sync of the same checkout waits for the first (both would
 * rewrite node_modules); the lock of a process that is gone is reclaimed; a wait past `waitMs` refuses DEV_SYNC_BUSY. Syncs of different
 * checkouts never wait for each other.
 */
export const withSyncLock = async <T>(file: string, say: (line: string) => void, work: () => Promise<T>, pause: (ms: number) => Promise<void>, waitMs: number = SYNC_LOCK_WAIT_MS): Promise<T> => {
    const mine = `dev-sync pid=${String(process.pid)} at=${new Date().toISOString()}`
    const started = Date.now()
    let told = false
    while (!takeLockFile(file, mine)) {
        let held = ""
        try {
            held = readFileSync(file, "utf8")
        } catch {
            continue
        }
        const pid = Number(/pid=(\d+)/.exec(held)?.[1] ?? "0")
        if (!(pid > 0 && pidAlive(pid))) {
            try {
                if (readFileSync(file, "utf8") === held) unlinkSync(file)
            } catch {
                // gone already
            }
            continue
        }
        if (Date.now() - started > waitMs) throw new Refusal("DEV_SYNC_BUSY", `another dev sync of this checkout still runs (${held.trim()}); nothing was moved. Run it again when that one ends`)
        if (!told) say(`another dev sync of this checkout runs (${held.trim()}): waiting for it to end`)
        told = true
        await pause(2000)
    }
    try {
        return await work()
    } finally {
        try {
            if (readFileSync(file, "utf8") === mine) unlinkSync(file)
        } catch {
            // gone already
        }
    }
}

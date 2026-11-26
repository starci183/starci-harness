import { Refusal } from "../shared/errors.js"
import { captureNpm } from "../shared/exec.js"
import { withHeavySlot } from "./heavy.js"
import { isOutOfMemory } from "./lane-state.js"
import { cacheLaneInstall, followsBase, sharedInstall } from "./shared-install.js"
import { withSlot } from "./slots.js"
import type { loadSlotRules } from "./slots.js"

/**
 * The install of a worktree of an app before it is checked or pushed (contexts/authority/lanes.md "The install of a fresh lane is shared"): under an `npm`
 * slot, its node_modules by hard links from the repository's install cache when its lockfiles equal a reference install, else `npm ci` under the heavy
 * governor, whose result fills the cache for the next worktree when the lockfiles follow `ref`. `lane gate` and `dev promote` install through it.
 */

/** Where a worktree's node_modules came from. */
export type InstallSource = "shared" | "npm ci"

/** What an install needs: the slot root and rules, the holder its slots name, how long to wait for one, the ref whose lockfiles a reusable install follows. */
export interface InstallWorktree {
    readonly root: string
    readonly holder: string
    readonly slots: string
    readonly rules: ReturnType<typeof loadSlotRules>
    readonly wait: number | undefined
    /** The ref the tree's lockfiles must equal for its own `npm ci` to fill the install cache (origin/dev, or the integration branch). */
    readonly ref: string
    /** `npm ci` whatever the cache holds (`lane gate --install`). */
    readonly force: boolean
    /** The app's dev sync checkout, a fill source of the cache (never a link source). */
    readonly devSyncCheckout: string | undefined
    readonly say: (line: string) => void
}

/** Installs `root`; refuses LANE_GATE_INSTALL with the tail of a failed `npm ci`. */
export const installWorktree = async (given: InstallWorktree): Promise<InstallSource> => {
    const { root, holder, slots, rules, wait, say } = given
    return withSlot(slots, rules, "npm", holder, { waitSeconds: wait, say }, async (taken) => {
        const runScript = async (script: string): Promise<boolean> => (await withHeavySlot("install", `${holder}: npm run ${script}`, root, {}, (held) => captureNpm(["run", script, "--ignore-scripts", "--silent"], root, held.options))).exitCode === 0
        if (given.force) say("--install: npm ci, no shared install")
        else {
            const shared = await sharedInstall(root, { lanes: slots, say, runScript, devSyncCheckout: given.devSyncCheckout })
            if (shared.status === "linked") {
                say(`node_modules from the shared install ${shared.key} (${String(shared.files)} files, ${String(shared.copied)} copied, ${String(Math.round(shared.ms / 100) / 10)}s), no npm ci; lifecycle: ${shared.scripts.join(", ") || "none"} (npm slot ${String(taken.n)})`)
                return "shared"
            }
            say(`shared install not used (${shared.reason}); npm ci`)
        }
        say(`npm ci (npm slot ${String(taken.n)})`)
        const run = await withHeavySlot("install", `${holder}: npm ci`, root, { onSpawn: taken.spawned }, (held) => captureNpm(["ci", "--no-audit", "--no-fund"], root, held.options))
        if (run.exitCode !== 0) throw new Refusal("LANE_GATE_INSTALL", `npm ci exited ${String(run.exitCode)}${isOutOfMemory(run.exitCode, run.stderr) ? " (out of memory: run it again once the host has RAM)" : ""}: ${run.stderr.split("\n").slice(-3).join(" ")}`)
        // A tree whose lockfiles equal the line's holds the install every next worktree wants: cache it once.
        if (!given.force && followsBase(root, given.ref)) say(await cacheLaneInstall(root, slots))
        return "npm ci"
    })
}

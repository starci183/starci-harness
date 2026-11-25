import { currentHeavyRules, loadHeavyRules } from "./heavy.js"
import type { HeavyRules } from "./heavy.js"
import { freeDiskMb } from "./host-floors.js"
import { readHostSettings } from "./host-settings.js"
import type { HostSettings } from "./host-settings.js"
import { laneTrees, liveContext, liveReasons } from "./install-janitor.js"
import type { LaneTree, LiveContext } from "./install-janitor.js"
import { readStatuses } from "./lane-state.js"
import { loadSlotRules } from "./slots.js"
import type { SlotRules } from "./slots.js"

/**
 * The early disk warning of `lane gate` (contexts/authority/lanes.md "Slots"): the heavy-command governor refuses to start anything under the host's disk floor
 * (`host.diskFloorMb`, 15 GB), and by then every gate on the host stalls and somebody has to find what to delete. So a gate prints a warning while the drive
 * still has room, under `host.diskWarnMb` of config.yaml (else `heavy.diskWarnMb` of ops/liveness.yaml, 50 GB; never under the floor), and lists the landed
 * lanes whose worktrees can be removed. It only lists: nothing is deleted here, `starci lane remove <worktree> --execute` is the owner's or the lane's call.
 */

/** The free space under which the warning shows when neither config.yaml nor ops/liveness.yaml says: 50 GB. */
export const DEFAULT_DISK_WARN_MB = 51_200

/** How many removable worktrees one warning names before it counts the rest. */
const LISTED = 20

/** The seams of the warning, real by default; the specs hand in their own. */
export interface DiskWarningDeps {
    readonly freeMb: (path: string) => number | null
    readonly heavy: () => Pick<HeavyRules, "diskFloorMb" | "diskWarnMb">
    readonly settings: () => Pick<HostSettings, "diskFloorMb" | "diskWarnMb" | "source">
    readonly trees: (dir: string) => LaneTree[]
    /** The lanes that landed, each with the lane's own sha at the landing. */
    readonly landed: (dir: string) => { readonly lane: string; readonly laneSha: string }[]
    readonly live: (dir: string, rules: SlotRules) => Promise<LiveContext>
    readonly rules: () => SlotRules
}

const realDeps: DiskWarningDeps = {
    freeMb: freeDiskMb,
    heavy: () => currentHeavyRules(loadHeavyRules(), () => loadHeavyRules()),
    settings: () => readHostSettings(),
    trees: laneTrees,
    landed: (dir) => readStatuses(dir).map((status) => ({ lane: status.lane, laneSha: status.laneSha })),
    live: liveContext,
    rules: () => loadSlotRules(),
}

const gb = (mb: number): string => `${(mb / 1024).toFixed(1).replace(/\.0$/, "")} GB`

/**
 * The warning's lines for the lanes folder `dir`, empty when the drive has room (or cannot be read): the free space against the threshold and the floor, then
 * every landed lane whose worktree nothing holds (`liveReasons` of the install janitor, asked as after a landing), each with the command that removes it,
 * and a count of the landed worktrees still in use. `except` is the lane running this gate: its own worktree is never offered. Never throws.
 */
export const diskWarningLines = async (dir: string, except: string, deps: DiskWarningDeps = realDeps): Promise<string[]> => {
    try {
        const freeMb = deps.freeMb(dir)
        if (freeMb === null) return []
        const heavy = deps.heavy()
        const settings = deps.settings()
        const floorMb = settings.diskFloorMb ?? heavy.diskFloorMb
        const configured = settings.diskWarnMb ?? heavy.diskWarnMb ?? DEFAULT_DISK_WARN_MB
        const warnMb = Math.max(configured, floorMb)
        if (freeMb >= warnMb) return []
        const where = settings.diskWarnMb === undefined ? "heavy.diskWarnMb of ops/liveness.yaml" : "host.diskWarnMb"
        const lines = [`WARNING: ${gb(freeMb)} free on the drive of ${dir}, under the early warning of ${gb(warnMb)} (${where}); under ${gb(floorMb)} nothing heavy starts and every gate waits.`]
        const landed = new Map(deps.landed(dir).map((status) => [status.lane, status.laneSha]))
        const trees = deps.trees(dir).filter((tree) => tree.lane !== except && landed.has(tree.lane))
        if (trees.length === 0) return [...lines, "  no landed lane worktree is left to remove; look at what else fills the drive (`starci lane prune-installs`, old _ folders)."]
        const context = await deps.live(dir, deps.rules())
        const removable: LaneTree[] = []
        let inUse = 0
        for (const tree of trees) {
            const sha = landed.get(tree.lane)
            if (liveReasons(tree, context, sha === undefined || sha === "" ? undefined : sha, Date.now(), true).length === 0) removable.push(tree)
            else inUse += 1
        }
        if (removable.length > 0) {
            lines.push(`  ${String(removable.length)} landed lane worktree(s) can be removed (landed, branch kept, no process or uncommitted work in them; this gate removes none): \`starci lane remove <worktree> --execute\``)
            for (const tree of removable.slice(0, LISTED)) lines.push(`    ${tree.lane}: ${tree.path}`)
            if (removable.length > LISTED) lines.push(`    ... and ${String(removable.length - LISTED)} more`)
        }
        if (inUse > 0) lines.push(`  ${String(inUse)} more landed worktree(s) are in use or hold uncommitted work and are not listed (\`starci lane prune-installs\` frees their installs once idle).`)
        return lines
    } catch {
        return []
    }
}

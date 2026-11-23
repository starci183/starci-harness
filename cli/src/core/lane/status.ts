import { readFileSync } from "node:fs"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { checkLaneName, landPaths, landerLiveness, lanesDir, readStatuses, readyEntries } from "../../harness/land-queue.js"
import type { LanderLiveness } from "../../harness/land-queue.js"

const held = (file: string): string | null => {
    try {
        return readFileSync(file, "utf8").trim()
    } catch {
        return null
    }
}

const minutes = (ms: number): string => `${String(Math.round(ms / 60_000))}m`

/** The lander line: never the bare lock, which reads the same for a live lander and a killed one. */
export const landerLine = (liveness: LanderLiveness): string => {
    if (liveness.state === "none") return "lander: not running (start `starci lane land` in the background)"
    if (liveness.state === "alive") return `lander: alive, ${liveness.held}`
    if (liveness.state === "dead") return `lander: DEAD, ${liveness.held}: pid ${String(liveness.pid)} is not running; start \`starci lane land\` again (it reclaims the lock)`
    return `lander: NO HEARTBEAT for ${minutes(liveness.idleMs)}, ${liveness.held}: the pid runs but its loop stopped; read _batch-land.log before acting`
}

/** `starci lane status [lane]`: the ready set, the lander, the dev lock and every lane's status (or one lane's). */
export const laneStatusVerb = defineVerb({
    path: ["lane", "status"],
    summary: "print the batch lander's ready set, who holds the lander and the dev lock, and each lane's state (queued, landed, conflict, rejected)",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/lane-status@1",
    flags: {
        lane: { kind: "string", summary: "only this lane", positional: true },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
    },
    run: (_context, flags) => {
        const dir = lanesDir(flags.dir)
        const only = flags.lane === undefined ? undefined : checkLaneName(flags.lane)
        const statuses = readStatuses(dir).filter((status) => only === undefined || status.lane === only).sort((left, right) => left.lane.localeCompare(right.lane))
        const ready = readyEntries(dir).filter((entry) => only === undefined || entry.lane === only)
        const paths = landPaths(dir)
        const lander = landerLiveness(paths.lander)
        const data = { lander: held(paths.lander), landerState: lander.state, devLock: held(paths.devLock), ready, statuses }
        const readyLine = ready.map((entry) => `${entry.lane} ${entry.sha.slice(0, 10)}`).join(", ")
        const lines = [
            landerLine(lander),
            `dev lock: ${data.devLock ?? "free"}`,
            `ready: ${readyLine === "" ? "none" : readyLine}`,
            ...statuses.map((status) => `${status.lane}: ${status.state} ${status.sha.slice(0, 10)}${status.reason === undefined ? "" : ` (${status.reason})`}${status.ci === undefined ? "" : `, dev CI ${status.ci.state}`}`),
        ]
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})

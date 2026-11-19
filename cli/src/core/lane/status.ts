import { readFileSync } from "node:fs"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { checkLaneName, landPaths, lanesDir, readStatuses, readyEntries } from "../../harness/land-queue.js"

const held = (file: string): string | null => {
    try {
        return readFileSync(file, "utf8").trim()
    } catch {
        return null
    }
}

/** `starci lane status [lane]`: the ready set, the lander, the dev lock and every lane's status (or one lane's). */
export const laneStatusVerb = defineVerb({
    path: ["lane", "status"],
    summary: "print the batch lander's ready set, who holds the lander and the dev lock, and each lane's state (queued, landed, conflict, rejected)",
    editions: BOTH_EDITIONS,
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
        const data = { lander: held(paths.lander), devLock: held(paths.devLock), ready, statuses }
        const readyLine = ready.map((entry) => `${entry.lane} ${entry.sha.slice(0, 10)}`).join(", ")
        const lines = [
            `lander: ${data.lander ?? "not running"}`,
            `dev lock: ${data.devLock ?? "free"}`,
            `ready: ${readyLine === "" ? "none" : readyLine}`,
            ...statuses.map((status) => `${status.lane}: ${status.state} ${status.sha.slice(0, 10)}${status.reason === undefined ? "" : ` (${status.reason})`}`),
        ]
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})

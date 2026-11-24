import { readFileSync } from "node:fs"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { checkLaneName, landPaths, lanesDir, readStatuses } from "../../harness/lane-state.js"

const held = (file: string): string | null => {
    try {
        return readFileSync(file, "utf8").trim()
    } catch {
        return null
    }
}

/** `starci lane status [lane]`: who holds the dev lock and each landed lane's status (or one lane's). */
export const laneStatusVerb = defineVerb({
    path: ["lane", "status"],
    summary: "print who holds the dev lock and each lane's landing status (the dev commit that carries it and its dev CI verdict)",
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
        const data = { devLock: held(landPaths(dir).devLock), statuses }
        const lines = [
            `dev lock: ${data.devLock ?? "free"}`,
            ...statuses.map((status) => `${status.lane}: ${status.state} ${status.sha.slice(0, 10)}${status.reason === undefined ? "" : ` (${status.reason})`}${status.ci === undefined ? "" : `, dev CI ${status.ci.state}`}`),
        ]
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})

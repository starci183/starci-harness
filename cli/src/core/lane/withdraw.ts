import { WRITERS, defineVerb } from "../../shared/verb.js"
import { checkLaneName, dropReady, lanesDir, writeStatus } from "../../harness/land-queue.js"

/** `starci lane withdraw <lane>`: take a lane out of the ready set before a batch picks it up. */
export const laneWithdrawVerb = defineVerb({
    path: ["lane", "withdraw"],
    summary: "take a lane out of the batch lander's ready set (a batch already under way keeps it)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/lane-withdraw@1",
    flags: {
        lane: { kind: "string", summary: "the lane name", required: true, positional: true },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
    },
    run: (_context, flags) => {
        const dir = lanesDir(flags.dir)
        const lane = checkLaneName(flags.lane)
        const dropped = dropReady(dir, lane)
        if (dropped) writeStatus(dir, { lane, state: "withdrawn", sha: "", laneSha: "", branch: "" })
        return Promise.resolve({ data: { lane, withdrawn: dropped }, message: dropped ? `withdrawn: ${lane}` : `${lane} was not registered` })
    },
})

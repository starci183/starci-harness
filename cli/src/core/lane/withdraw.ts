import { WRITERS, defineVerb } from "../../shared/verb.js"
import { checkLaneName, dropReady, lanesDir, readStatuses, readyEntries, writeStatus } from "../../harness/land-queue.js"

/**
 * Withdraws a lane: its registration goes, and its status says `withdrawn`, with the batch it was in (`fromBatch`) while that batch
 * queued or gated it. A running batch re-reads the ready set before each gate run, after it and right before it pushes, so it aborts
 * and the others are gated again in the next batch (harness/land-batch.ts): a withdrawn lane never lands. Returns the batch the lane
 * was taken out of (undefined when it only waited), or false when the lane was not registered.
 */
export const withdrawLane = (dir: string, lane: string): { readonly fromBatch?: string } | false => {
    const entry = readyEntries(dir).find((ready) => ready.lane === lane)
    const status = readStatuses(dir).find((one) => one.lane === lane)
    if (!dropReady(dir, lane)) return false
    const fromBatch = status?.state === "queued" ? status.batch : undefined
    writeStatus(dir, {
        lane, state: "withdrawn", sha: entry?.sha ?? "", laneSha: entry?.sha ?? "", branch: entry?.branch ?? "",
        ...(fromBatch === undefined ? {} : { fromBatch, reason: `withdrawn from batch ${fromBatch}: it is never landed` }),
    })
    return fromBatch === undefined ? {} : { fromBatch }
}

/** `starci lane withdraw <lane>`: take a lane out of the ready set, and out of a batch queued or gating with it. */
export const laneWithdrawVerb = defineVerb({
    path: ["lane", "withdraw"],
    summary: "take a lane out of the batch lander's ready set and out of a batch under way (that batch aborts and the others are gated again; a withdrawn lane never lands)",
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
        const done = withdrawLane(dir, lane)
        const from = done === false ? undefined : done.fromBatch
        return Promise.resolve({
            data: { lane, withdrawn: done !== false, ...(from === undefined ? {} : { fromBatch: from }) },
            message: done === false ? `${lane} was not registered` : `withdrawn: ${lane}${from === undefined ? "" : ` (out of batch ${from}: it aborts and re-forms without ${lane})`}`,
        })
    },
})

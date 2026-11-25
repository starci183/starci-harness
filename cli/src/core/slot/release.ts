import { Refusal } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { loadSlotRules, reclaimStale, releaseSlots, slotKind, slotRoot } from "../../harness/slots.js"
import { laneHolder, positiveInt } from "./holder.js"

/**
 * `starci slot release <kind>`: remove the slots of a kind the lane holds, each only once read and found to name the lane. With
 * `--stale` (no lane), reclaim every slot of the kind (every kind for `all`) whose holder is proven gone (its pid dead or reused, taken before this boot, or a lock with no pid whose lane is proven gone); age alone never reclaims.
 */
export const slotReleaseVerb = defineVerb({
    path: ["slot", "release"],
    summary: "release the slots of a kind this lane holds (each only after it is read and names the lane); --stale reclaims every slot whose holder is proven gone (pid dead or reused, taken before this boot, or a pid-less lock whose lane is proven gone), logging the evidence; age never reclaims",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/slot-release@1",
    flags: {
        kind: { kind: "string", summary: "the slot kind (ops/slots.yaml kinds); with --stale, all for every kind", required: true, positional: true },
        lane: { kind: "string", summary: "the lane that holds it (default: STARCI_LANE, else the branch lane/<lane>)" },
        n: { kind: "string", summary: "only this slot number" },
        stale: { kind: "boolean", summary: "reclaim the slots of the kind whose holder is proven gone, whoever holds them; an old one is reported, never removed" },
        dir: { kind: "string", summary: "the lanes folder, where foreign slot lock files of older copies are honoured too (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots); the slots themselves are rows of machine.sqlite, the same from every folder" },
    },
    run: async (context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        if (flags.stale) {
            if (flags.lane !== undefined || flags.n !== undefined) throw new Refusal("CLI_USAGE", "--stale reclaims by state, whoever holds the slot: it takes no --lane or --n")
            const names = flags.kind === "all" ? Object.keys(rules.kinds) : [flags.kind]
            for (const name of names) slotKind(rules, name)
            const done = await reclaimStale(root, rules, names, `slot release --stale (pid ${String(process.pid)})`)
            const lines = [...done.released.map((file) => `reclaimed ${file}`), ...done.kept]
            return { data: { root, ...done }, message: lines.length === 0 ? "no slot whose holder is proven gone" : lines.join("\n") }
        }
        const holder = await laneHolder(context.cwd, flags.lane)
        const n = positiveInt("n", flags.n)
        const done = releaseSlots(root, rules, flags.kind, holder, n === undefined ? {} : { n })
        const lines = [...done.released.map((file) => `released ${file}`), ...done.kept.map((line) => `kept ${line}`)]
        return { data: { root, holder, ...done }, message: lines.length === 0 ? `${holder} holds no ${flags.kind} slot` : lines.join("\n") }
    },
})

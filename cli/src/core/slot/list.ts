import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { laneProbe, listSlots, loadSlotRules, slotRoot } from "../../harness/slots.js"

/** `starci slot list [kind]`: every slot with its lane, age, holder alive and reclaimable, pid and state (free, held, old, dead, reused, rebooted, gone). */
export const slotListVerb = defineVerb({
    path: ["slot", "list"],
    summary: "list the machine-wide slots (every kind, or one) with lane, age, holder alive (yes, no, unknown), pid, state and whether it is reclaimable: free, held, old (a warning only), or reclaimable: dead (its pid is not alive), reused (its pid runs another process), rebooted (taken before this boot) or gone (a lock with no pid whose lane has no worktree, or none with a live process in it); a held slot says why it is not reclaimable",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/slot-list@1",
    flags: {
        kind: { kind: "string", summary: "only this kind", positional: true },
        dir: { kind: "string", summary: "the slot root (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
    },
    run: async (_context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        const slots = listSlots(root, rules, flags.kind === undefined ? [] : [flags.kind], await laneProbe(root))
        const lines = [
            `root: ${root}`,
            ...slots.map((slot) =>
                slot.state === "free"
                    ? `${slot.kind} ${String(slot.n)}${slot.burst ? " (burst)" : ""}: free`
                    : `${slot.kind} ${String(slot.n)}${slot.burst ? " (burst)" : ""}: ${slot.state} lane ${String(slot.holder)} age ${String(slot.ageMinutes)} min alive ${String(slot.alive)} reclaimable ${slot.reclaimable === true ? "yes" : "no"}${slot.pid === null || slot.pid === undefined ? "" : ` pid ${String(slot.pid)}`}${slot.why === undefined ? "" : `\n    not reclaimable: ${slot.why}`}`,
            ),
        ]
        return { data: { root, slots }, message: lines.join("\n") }
    },
})

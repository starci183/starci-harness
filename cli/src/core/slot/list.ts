import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { heavySlots, legacyHeavyRows } from "../../harness/heavy.js"
import type { HeavySlot } from "../../harness/heavy.js"
import { machinePath } from "../../harness/ledger.js"
import { recentEvents } from "../../harness/slot-store.js"
import { listSlots, loadSlotRules, slotProbe, slotRoot } from "../../harness/slots.js"
import type { SlotView } from "../../harness/slots.js"
import { positiveInt } from "./holder.js"

const minutesSince = (at: string | undefined): string => (at === undefined ? "?" : String(Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000))))

/** One lane slot as a line: number, state, lane, pid, child, age, command, and where a foreign lock lies. */
const laneLine = (slot: SlotView): string => {
    const name = `${slot.kind} ${String(slot.n)}`
    if (slot.source === "free") return `${name}: free`
    const pid = slot.pid === null || slot.pid === undefined ? "pid none" : `pid ${String(slot.pid)}`
    const child = slot.childPid === null || slot.childPid === undefined ? "" : ` child ${String(slot.childPid)}`
    const command = slot.command === undefined ? "" : ` command ${slot.command}`
    const foreign = slot.source === "foreign" ? ` foreign lock ${slot.where}` : ""
    const why = slot.why === undefined ? "" : `\n    not reclaimable: ${slot.why}`
    return `${name}: ${slot.state} lane ${String(slot.holder)} ${pid}${child} age ${String(slot.ageMinutes)} min alive ${String(slot.alive)} reclaimable ${slot.reclaimable === true ? "yes" : "no"}${command}${foreign}${why}`
}

/** One heavy slot as a line: id, state, units, pid, child, age, command (its label), and an older copy's row marked. */
const heavyLine = (slot: HeavySlot): string =>
    `heavy ${slot.id}: ${slot.state} ${slot.kind} ${String(slot.weight)} unit(s) pid ${String(slot.pid)}${slot.childPid === null ? "" : ` child ${String(slot.childPid)}`} age ${minutesSince(slot.at)} min command ${slot.label}${slot.source === "foreign" ? " [older copy's governor.sqlite, counted, never written]" : ""}`

/**
 * `starci slot list [kind]`: every slot of the host store (machine.sqlite, the same file from every folder and CLI copy): the lane slots with their lane,
 * pid, child, age, command, state and whether they are reclaimable, the foreign lock files of older copies, and the heavy-command rows (`heavy`).
 */
export const slotListVerb = defineVerb({
    path: ["slot", "list"],
    summary:
        "list the machine-wide slots, all rows of the host store (machine.sqlite: the same file from every folder and CLI copy): each lane slot (npm, gate, shoot, stack) with lane, pid, child, age, command, holder alive (yes, no, unknown), state and whether it is reclaimable (free, held, old: a warning only; reclaimable: dead, reused, rebooted, gone), a foreign lock file of an older copy marked with its path, then every heavy-command slot (kind heavy: id, state, units, pid, child, age, command); a held slot says why it is not reclaimable",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/slot-list@2",
    flags: {
        kind: { kind: "string", summary: "only this kind (a lane kind of ops/slots.yaml, or heavy)", positional: true },
        events: { kind: "string", summary: "also print the newest N slot events (taken, released, reclaimed, killed, with who and the evidence)" },
        dir: { kind: "string", summary: "the lanes folder, where foreign slot lock files of older copies are honoured too (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots); the slots themselves are rows of machine.sqlite, the same from every folder" },
    },
    run: async (_context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        const store = machinePath()
        const laneKinds = flags.kind === undefined ? [] : flags.kind === "heavy" ? undefined : [flags.kind]
        const slots = laneKinds === undefined ? [] : listSlots(root, rules, laneKinds, await slotProbe(root, rules, laneKinds))
        const heavy = flags.kind === undefined || flags.kind === "heavy" ? [...heavySlots(), ...legacyHeavyRows()] : []
        const limit = positiveInt("events", flags.events)
        const events = limit === undefined ? [] : recentEvents(limit)
        const lines = [
            `store: ${store}`,
            ...slots.map(laneLine),
            ...(flags.kind === undefined || flags.kind === "heavy" ? (heavy.length === 0 ? ["heavy: none running or waiting"] : heavy.map(heavyLine)) : []),
            ...(events.length === 0 ? [] : ["events:", ...events.map((event) => `  ${event.at} ${event.action} ${event.slot} lane/label ${String(event.holder)} pid ${String(event.pid)}${event.childPid === null ? "" : ` child ${String(event.childPid)}`} by ${event.by}: ${event.evidence}`)]),
        ]
        return { data: { store, root, slots, heavy, events }, message: lines.join("\n") }
    },
})

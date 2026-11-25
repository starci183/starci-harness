import { Refusal } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { killHeavySlot } from "../../harness/heavy.js"
import type { HeavyKill } from "../../harness/heavy.js"
import { killSlot, loadSlotRules, slotKind, slotRoot, tableProbe } from "../../harness/slots.js"
import type { SlotKill } from "../../harness/slots.js"
import { positiveInt } from "./holder.js"

/**
 * `starci slot kill <kind> <n>` and `starci slot kill heavy <id>`: the last resort on a slot whose work must stop. It kills the process tree of the ONE
 * process the slot maps to (a lane slot: its holder; a heavy slot: the heavy command, else its holder) and frees the slot, logging what it killed in
 * slot_events. It refuses a free slot, a pid that now runs another program (SLOT_KILL_REUSED) and a holder it cannot prove (SLOT_KILL_UNPROVEN); a holder
 * already gone is not killed, its slot is reclaimed. Dry until --execute.
 */
export const slotKillVerb = defineVerb({
    path: ["slot", "kill"],
    summary:
        "the last resort on a slot: kill the process tree of the one process it maps to (a lane slot: its holder; heavy <id>: the heavy command, else its holder) and free the slot, logged in slot_events with what was killed; refuses a free slot, a pid now running another program (SLOT_KILL_REUSED) or a holder whose start cannot be matched (SLOT_KILL_UNPROVEN); a holder already gone is only reclaimed; dry until --execute",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/slot-kill@1",
    flags: {
        kind: { kind: "string", summary: "the slot kind (ops/slots.yaml kinds), or heavy", required: true, positional: true },
        slot: { kind: "string", summary: "the slot number of a lane kind, or the row id of a heavy slot (starci slot list)", required: true, positional: true },
        execute: { kind: "boolean", summary: "kill and free; without it, print what would be killed" },
        dir: { kind: "string", summary: "the lanes folder, where foreign slot lock files of older copies are honoured too (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
    },
    run: async (_context, flags): Promise<VerbResult<HeavyKill | SlotKill>> => {
        const by = `slot kill (pid ${String(process.pid)})`
        const probe = await tableProbe()
        if (flags.kind === "heavy") {
            const done = killHeavySlot(flags.slot, { execute: flags.execute, by, startOf: probe.startMs })
            const what = `heavy ${done.id} (${done.label}): pid ${String(done.pid)}${done.childPid === null ? "" : ` child ${String(done.childPid)}`}; ${done.evidence}`
            const message = done.reclaimedOnly ? `${what}: nothing alive to kill; the row is reclaimed` : done.killed ? `killed the process tree of pid ${String(done.target)} and freed ${what}` : `would kill the process tree of pid ${String(done.target)} of ${what}; pass --execute`
            return { data: done, message }
        }
        const rules = loadSlotRules()
        slotKind(rules, flags.kind)
        const n = positiveInt("slot", flags.slot)
        if (n === undefined) throw new Refusal("CLI_USAGE", "name the slot number: starci slot kill <kind> <n>")
        const done = killSlot(slotRoot(flags.dir, rules), rules, flags.kind, n, { execute: flags.execute, by, probe })
        const what = `${done.slot} (lane ${done.holder}): pid ${String(done.pid)}${done.childPid === null ? "" : ` child ${String(done.childPid)}`}${done.command === "" ? "" : ` command ${done.command}`}; ${done.evidence}`
        const message = done.reclaimedOnly ? `${what}: nothing alive to kill; the slot is reclaimed` : done.killed ? `killed the process tree of pid ${String(done.target)} and freed ${what}` : `would kill the process tree of pid ${String(done.target)} of ${what}; pass --execute`
        return { data: done, message }
    },
})

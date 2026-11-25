import { Refusal } from "../../shared/errors.js"
import { pidAlive } from "../../shared/exec.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { loadSlotRules, slotRoot, takeSlot } from "../../harness/slots.js"
import { laneHolder, positiveInt, waitSeconds } from "./holder.js"

/**
 * `starci slot take <kind>`: wait for a free slot of a kind (ops/slots.yaml) and hold it under the lane's name, reclaiming a holder
 * proven gone (its pid dead or reused, or taken before this boot). Idempotent for its lane. Prefer `slot run`, which holds the slot
 * exactly as long as the command; a `take` without `--pid` is refused (SLOT_PID_REQUIRED): a lock must record its holder's pid, start and the host boot.
 */
export const slotTakeVerb = defineVerb({
    path: ["slot", "take"],
    summary: "wait for a free machine-wide slot of a kind (npm, gate, shoot, stack; ops/slots.yaml) and hold it under the lane's name, reclaiming a holder proven gone (pid dead or reused, or taken before this boot; never by age); prefer slot run",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/slot-take@1",
    flags: {
        kind: { kind: "string", summary: "the slot kind (ops/slots.yaml kinds)", required: true, positional: true },
        lane: { kind: "string", summary: "the lane that holds it (default: STARCI_LANE, else the branch lane/<lane>)" },
        pid: { kind: "string", required: true, summary: "the process the slot lives as long as (a long-lived shell or agent); once it is gone the next take reclaims the slot" },
        wait: { kind: "string", summary: "seconds to wait for a free slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the lanes folder, where foreign slot lock files of older copies are honoured too (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots); the slots themselves are rows of machine.sqlite, the same from every folder" },
    },
    run: async (context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        const holder = await laneHolder(context.cwd, flags.lane)
        const pid = positiveInt("pid", flags.pid)
        if (pid === undefined) throw new Refusal("SLOT_PID_REQUIRED", "a slot lock records the pid of the process it lives as long as: pass --pid (in Git Bash $(cat /proc/$$/winpid)) or use slot run, which records its own")
        // A pid that is not running (an MSYS shell's $$ is not a Windows pid) would make the slot look dead at once.
        if (!pidAlive(pid)) throw new Refusal("SLOT_PID_NOT_ALIVE", `pid ${String(pid)} is not a running process of this host (in Git Bash pass $(cat /proc/$$/winpid), not $$)`)
        const taken = await takeSlot(root, rules, flags.kind, holder, { pid, waitSeconds: waitSeconds(flags.wait), reuse: true, say: context.progress })
        const note = taken.already ? " (already held)" : taken.reclaimed.length > 0 ? ` (reclaimed ${taken.reclaimed.join("; ")})` : ""
        return { data: { ...taken, root }, message: `${taken.kind} slot ${String(taken.n)} held by ${holder} (pid ${String(taken.pid)}): ${taken.where}${note}\nrelease: starci slot release ${taken.kind} --lane ${holder}` }
    },
})

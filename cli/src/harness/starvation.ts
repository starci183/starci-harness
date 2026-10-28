import { freemem } from "node:os"
import { dirname } from "node:path"
import { clockOf, endStarvation, gb, loadHeavyRules, markStarvationTicketed, starvation, starvationTicketed } from "./heavy.js"
import { memoryHolders } from "./host-holders.js"
import { locateOps } from "./ops.js"
import { openTicket } from "./tickets.js"

/** The error code a starvation ticket carries, so every repeat of one episode's ticket is the same fingerprint. */
export const HOST_STARVED = "HOST_STARVED"

const TOP_UNMANAGED = 8

/** The starvation round of `supervisor tick`: what it found and the ticket it opened, if any. */
export interface StarvationTick {
    /** Since when the harness's work has been held (the older of admission and seat launch), null when nothing is held. */
    readonly since: string | null
    readonly heldMinutes: number
    readonly ticket: string | null
    readonly line: string | null
}

const minutesSince = (at: string): number => Math.max(0, (Date.now() - Date.parse(at)) / 60_000)

/**
 * One round of the starvation watch (ops/liveness.yaml heavy.starvedTicketMinutes): when heavy admission or a seat launch has
 * been held without a break for longer than that, one `harness-defect` ticket is opened for Debug, naming how long each was held
 * and the top unmanaged holders of memory; it is never an owner question, and the governor's rules do not change for it. One
 * ticket per episode: the episode ends when nothing is held, and a hold after that is a new one.
 */
export const tickStarvation = async (): Promise<StarvationTick> => {
    const rules = loadHeavyRules()
    const held = starvation(rules)
    const since = [held.admissionSince, held.seatSince].filter((at): at is string => at !== null).sort((left, right) => left.localeCompare(right))[0] ?? null
    if (since === null) {
        endStarvation()
        return { since: null, heldMinutes: 0, ticket: null, line: null }
    }
    const heldMinutes = Math.floor(minutesSince(since))
    const already = starvationTicketed()
    if (minutesSince(since) <= rules.starvedTicketMinutes || already !== null) return { since, heldMinutes, ticket: already, line: null }
    const holders = await memoryHolders(40)
    const unmanaged = holders.top.filter((item) => !item.managed).slice(0, TOP_UNMANAGED)
    const freeMb = Math.floor(freemem() / 1_048_576)
    const parts = [
        ...(held.admissionSince === null ? [] : [`heavy admission held ${String(Math.floor(minutesSince(held.admissionSince)))} min (${String(held.waiting)} waiting, since ${clockOf(held.admissionSince)})`]),
        ...(held.seatSince === null ? [] : [`seat launches held ${String(Math.floor(minutesSince(held.seatSince)))} min (${String(held.seatHeld)} task(s), since ${clockOf(held.seatSince)})`]),
    ]
    const holderLines =
        holders.unreadable === null
            ? [
                  `unmanaged ${gb(holders.unmanagedMb)} of ${String(holders.processes)} processes${holders.unmanagedGroups === "" ? "" : ` (${holders.unmanagedGroups})`}, managed ${gb(holders.managedMb)}`,
                  "top unmanaged holders:",
                  ...unmanaged.map((item) => `  ${String(item.pid)} ${item.name} ${String(item.workingSetMb)} MB [${item.group}] ${item.command}`),
              ]
            : [`who holds memory is unknown: ${holders.unreadable}`]
    const tail = [`${HOST_STARVED}: ${parts.join("; ")}; free RAM ${gb(freeMb)}, reserve ${gb(rules.reserveMb)}, seat floor ${gb(rules.seatFreeMb)}`, ...holderLines].join("\n")
    const harnessRoot = dirname(locateOps())
    const { ticket } = openTicket({
        kind: "harness-defect",
        severity: "normal",
        title: `host starved the harness for ${String(heldMinutes)} min: ${parts.join("; ")}`,
        evidence: { tail },
        tried: `the governor kept its rules (ops/liveness.yaml heavy): it admitted only what fits and held seat launches; this ticket opens once a hold passes starvedTicketMinutes (${String(rules.starvedTicketMinutes)})`,
        proposedDefault: null,
        options: [],
        project: { root: harnessRoot, key: "harness", name: "starci-harness" },
        workflow: null,
        by: "supervisor-tick",
        code: HOST_STARVED,
        module: "cli/src/harness/heavy.ts",
        waiters: [],
    })
    markStarvationTicketed(since, ticket.id)
    return { since, heldMinutes, ticket: ticket.id, line: `host starved for ${String(heldMinutes)} min: harness-defect ticket ${ticket.id} names the top unmanaged holders` }
}

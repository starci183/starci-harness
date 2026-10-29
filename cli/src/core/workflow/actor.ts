import type { DatabaseSync } from "node:sqlite"
import { liveSupervisors } from "../../harness/supervisor.js"
import { callerRole } from "../../shared/role.js"

/** The actors whose pause only their own side lifts: a coordinator never resumes what they held. */
export const HOLDING_ACTORS: readonly string[] = ["owner", "debug"]

/** The coordinator seats, which may not lift a pause a holding actor set. */
export const COORDINATORS: readonly string[] = ["supervisor", "kernel"]

/**
 * Who calls a workflow verb: STARCI_ROLE when set, else the coordinator whose Orca terminal this process runs in (a live
 * Supervisor's, or a Kernel terminal or seat of this ledger), else the owner (a shell, the desktop app, a Debug session).
 */
export const actorOf = (db: DatabaseSync): string => {
    const role = callerRole()
    if (role !== undefined) return role
    const terminal = process.env.ORCA_TERMINAL_HANDLE
    if (terminal === undefined || terminal === "") return "owner"
    if (liveSupervisors().some((seat) => seat.terminal === terminal)) return "supervisor"
    const kernel = db.prepare("SELECT 1 FROM workflows WHERE kernel_terminal = ? UNION SELECT 1 FROM seats WHERE role = 'kernel' AND terminal = ?").get(terminal, terminal)
    return kernel === undefined ? "owner" : "kernel"
}

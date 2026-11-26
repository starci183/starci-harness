import { Refusal } from "../shared/errors.js"
import { readMachines } from "./machines.js"
import type { MachinesRead } from "./machines.js"

/** The settings of this host as a machine, as read now. */
export interface HostSettings {
    /** config.yaml `host.diskFloorMb`, when the host sets one. */
    readonly diskFloorMb?: number
    /** config.yaml `host.diskWarnMb`, when the host sets one. */
    readonly diskWarnMb?: number
    /** config.yaml `heavy.gbPerSlot`, when the host sets one: the GB of physical RAM one heavy-command slot stands for (harness/heavy.ts hostSlots). */
    readonly gbPerSlot?: number
    /** Where they were read: config.yaml, or why none was found. */
    readonly source: string
}

/**
 * The `host` and `heavy` blocks of this machine's config.yaml (harness/machines.ts), read fresh at every call and never cached, so a value the owner changes reaches a
 * command that is already waiting. A host whose config.yaml cannot be found (no harness home above the working folder, a CI runner) reads as every
 * default, saying so in `source`; a damaged config.yaml is refused (MACHINES_INVALID) as every machines verb refuses it.
 */
export const readHostSettings = (read: () => MachinesRead = () => readMachines()): HostSettings => {
    let found: MachinesRead
    try {
        found = read()
    } catch (error) {
        if (error instanceof Refusal && error.code === "HOST_STATE_NOT_FOUND") return { source: `no config.yaml (${error.message})` }
        throw error
    }
    const floor = found.doc.host?.diskFloorMb
    const warn = found.doc.host?.diskWarnMb
    const gbPerSlot = found.doc.heavy?.gbPerSlot
    return { ...(floor === undefined ? {} : { diskFloorMb: floor }), ...(warn === undefined ? {} : { diskWarnMb: warn }), ...(gbPerSlot === undefined ? {} : { gbPerSlot }), source: found.file }
}

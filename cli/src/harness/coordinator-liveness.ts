import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { locateOps } from "./ops.js"

const coordinatorsSchema = z.strictObject({
    seatLeaseMinutes: z.number().positive(),
    kernelTtlMinutes: z.number().positive(),
    supervisorTtlMinutes: z.number().positive(),
    kernelRelaunchMax: z.number().int().positive(),
    kernelRelaunchWindowMinutes: z.number().positive(),
    effectUnknownDeadlineMinutes: z.number().positive(),
    conflictMinutes: z.number().nonnegative(),
    nextWaitSeconds: z.number().int().positive(),
    nextPollSeconds: z.number().int().positive(),
})

/** The `coordinators` block of ops/liveness.yaml: the values the episodic drivers apply. */
export type CoordinatorLiveness = z.infer<typeof coordinatorsSchema>

const loaded = new Map<string, CoordinatorLiveness>()

/** Loads and validates the `coordinators` block of ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadCoordinatorLiveness = (dir: string = locateOps()): CoordinatorLiveness => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ coordinators: coordinatorsSchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} coordinators block is invalid: ${z.prettifyError(parsed.error)}`)
    loaded.set(dir, parsed.data.coordinators)
    return parsed.data.coordinators
}

/** The ISO time `minutes` from now: a lease's end. */
export const leaseEnd = (minutes: number, at: number = Date.now()): string => new Date(at + minutes * 60_000).toISOString()

/** True when an ISO time is older than `minutes` before `at`; a missing time counts as old. */
export const olderThan = (iso: string | null, minutes: number, at: number = Date.now()): boolean => iso === null || at - new Date(iso).getTime() > minutes * 60_000

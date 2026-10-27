import type { Refusal } from "./errors.js"
import type { VerbResult } from "./verb.js"

/** How a run reports: one json envelope for agents, one human line otherwise. */
export type OutputMode = "json" | "human"

/** The json envelope of a successful run. */
export interface SuccessEnvelope<T> {
    readonly schema: string
    readonly ok: true
    readonly data: T
}

/** The json envelope of a refused run. */
export interface RefusalEnvelope {
    readonly schema: "starci/refusal@1"
    readonly ok: false
    readonly code: string
    readonly message: string
}

const writeLine = (text: string): void => {
    process.stdout.write(`${text}\n`)
}

/** Prints a successful result in the selected mode; an empty human message prints nothing (a verb whose output already streamed). */
export const printResult = <T>(mode: OutputMode, schema: string, result: VerbResult<T>): void => {
    if (mode === "json") {
        const envelope: SuccessEnvelope<T> = { schema, ok: true, data: result.data }
        writeLine(JSON.stringify(envelope, null, 2))
        return
    }
    if (result.message !== "") writeLine(result.message)
}

/** Prints a refusal in the selected mode; human output goes to stderr so pipes stay clean. */
export const printRefusal = (mode: OutputMode, refusal: Refusal): void => {
    if (mode === "json") {
        const envelope: RefusalEnvelope = { schema: "starci/refusal@1", ok: false, code: refusal.code, message: refusal.message }
        writeLine(JSON.stringify(envelope, null, 2))
        return
    }
    process.stderr.write(`${refusal.code}: ${refusal.message}\n`)
}

/** Renders rows as an aligned plain-text table for human output. */
export const formatTable = (rows: readonly (readonly string[])[]): string => {
    const widths: number[] = []
    for (const row of rows) {
        row.forEach((cell, index) => {
            widths[index] = Math.max(widths[index] ?? 0, cell.length)
        })
    }
    return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd()).join("\n")
}

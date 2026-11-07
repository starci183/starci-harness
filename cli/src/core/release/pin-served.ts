import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { STACK_PINS } from "../check/cli-pins.js"

const pinsSchema = z.looseObject({ pins: z.record(z.string(), z.looseObject({ version: z.string().min(1) })) })

/** One plan row, as far as the pin judgement reads it. */
interface PinnedRow {
    readonly package: string
    readonly version: string
    readonly action: string
}

/** The exact version each package of the stack pins names, empty when the pins file is absent or does not parse. */
export const stackPinVersions = (root: string): Readonly<Record<string, string>> => {
    const file = join(root, STACK_PINS)
    if (!existsSync(file)) return {}
    const parsed = pinsSchema.safeParse(parse(readFileSync(file, "utf8")))
    return parsed.success ? Object.fromEntries(Object.entries(parsed.data.pins).map(([name, pin]) => [name, pin.version])) : {}
}

/**
 * The pins that name a version no app can install: a workspace package pinned at a version that is neither the version the plan
 * publishes (the package's folder at this commit, not served by npm) nor one npm serves. Apps install the pinned set from npm, so
 * such a pin fails every install with E404.
 */
export const unservedPins = async (
    rows: readonly PinnedRow[],
    pins: Readonly<Record<string, string>>,
    served: (name: string, version: string) => Promise<boolean>,
): Promise<string[]> => {
    const lines = await Promise.all(
        rows.map(async (row): Promise<string | undefined> => {
            const pinned = pins[row.package]
            if (pinned === undefined || row.action === "private") return undefined
            if (pinned === row.version && row.action === "publish") return undefined
            return (await served(row.package, pinned)) ? undefined : `${row.package}@${pinned}`
        }),
    )
    return lines.filter((line): line is string => line !== undefined)
}

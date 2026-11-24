import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { locateOps } from "../../harness/ops.js"

export const HOTFIX_SCHEMA = "starci/hotfix@1"

const hotfixSchema = z.strictObject({
    schema: z.literal(HOTFIX_SCHEMA),
    maxFiles: z.number().int().positive(),
    maxLines: z.number().int().positive(),
    healthWaitSeconds: z.number().int().positive(),
})

/** The limits of a hotfix (ops/hotfix.yaml). */
export type HotfixRules = z.infer<typeof hotfixSchema>

/** Loads and validates ops/hotfix.yaml from the ops folder (STARCI_OPS_DIR honoured). */
export const loadHotfixRules = (dir: string = locateOps()): HotfixRules => {
    const file = join(dir, "hotfix.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = hotfixSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

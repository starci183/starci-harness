import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"

// A list of names may be written as one name: `contract new --check result-json:keys=summary` gives a string, not a list.
const namesSchema = z.union([z.string().min(1).transform((name) => [name]), z.array(z.string())])

/** A primitive check: the only kinds `task verify` knows how to run. */
export const primitiveCheckSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("starci"), args: z.array(z.string()).min(1) }),
    z.object({ kind: z.literal("command"), run: z.union([z.string().min(1), z.array(z.string()).min(1)]) }),
    z.object({ kind: z.literal("files"), onlyAllowPaths: z.boolean().optional(), mustExist: namesSchema.optional() }),
    z.object({ kind: z.literal("json"), file: z.string().min(1), requiredKeys: namesSchema }),
    z.object({ kind: z.literal("probe"), url: z.url(), status: z.coerce.number().int() }),
])

/** One primitive check after preset expansion. */
export type PrimitiveCheck = z.infer<typeof primitiveCheckSchema>

const presetSchema = z.object({
    summary: z.string(),
    behavioural: z.boolean(),
    args: z.array(z.string()).optional(),
    check: z.record(z.string(), z.unknown()),
})

const presetsFileSchema = z.object({ schema: z.literal("starci/check-presets@1"), presets: z.record(z.string(), presetSchema) })

const labelSchema = z.object({
    summary: z.string(),
    floor: z.enum(["easy", "medium", "hard", "insane"]),
    hostTools: z.array(z.string()),
    defaultChecks: z.array(z.string()),
    requireBehavioural: z.boolean(),
})

const labelsFileSchema = z.object({ schema: z.literal("starci/labels@1"), labels: z.record(z.string(), labelSchema) })

/** A named check preset from ops/checks.yaml. */
export type CheckPreset = z.infer<typeof presetSchema>

/** A worker label from ops/labels.yaml. */
export type Label = z.infer<typeof labelSchema>

/** The ops/ data the harness reads: labels and check presets, validated once. */
export interface Ops {
    readonly dir: string
    readonly labels: Readonly<Record<string, Label>>
    readonly presets: Readonly<Record<string, CheckPreset>>
}

/** The ops/ folder: STARCI_OPS_DIR, else ops/ beside the CLI package (published copy), else the repository's ops/ above it. */
export const locateOps = (): string => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
    const candidates = [process.env.STARCI_OPS_DIR, join(packageRoot, "ops"), join(packageRoot, "..", "ops")].filter((path): path is string => path !== undefined)
    const found = candidates.find((path) => existsSync(join(path, "labels.yaml")))
    if (found === undefined) throw new Refusal("OPS_NOT_FOUND", `no ops/ folder with labels.yaml (looked in ${candidates.join(", ")})`)
    return found
}

const readYaml = <T>(file: string, schema: z.ZodType<T>): T => {
    const parsed = schema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** Loads and validates ops/labels.yaml and ops/checks.yaml; every preset a label names must exist. */
export const loadOps = (dir: string = locateOps()): Ops => {
    const labels = readYaml(join(dir, "labels.yaml"), labelsFileSchema).labels
    const presets = readYaml(join(dir, "checks.yaml"), presetsFileSchema).presets
    for (const [name, label] of Object.entries(labels)) {
        const unknown = label.defaultChecks.filter((preset) => !(preset in presets))
        if (unknown.length > 0) throw new Refusal("OPS_INVALID", `label ${name} names unknown presets: ${unknown.join(", ")}`)
    }
    return { dir, labels, presets }
}

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"

// A list of names may be written as one name: `contract new --check result-json:keys=summary` gives a string, not a list.
const namesSchema = z.union([z.string().min(1).transform((name) => [name]), z.array(z.string())])

/** The value types an output key may declare; `string[]` is an array of strings. */
export const outputTypeSchema = z.enum(["string", "number", "boolean", "object", "array", "string[]"])

/** The type of one output key. */
export type OutputType = z.infer<typeof outputTypeSchema>

/** A primitive check: the only kinds `task verify` knows how to run. */
export const primitiveCheckSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("starci"), args: z.array(z.string()).min(1) }),
    z.object({ kind: z.literal("command"), run: z.union([z.string().min(1), z.array(z.string()).min(1)]) }),
    z.object({ kind: z.literal("files"), onlyAllowPaths: z.boolean().optional(), mustExist: namesSchema.optional() }),
    // `expect` pins values a key must hold, so a report that names its own failure can never pass by carrying the key.
    z.object({
        kind: z.literal("json"),
        file: z.string().min(1),
        requiredKeys: namesSchema,
        types: z.record(z.string(), outputTypeSchema).optional(),
        expect: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
    z.object({ kind: z.literal("probe"), url: z.url(), status: z.coerce.number().int() }),
    // A uat walk: the worker's filed result judged against a Work record and the files of its run folder (harness/work.ts).
    z.object({ kind: z.literal("uat-flow"), record: z.string().min(1), run: z.string().min(1) }),
    // The read trace: each id the result cites under `key` must be named by one of `files` (resolved by resolveChecks).
    z.object({
        kind: z.literal("cited"),
        trace: z.array(z.strictObject({ key: z.string().min(1), minItems: z.number().int().min(0), files: z.array(z.string().min(1)) })).optional(),
    }),
])

/** One primitive check after preset expansion. */
export type PrimitiveCheck = z.infer<typeof primitiveCheckSchema>

const argValueSchema = z.union([z.string(), z.number(), z.array(z.string())])

/** One check entry of an op or a contract: a named preset with its arguments (a bare name is the short form), or a primitive check written out. */
export const checkEntrySchema = z.union([
    z.string().min(1).transform((preset) => ({ preset })),
    z.strictObject({ preset: z.string().min(1), args: z.record(z.string(), argValueSchema).optional() }),
    z.strictObject({ check: primitiveCheckSchema }),
])

/** One check entry after parsing. */
export type CheckEntry = z.output<typeof checkEntrySchema>

/** The arguments of a preset entry. */
export type CheckArgs = Readonly<Record<string, z.infer<typeof argValueSchema>>>

/**
 * What one output key must hold. `minItems` bounds an array; `when: work` asks for the key only of a work-driven task (its
 * context names a file under `.starciwork`); `cites` makes it a read trace whose ids the `cited` check finds in the context
 * files (`context`: any of them, `work`: the Work files). A bare type is the short form.
 */
export const outputSpecSchema = z.union([
    outputTypeSchema.transform((type) => ({ type })),
    z.strictObject({
        type: outputTypeSchema,
        summary: z.string().min(1).optional(),
        minItems: z.number().int().min(0).optional(),
        when: z.literal("work").optional(),
        cites: z.enum(["context", "work"]).optional(),
    }),
])

/** One output key's requirement. */
export type OutputSpec = z.output<typeof outputSpecSchema>

/** An output key, an input name: what a result key or a named input may be called. */
export const keyNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "a key is letters, digits and '_', starting with a letter")

const presetSchema = z.object({
    summary: z.string(),
    behavioural: z.boolean(),
    args: z.array(z.string()).optional(),
    check: z.record(z.string(), z.unknown()),
})

const presetsFileSchema = z.object({ schema: z.literal("starci/check-presets@1"), presets: z.record(z.string(), presetSchema) })

/** The inputs every contract carries itself; an op never declares them. */
export const CONTRACT_INPUTS = ["summary", "details"] as const

/** The frontmatter of an op file (`ops/ops/<label>.md`): the base of each part of a contract of that label. */
const opFrontmatterSchema = z.strictObject({
    schema: z.literal("starci/op@1"),
    summary: z.string().min(1),
    floor: z.enum(["easy", "medium", "hard", "insane"]),
    hostTools: z.array(z.string().min(1)),
    // `harness:<path>` is a file of the harness checkout, anything else a repository path; `{name}` is an input or `label`.
    context: z.strictObject({ base: z.array(z.string().min(1)) }),
    input: z.strictObject({ base: z.record(keyNameSchema, z.string().min(1)) }),
    // behavioural: the generated output check proves behaviour (the output is a suite or flow report), not only its shape.
    output: z.strictObject({ base: z.record(keyNameSchema, outputSpecSchema), behavioural: z.boolean() }),
    // behavioural: a contract of this label needs at least one behavioural check, so green never means only "it compiles".
    checks: z.strictObject({ base: z.array(checkEntrySchema), behavioural: z.boolean() }),
})

/** A named check preset from ops/checks.yaml. */
export type CheckPreset = z.infer<typeof presetSchema>

/** One op: the label's file `ops/ops/<label>.md`, its frontmatter validated and its body (the label's own procedure). */
export interface Op extends z.output<typeof opFrontmatterSchema> {
    readonly label: string
    readonly file: string
    readonly procedure: string
}

/** The ops/ data the harness reads: one op per label and the check presets, validated once. */
export interface Ops {
    readonly dir: string
    /** The harness checkout `harness:` context entries resolve against: the folder holding ops/. */
    readonly root: string
    readonly labels: Readonly<Record<string, Op>>
    readonly presets: Readonly<Record<string, CheckPreset>>
}

/** The folder of the op files under ops/. */
export const OP_FILES = "ops"

/** The op pattern's README beside the op files; its section WORKER_PROCEDURE is the procedure common to every op. */
export const OPS_README = "README.md"

/** The heading of the README section every brief starts with. */
export const WORKER_PROCEDURE = "## The worker procedure"

/** The preset that verifies the read trace; an op whose output cites must carry it, and only such an op. */
export const CITED_PRESET = "rules-cited"

/** The ops/ folder: STARCI_OPS_DIR, else ops/ beside the CLI package (published copy), else the repository's ops/ above it. */
export const locateOps = (): string => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
    const candidates = [process.env.STARCI_OPS_DIR, join(packageRoot, "ops"), join(packageRoot, "..", "ops")].filter((path): path is string => path !== undefined)
    const found = candidates.find((path) => existsSync(join(path, "checks.yaml")) && existsSync(join(path, OP_FILES, OPS_README)))
    if (found === undefined) throw new Refusal("OPS_NOT_FOUND", `no ops/ folder with checks.yaml and ${OP_FILES}/${OPS_README} (looked in ${candidates.join(", ")})`)
    return found
}

const invalid = (file: string, message: string): Refusal => new Refusal("OPS_INVALID", `${file} is invalid: ${message}`)

const readYaml = <T>(file: string, schema: z.ZodType<T>): T => {
    const parsed = schema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw invalid(file, z.prettifyError(parsed.error))
    return parsed.data
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

/** The placeholders `{name}` a text names. */
export const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((found) => found[1] ?? "")

/** The section of the README that opens every brief, without its heading. */
export const workerProcedure = (ops: Ops): string => {
    const file = join(ops.dir, OP_FILES, OPS_README)
    const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")
    const start = lines.findIndex((line) => line.trim() === WORKER_PROCEDURE)
    if (start < 0) throw invalid(file, `it has no "${WORKER_PROCEDURE}" section`)
    const end = lines.findIndex((line, index) => index > start && line.startsWith("## "))
    return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()
}

const readOp = (file: string, presets: Readonly<Record<string, CheckPreset>>): Op => {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    const match = FRONTMATTER.exec(text)
    if (match === null) throw invalid(file, "it has no yaml frontmatter between --- lines")
    const parsed = opFrontmatterSchema.safeParse(parse(match[1] ?? ""))
    if (!parsed.success) throw invalid(file, z.prettifyError(parsed.error))
    const op = parsed.data
    const label = basename(file, ".md")
    const reserved = Object.keys(op.input.base).filter((name) => (CONTRACT_INPUTS as readonly string[]).includes(name))
    if (reserved.length > 0) throw invalid(file, `input.base names ${reserved.join(", ")}, which every contract carries itself`)
    const known = new Set(["label", ...Object.keys(op.input.base)])
    const unknown = op.context.base.flatMap(placeholdersOf).filter((name) => !known.has(name))
    if (unknown.length > 0) throw invalid(file, `context.base names placeholders no input declares: ${[...new Set(unknown)].join(", ")}`)
    const named = op.checks.base.map((entry) => ("preset" in entry ? entry.preset : undefined)).filter((name): name is string => name !== undefined)
    const missing = named.filter((preset) => !(preset in presets))
    if (missing.length > 0) throw invalid(file, `checks.base names unknown presets: ${missing.join(", ")}`)
    const cites = Object.values(op.output.base).some((spec) => "cites" in spec && spec.cites !== undefined)
    if (cites !== named.includes(CITED_PRESET)) {
        throw invalid(file, cites ? `output.base cites rules, so checks.base must carry ${CITED_PRESET}` : `checks.base carries ${CITED_PRESET} but no output.base key cites`)
    }
    const procedure = (match[2] ?? "").trim()
    if (procedure === "") throw invalid(file, "its body (the label's procedure) is empty")
    return { ...op, label, file, procedure }
}

/** Loads and validates ops/checks.yaml and every op file of ops/ops/; every preset an op names must exist. */
export const loadOps = (dir: string = locateOps()): Ops => {
    const presets = readYaml(join(dir, "checks.yaml"), presetsFileSchema).presets
    const opsDir = join(dir, OP_FILES)
    const files = readdirSync(opsDir).filter((name) => name.endsWith(".md") && name !== OPS_README).sort()
    const labels: Record<string, Op> = {}
    for (const name of files) {
        const op = readOp(join(opsDir, name), presets)
        labels[op.label] = op
    }
    if (files.length === 0) throw new Refusal("OPS_INVALID", `${opsDir} holds no op file`)
    const ops: Ops = { dir, root: dirname(dir), labels, presets }
    workerProcedure(ops)
    return ops
}

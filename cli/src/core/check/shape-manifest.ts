import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"

/** Where the harness repository declares its own shape, relative to its root. */
export const SHAPE_MANIFEST = "contexts/hfs/harness.yaml"

/** What a slot says of its paths: one must exist, they may exist, or none may. */
export const SHAPE_PRESENCE = ["required", "optional", "forbidden"] as const

/** How a rule of a slot is held: `gate` is red today; `target` is red outside its dated exceptions. */
export const SHAPE_ENFORCEMENT = ["gate", "target"] as const

const pattern = z.string().min(1).refine((text) => !text.startsWith("/") && !text.split("/").includes(".."), "a pattern is relative to the repository root")
const patterns = z.union([pattern.transform((text) => [text]), z.array(pattern).min(1)])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date is YYYY-MM-DD")

// An exception names one literal file or one folder (ending in /): a glob would widen the target past what was reviewed.
const exceptionSchema = z.strictObject({
    path: z.string().min(1).refine((path) => !/[*?[\]{}<>!]/.test(path) && !path.startsWith("/") && !path.split("/").includes(".."), "an exception names one literal file or folder"),
    until: isoDate,
    owner: z.string().trim().min(1),
    why: z.string().trim().min(10, "an exception carries its reason"),
})

/** One dated exception of a target slot: what it covers, until when, who removes it and why it exists. */
export type ShapeException = z.infer<typeof exceptionSchema>

const slotSchema = z
    .strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/, "an id is dot-separated: <area>.<name>"),
        path: patterns,
        except: z.array(pattern).optional(),
        presence: z.enum(SHAPE_PRESENCE),
        per: pattern.refine((text) => text.endsWith("/"), "per names a folder pattern (ending in /)").optional(),
        exempt: z.array(z.strictObject({ path: z.string().min(1).endsWith("/"), why: z.string().trim().min(10) })).optional(),
        requires: z.array(pattern).min(1).optional(),
        jsonKey: z.string().min(1).optional(),
        generated: z.strictObject({ from: z.array(z.string().min(1)).min(1), how: z.string().trim().min(10) }).optional(),
        enforce: z.enum(SHAPE_ENFORCEMENT).default("gate"),
        exceptions: z.array(exceptionSchema).optional(),
        holds: z.string().trim().min(10),
        rule: z.string().trim().min(3),
    })
    .superRefine((slot, issues) => {
        const problem = (message: string): void => {
            issues.addIssue({ code: "custom", message: `${slot.id}: ${message}` })
        }
        if (slot.presence !== "required" && (slot.requires !== undefined || slot.per !== undefined)) problem("only a required slot names per or requires")
        if (slot.exempt !== undefined && slot.per === undefined) problem("exempt names instances, so it needs per")
        if (slot.jsonKey !== undefined && slot.presence !== "forbidden") problem("jsonKey narrows a forbidden slot only")
        if (slot.enforce === "target" && (slot.exceptions ?? []).length === 0) problem("a target slot lists its dated exceptions")
        if (slot.enforce === "gate" && slot.exceptions !== undefined) problem("a gate slot has no exceptions; mark it target with dated exceptions")
        if (slot.enforce === "target" && slot.presence === "optional") problem("an optional slot judges nothing, so it cannot be a target")
    })

/** One slot of the harness shape. */
export type ShapeSlot = z.infer<typeof slotSchema>

const manifestSchema = z.strictObject({
    schema: z.literal("starci/harness-slots@1"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    kind: z.literal("runtime"),
    presenceValues: z.array(z.enum(SHAPE_PRESENCE)),
    enforceValues: z.array(z.enum(SHAPE_ENFORCEMENT)),
    slots: z.array(slotSchema).min(1),
})

/** The harness shape manifest as the gate reads it. */
export type ShapeManifest = z.infer<typeof manifestSchema>

/** Reads and validates `contexts/hfs/harness.yaml` of `root`; refuses a tree without one or with an invalid one. */
export const loadShapeManifest = (root: string): ShapeManifest => {
    const file = join(root, SHAPE_MANIFEST)
    if (!existsSync(file)) {
        throw new Refusal("SHAPE_MANIFEST_MISSING", `${SHAPE_MANIFEST} is missing: check shape judges the harness repository's own shape (an app's shape is contexts/hfs/slots.yaml, judged by starci app check)`)
    }
    const parsed = manifestSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("SHAPE_MANIFEST_INVALID", `${SHAPE_MANIFEST} is invalid: ${z.prettifyError(parsed.error)}`)
    const seen = new Set<string>()
    for (const slot of parsed.data.slots) {
        if (seen.has(slot.id)) throw new Refusal("SHAPE_MANIFEST_INVALID", `${SHAPE_MANIFEST} is invalid: slot ${slot.id} is declared twice`)
        seen.add(slot.id)
    }
    return parsed.data
}

/** A compiled path pattern: its expression and the `<name>` segments it binds, in order. */
export interface CompiledPattern {
    readonly source: string
    readonly regex: RegExp
    readonly names: readonly string[]
}

const escapeLiteral = (text: string): string => text.replace(/[.+^$()|[\]\\]/g, String.raw`\$&`)

// Splits `{a,b}` at its top-level commas, so `{x,{y,z}}` keeps its inner group.
const alternatives = (body: string): string[] => {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index]
        if (char === "{") depth += 1
        else if (char === "}") depth -= 1
        else if (char === "," && depth === 0) {
            parts.push(body.slice(start, index))
            start = index + 1
        }
    }
    parts.push(body.slice(start))
    return parts
}

const closingBrace = (text: string, open: number): number => {
    let depth = 0
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === "{") depth += 1
        else if (text[index] === "}") {
            depth -= 1
            if (depth === 0) return index
        }
    }
    throw new Refusal("SHAPE_MANIFEST_INVALID", `${SHAPE_MANIFEST}: the pattern ${text} opens a { it never closes`)
}

// The expression of one pattern body: `**/` any folders (or none), `**` anything, `*` and `?` inside one segment, `{a,b}`
// alternatives, `<name>` one bound segment (a second `<name>` of the same pattern must repeat the first one's value).
const expression = (text: string, names: string[], bindings: Readonly<Record<string, string>>): string => {
    let out = ""
    let index = 0
    while (index < text.length) {
        const rest = text.slice(index)
        if (rest.startsWith("**/")) {
            out += "(?:.*/)?"
            index += 3
        } else if (rest.startsWith("**")) {
            out += ".*"
            index += 2
        } else if (rest.startsWith("*")) {
            out += "[^/]*"
            index += 1
        } else if (rest.startsWith("?")) {
            out += "[^/]"
            index += 1
        } else if (rest.startsWith("{")) {
            const close = closingBrace(text, index)
            out += `(?:${alternatives(text.slice(index + 1, close)).map((part) => expression(part, names, bindings)).join("|")})`
            index = close + 1
        } else if (/^<[a-z][a-z0-9]*>/.test(rest)) {
            const close = rest.indexOf(">")
            const name = rest.slice(1, close)
            const bound = bindings[name]
            if (bound !== undefined) out += escapeLiteral(bound)
            else if (names.includes(name)) out += String.raw`\k<${name}>`
            else {
                names.push(name)
                out += `(?<${name}>[^/]+)`
            }
            index += close + 1
        } else {
            out += escapeLiteral(rest.charAt(0))
            index += 1
        }
    }
    return out
}

/**
 * Compiles one manifest pattern to an anchored expression over a repository path (forward slashes). A trailing `/` owns the
 * whole folder; `bindings` fixes `<name>` segments to literal values (one instance of a per slot).
 */
export const compilePattern = (source: string, bindings: Readonly<Record<string, string>> = {}): CompiledPattern => {
    const names: string[] = []
    const folder = source.endsWith("/")
    const body = expression(folder ? source.slice(0, -1) : source, names, bindings)
    return { source, regex: new RegExp(`^${body}${folder ? "/.+" : ""}$`), names }
}

/** Compiles a folder pattern (`packages/<name>/`) to an expression over the start of a path: its match is the instance folder. */
export const compileFolderPrefix = (source: string): CompiledPattern => {
    const names: string[] = []
    const body = expression(source.endsWith("/") ? source.slice(0, -1) : source, names, {})
    return { source, regex: new RegExp(`^${body}/`), names }
}

/** Whether `file` lies under one exception's path: the file itself, or a file of the folder it names. */
export const exceptionCovers = (exception: ShapeException, file: string): boolean => (exception.path.endsWith("/") ? file.startsWith(exception.path) : file === exception.path)

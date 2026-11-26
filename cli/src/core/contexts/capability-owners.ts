import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"

/**
 * One capability, one owner (contexts/project/lint.md PROJECT-LINT-7): the registry contexts/harness/capabilities.yaml names each capability of
 * the harness, the module that owns it and the text that marks an implementation of it. A file outside the owners that holds a mark
 * reimplements the capability instead of calling its owner; a `known` entry is a reimplementation still to be folded into its owner, and the
 * list only shrinks.
 */
export const CAPABILITIES_FILE = join("harness", "capabilities.yaml")

const registrySchema = z.object({
    schema: z.literal("starci/capabilities@1"),
    capabilities: z.array(
        z.object({
            id: z.string(),
            summary: z.string(),
            scope: z.array(z.string()).min(1),
            marks: z.array(z.string()).min(1),
            owners: z.array(z.string()),
            known: z.record(z.string(), z.string()).optional(),
        }),
    ),
})

/** One finding of the registry: a reimplementation outside the owners, or a `known` entry that no longer holds the mark. */
export interface CapabilityGap {
    readonly kind: "capability-reimplemented" | "capability-known-stale"
    readonly subject: string
    readonly detail: string
}

const SKIPPED_FOLDER = new Set(["node_modules", "dist", ".git", ".next", ".turbo", "coverage"])
const SKIPPED_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|\.(?:png|jpe?g|gif|webp|ico|woff2?|tgz|lock)$/

/** Every file under `folder` (a file or a folder relative to `root`), as posix paths relative to `root`, specs and build output aside. */
const filesUnder = (root: string, folder: string): string[] => {
    const start = join(root, folder)
    if (!existsSync(start)) return []
    const out: string[] = []
    const walk = (path: string): void => {
        if (statSync(path).isDirectory()) {
            for (const entry of readdirSync(path)) if (!SKIPPED_FOLDER.has(entry)) walk(join(path, entry))
            return
        }
        const file = relative(root, path).split("\\").join("/")
        if (!SKIPPED_FILE.test(file)) out.push(file)
    }
    walk(start)
    return out
}

/** The capability gaps of the harness checkout at `root` against the registry `registryFile`; none when the registry is absent. */
export const capabilityGaps = (root: string, registryFile: string): CapabilityGap[] => {
    if (!existsSync(registryFile)) return []
    const parsed = registrySchema.safeParse(parse(readFileSync(registryFile, "utf8")))
    if (!parsed.success) throw new Refusal("KNOWLEDGE_INVALID", `${registryFile} is invalid: ${z.prettifyError(parsed.error)}`)
    const gaps: CapabilityGap[] = []
    for (const capability of parsed.data.capabilities) {
        const marks = capability.marks.map((mark) => new RegExp(mark))
        const holding = new Set(
            capability.scope.flatMap((folder) => filesUnder(root, folder)).filter((file) => {
                const text = readFileSync(join(root, file), "utf8")
                return marks.some((mark) => mark.test(text))
            }),
        )
        const known = capability.known ?? {}
        for (const file of [...holding].sort()) {
            if (capability.owners.includes(file) || file in known) continue
            const owner = capability.owners.length > 0 ? `call its owner (${capability.owners.join(", ")})` : "run it through its owner verb"
            gaps.push({ kind: "capability-reimplemented", subject: file, detail: `${file} implements ${capability.id} (${capability.summary}) itself: ${owner} instead (contexts/harness/capabilities.yaml)` })
        }
        for (const file of Object.keys(known).sort()) {
            if (!holding.has(file)) gaps.push({ kind: "capability-known-stale", subject: file, detail: `${file} is listed as a known reimplementation of ${capability.id} and no longer holds its mark: delete the entry from contexts/harness/capabilities.yaml` })
        }
    }
    return gaps
}

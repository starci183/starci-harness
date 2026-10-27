import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { SHAPE_MANIFEST, compileFolderPrefix, compilePattern, exceptionCovers } from "./shape-manifest.js"
import type { CompiledPattern, ShapeException, ShapeManifest, ShapeSlot } from "./shape-manifest.js"

/** The finding codes of the shape gate; each is red. */
export const SHAPE_CODES = ["SHAPE_UNPLACED", "SHAPE_FORBIDDEN", "SHAPE_TARGET", "SHAPE_MISSING", "SHAPE_EXCEPTION_STALE", "SHAPE_EXCEPTION_EXPIRED"] as const

/** One shape finding code. */
export type ShapeCode = (typeof SHAPE_CODES)[number]

/** One red finding: its code, the path it is about (a file, a missing path or an exception's path) and the slot that judged it. */
export interface ShapeFinding {
    /** `<code> <path>`: the finding's stable key, the same on every run over the same tree. */
    readonly key: string
    readonly code: ShapeCode
    readonly path: string
    readonly slot: string | null
    readonly detail: string
}

/** One violation of a target slot that a dated exception covers: green until the exception's date. */
export interface ShapeExcepted {
    readonly path: string
    readonly slot: string
    readonly exception: string
    readonly until: string
    readonly owner: string
}

/** The shape gate's report over a tree. */
export interface ShapeReport {
    readonly root: string
    readonly manifest: string
    readonly version: string
    readonly files: number
    readonly slots: number
    /** Files placed per slot id (a file excepted from a target slot counts under that slot). */
    readonly placed: Readonly<Record<string, number>>
    /** Files placed in a slot marked generated: copies made from their owner, never edited by hand. */
    readonly generated: number
    readonly findings: readonly ShapeFinding[]
    readonly excepted: readonly ShapeExcepted[]
    readonly verdict: "green" | "red"
}

interface Compiled {
    readonly slot: ShapeSlot
    readonly paths: readonly CompiledPattern[]
    readonly except: readonly CompiledPattern[]
}

const compileSlot = (slot: ShapeSlot): Compiled => ({ slot, paths: slot.path.map((source) => compilePattern(source)), except: (slot.except ?? []).map((source) => compilePattern(source)) })

const inSlot = (compiled: Compiled, file: string): boolean => compiled.paths.some((path) => path.regex.test(file)) && !compiled.except.some((path) => path.regex.test(file))

// A forbidden slot with `jsonKey` judges only a JSON file that declares that key (a package.json with `bin`: a second CLI).
const declaresKey = (root: string, file: string, key: string): boolean => {
    const path = join(root, file)
    if (!existsSync(path)) return false
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
        return typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, key)
    } catch {
        return false
    }
}

const finding = (code: ShapeCode, path: string, slot: string | null, detail: string): ShapeFinding => ({ key: `${code} ${path}`, code, path, slot, detail })

const exceptionKey = (slot: string, exception: ShapeException): string => `${slot}\u0000${exception.path}`

/** The bookkeeping of one scan: findings, exceptions applied and which exception covered anything. */
interface Tally {
    readonly findings: ShapeFinding[]
    readonly excepted: ShapeExcepted[]
    readonly used: Set<string>
}

// A violation of a target slot is excepted when one of its dated exceptions covers the path; otherwise it is red.
const judgeTarget = (tally: Tally, slot: ShapeSlot, path: string, code: ShapeCode, detail: string): boolean => {
    const exception = (slot.exceptions ?? []).find((entry) => exceptionCovers(entry, path))
    if (exception === undefined) {
        tally.findings.push(finding(code, path, slot.id, detail))
        return false
    }
    tally.used.add(exceptionKey(slot.id, exception))
    tally.excepted.push({ path, slot: slot.id, exception: exception.path, until: exception.until, owner: exception.owner })
    return true
}

// The instance folders of a per slot (`packages/<name>/` gives one per package), with the values they bind, minus the exempt ones.
const instancesOf = (slot: ShapeSlot, files: readonly string[]): Map<string, Record<string, string>> => {
    const instances = new Map<string, Record<string, string>>()
    if (slot.per === undefined) return instances
    const per = compileFolderPrefix(slot.per)
    const exempt = new Set((slot.exempt ?? []).map((entry) => entry.path))
    for (const file of files) {
        const hit = per.regex.exec(file)
        if (hit === null || exempt.has(hit[0])) continue
        instances.set(hit[0], { ...hit.groups })
    }
    return instances
}

type Missing = (path: string, detail: string) => void

// A required slot with no per: each of its `requires` holds a file, else its path does.
const judgeRequiredOnce = (compiled: Compiled, files: readonly string[], missing: Missing): void => {
    const { slot } = compiled
    for (const required of slot.requires ?? []) {
        const pattern = compilePattern(required)
        if (!files.some((file) => pattern.regex.test(file))) missing(required, `required by ${slot.id}: ${slot.holds}`)
    }
    if (slot.requires === undefined && !files.some((file) => inSlot(compiled, file))) missing(slot.path.join(" | "), `required: ${slot.holds}`)
}

// A required per slot: in each instance folder, each of its `requires` (relative to the folder) holds a file, else its path does.
const judgeRequiredPer = (slot: ShapeSlot, files: readonly string[], missing: Missing): void => {
    for (const [instance, bindings] of instancesOf(slot, files)) {
        if (slot.requires === undefined) {
            const bound = slot.path.map((source) => compilePattern(source, bindings))
            if (!files.some((file) => bound.some((path) => path.regex.test(file)))) missing(instance, `${instance} holds nothing of ${slot.path.join(" | ")} (${slot.holds})`)
            continue
        }
        for (const required of slot.requires) {
            const pattern = compilePattern(required)
            if (!files.some((file) => file.startsWith(instance) && pattern.regex.test(file.slice(instance.length)))) missing(`${instance}${required}`, `required in every ${slot.per ?? ""}: ${slot.holds}`)
        }
    }
}

// A required slot: a missing file is red, or excepted for a target slot whose dated exception covers the path.
const judgeRequired = (tally: Tally, compiled: Compiled, files: readonly string[]): void => {
    const { slot } = compiled
    const missing: Missing = (path, detail) => {
        if (slot.enforce === "target") judgeTarget(tally, slot, path, "SHAPE_MISSING", detail)
        else tally.findings.push(finding("SHAPE_MISSING", path, slot.id, detail))
    }
    if (slot.per === undefined) judgeRequiredOnce(compiled, files, missing)
    else judgeRequiredPer(slot, files, missing)
}

// Every exception of the manifest is used by a file and within its date; a stale or expired one is a finding.
const judgeExceptions = (tally: Tally, compiled: readonly Compiled[], today: string): void => {
    for (const { slot } of compiled) {
        for (const exception of slot.exceptions ?? []) {
            if (!tally.used.has(exceptionKey(slot.id, exception))) {
                tally.findings.push(finding("SHAPE_EXCEPTION_STALE", exception.path, slot.id, `the exception covers nothing any more; remove it from ${SHAPE_MANIFEST}`))
            }
            if (exception.until < today) {
                tally.findings.push(finding("SHAPE_EXCEPTION_EXPIRED", exception.path, slot.id, `the exception ran out on ${exception.until} (owner ${exception.owner}); finish the move or get a new ruling`))
            }
        }
    }
}

// The slot a file is placed in: a forbidden target slot whose exception covers it, else the first placing slot holding it;
// undefined when the file is a finding (forbidden, uncovered or unplaced).
const slotOf = (root: string, ordered: readonly Compiled[], placing: readonly Compiled[], tally: Tally, file: string): ShapeSlot | undefined => {
    const hit = ordered.find((entry) => inSlot(entry, file) && (entry.slot.jsonKey === undefined || declaresKey(root, file, entry.slot.jsonKey)))
    if (hit !== undefined) {
        const detail = `forbidden by ${hit.slot.id}: ${hit.slot.holds} (${hit.slot.rule})`
        if (hit.slot.enforce === "gate") tally.findings.push(finding("SHAPE_FORBIDDEN", file, hit.slot.id, detail))
        else if (judgeTarget(tally, hit.slot, file, "SHAPE_TARGET", detail)) return hit.slot
        return undefined
    }
    const home = placing.find((entry) => inSlot(entry, file))
    if (home === undefined) tally.findings.push(finding("SHAPE_UNPLACED", file, null, `no slot of ${SHAPE_MANIFEST} holds it; move it to its slot or add the slot`))
    return home?.slot
}

/**
 * Places every file of the tree in the harness shape (contexts/hfs/harness.yaml). A file that matches a forbidden gate slot is
 * SHAPE_FORBIDDEN; one that matches a forbidden target slot is SHAPE_TARGET unless a dated exception covers it; one no slot
 * holds is SHAPE_UNPLACED; a required slot (or one instance of a per slot) with no file is SHAPE_MISSING. An exception that
 * covers nothing is SHAPE_EXCEPTION_STALE and one past its date SHAPE_EXCEPTION_EXPIRED, so the list only shrinks.
 */
export const scanShape = (root: string, manifest: ShapeManifest, files: readonly string[], today: string): ShapeReport => {
    const compiled = manifest.slots.map(compileSlot)
    const forbidden = compiled.filter((entry) => entry.slot.presence === "forbidden")
    // Gate slots judge first: a file a gate forbids is red even where a target's exception would cover it.
    const ordered = [...forbidden.filter((entry) => entry.slot.enforce === "gate"), ...forbidden.filter((entry) => entry.slot.enforce === "target")]
    const placing = compiled.filter((entry) => entry.slot.presence !== "forbidden")
    const tally: Tally = { findings: [], excepted: [], used: new Set() }
    const placed: Record<string, number> = {}
    let generated = 0
    const place = (slot: ShapeSlot): void => {
        placed[slot.id] = (placed[slot.id] ?? 0) + 1
        if (slot.generated !== undefined) generated += 1
    }
    for (const file of files) {
        const slot = slotOf(root, ordered, placing, tally, file)
        if (slot !== undefined) place(slot)
    }
    for (const entry of compiled) if (entry.slot.presence === "required") judgeRequired(tally, entry, files)
    judgeExceptions(tally, compiled, today)
    return {
        root,
        manifest: SHAPE_MANIFEST,
        version: manifest.version,
        files: files.length,
        slots: manifest.slots.length,
        placed,
        generated,
        findings: tally.findings,
        excepted: tally.excepted,
        verdict: tally.findings.length === 0 ? "green" : "red",
    }
}

/** The human lines of a shape report: the verdict, one `CODE path (slot): detail` per finding, and the exceptions applied, grouped. */
export const describeShape = (report: ShapeReport): string[] => {
    const byException = new Map<string, { readonly entry: ShapeExcepted; count: number }>()
    for (const entry of report.excepted) {
        const key = `${entry.slot} ${entry.exception}`
        const known = byException.get(key)
        if (known === undefined) byException.set(key, { entry, count: 1 })
        else known.count += 1
    }
    return [
        `shape: ${report.verdict}; ${String(report.files)} file(s) in ${String(report.slots)} slot(s) of ${report.manifest} ${report.version}, ${String(report.findings.length)} finding(s), ${String(report.excepted.length)} excepted, ${String(report.generated)} generated`,
        ...report.findings.map((finding) => {
            const slot = finding.slot === null ? "" : " (" + finding.slot + ")"
            return `${finding.code} ${finding.path}${slot}: ${finding.detail}`
        }),
        ...[...byException.values()].map(({ entry, count }) => `excepted until ${entry.until} (${entry.owner}): ${entry.slot} ${entry.exception} covers ${String(count)}`),
    ]
}

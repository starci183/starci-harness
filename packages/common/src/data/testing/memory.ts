import { holdingFor, DataRefusal } from "../driver.ts"
import type { CopyReceipt, CopyRef, CopyVerdict, DriverAdapter, DriverLimits, ExportSource, VerifyCheck } from "../driver.ts"
import type { StoredEntry } from "../copies.ts"
import { memorySpool, spooledSource } from "../copies.ts"
import type { DataEntry, DataManifest, JsonValue, Selection } from "../manifest.ts"
import { ManifestBuilder, blobEntry, byteOrder, recordEntry } from "../manifest.ts"
import type { ImportOptions, ImportReport, Inability, SetImport, StoreAdapter, StoreDescription } from "../store.ts"
import { importOutcome } from "../store.ts"
import type { DataRefusalCode } from "../driver.ts"
import type { DriverKind, StoreKind, StoreLevel } from "../words.ts"

/** The content of a memory store: set -> key -> a record value or blob bytes. */
export type MemorySets = Record<string, Record<string, JsonValue | Uint8Array>>

/** What a memory store starts with. */
export interface MemoryStoreInit {
    /** The store id. */
    readonly id: string
    /** The kind; `database` by default. */
    readonly kind?: StoreKind
    /** The level; `logical` by default. */
    readonly level?: StoreLevel
    /** The content. */
    readonly sets?: MemorySets
    /** The schema format of its record sets, e.g. `shop-seed-standard@1`. */
    readonly format?: string
    /** What it says it cannot do. */
    readonly cannot?: readonly Inability[]
    /** Keys whose import the door refuses, with the refusal code. */
    readonly refuse?: Readonly<Record<string, string>>
}

/** A memory store, with a view of what it holds now. */
export interface MemoryStore extends StoreAdapter {
    /** A copy of the content, for assertions. */
    snapshot(): MemorySets
}

const isBlob = (value: JsonValue | Uint8Array): value is Uint8Array => value instanceof Uint8Array

function entryOf(set: string, key: string, value: JsonValue | Uint8Array): DataEntry {
    return isBlob(value) ? blobEntry(set, key, value, "application/octet-stream") : recordEntry(set, key, value)
}

function valueOf(entry: DataEntry): JsonValue | Uint8Array {
    return entry.form === "blob" ? entry.body : (JSON.parse(new TextDecoder().decode(entry.body)) as JsonValue)
}

/** A store over plain maps: deterministic export in (set, key) byte order; merge and mirror imports with exact counts. */
export function memoryStore(init: MemoryStoreInit): MemoryStore {
    const sets: MemorySets = structuredClone(init.sets ?? {})
    const format = init.format ?? `${init.id}@1`
    const names = (): string[] => Object.keys(sets).sort(byteOrder)
    return {
        id: init.id,
        kind: init.kind ?? "database",
        level: init.level ?? "logical",
        snapshot: () => structuredClone(sets),
        describe: (): Promise<StoreDescription> => Promise.resolve({
            sets: names().map((set) => {
                const first = Object.values(sets[set] ?? {})[0]
                const form = first !== undefined && isBlob(first) ? "blob" as const : "record" as const
                return { set, schema: form === "blob" ? "blob@1" : `${format.slice(0, format.lastIndexOf("@"))}/${set}@1`, form }
            }),
            purposes: ["seed-standard", "seed-backup"],
            canExport: true,
            canImport: true,
            cannot: init.cannot ?? [],
        }),
        async *export(selection: Selection) {
            await Promise.resolve()
            for (const set of names()) {
                if (selection.sets !== undefined && !selection.sets.includes(set)) continue
                const content = sets[set] ?? {}
                for (const key of Object.keys(content).sort(byteOrder)) yield entryOf(set, key, content[key] as JsonValue | Uint8Array)
            }
        },
        async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
            const seen = new Map<string, Set<string>>()
            const counts = new Map<string, { created: number; updated: number; unchanged: number; removed: number; refused: { key: string; code: string }[] }>()
            const tally = (set: string) => {
                const found = counts.get(set) ?? { created: 0, updated: 0, unchanged: 0, removed: 0, refused: [] }
                counts.set(set, found)
                return found
            }
            const target: MemorySets = options.dryRun ? structuredClone(sets) : sets
            for await (const entry of entries) {
                const count = tally(entry.set)
                seen.set(entry.set, (seen.get(entry.set) ?? new Set()).add(entry.key))
                const code = init.refuse?.[entry.key]
                if (code !== undefined) {
                    count.refused.push({ key: entry.key, code })
                    continue
                }
                const content = (target[entry.set] ??= {})
                const before = content[entry.key]
                if (before === undefined) count.created += 1
                else if (entryOf(entry.set, entry.key, before).sha256 === entry.sha256) {
                    count.unchanged += 1
                    continue
                } else count.updated += 1
                content[entry.key] = valueOf(entry)
            }
            if (options.mode === "mirror") {
                for (const [set, keys] of seen) {
                    const content = target[set] ?? {}
                    for (const key of Object.keys(content)) {
                        if (keys.has(key)) continue
                        Reflect.deleteProperty(content, key)
                        tally(set).removed += 1
                    }
                }
            }
            const report: SetImport[] = [...counts.entries()].sort(([left], [right]) => byteOrder(left, right)).map(([set, count]) => ({ set, ...count }))
            return { sets: report, outcome: importOutcome(report) }
        },
    }
}

/** What a memory driver starts with. */
export interface MemoryDriverInit {
    /** The driver id. */
    readonly id: string
    /** The kind; `git` by default. */
    readonly kind?: DriverKind
    /** Limits; a git driver's by default (records and blobs, the 100 MiB whole-copy cap measured on entry bytes). */
    readonly limits?: Partial<DriverLimits>
    /** Fails one operation with this code, to test partial runs and chooseCopy. */
    readonly fail?: { readonly on: "write" | "read" | "verify"; readonly code: DataRefusalCode; readonly retry?: "configuration" | "transient" }
}

/** A memory driver, with a hook to corrupt a kept copy. */
export interface MemoryDriver extends DriverAdapter {
    /** Changes one entry of the newest copy without changing its manifest, as a corrupted shard would. */
    corrupt(set: string, key: string): void
}

interface KeptCopy {
    readonly ref: CopyRef
    readonly manifest: DataManifest
    readonly entries: StoredEntry[]
}

/** A driver over a list of kept copies, newest first, with real limits applied. */
export function memoryDriver(init: MemoryDriverInit): MemoryDriver {
    const kind = init.kind ?? "git"
    const limits: DriverLimits = { forms: ["record", "blob"], maxFileBytes: null, maxCopyBytes: 104_857_600, warnCopyBytes: 83_886_080, ...init.limits }
    const copies: KeptCopy[] = []
    const failOn = (on: "write" | "read" | "verify"): void => {
        if (init.fail?.on === on) throw new DataRefusal(init.fail.code, init.fail.retry ?? "transient", { driver: init.id })
    }
    const find = (ref: CopyRef): KeptCopy => {
        const kept = copies.find((copy) => copy.ref.locator === ref.locator)
        if (kept === undefined) throw new DataRefusal("DATA_COPY_MISSING", "configuration", { driver: init.id, locator: ref.locator })
        return kept
    }
    return {
        id: init.id,
        kind,
        limits: () => limits,
        plan: (manifest) => holdingFor(manifest, limits.forms),
        async write(source: ExportSource): Promise<CopyReceipt> {
            failOn("write")
            const holding = holdingFor(source.manifest, limits.forms)
            const held = new Set(holding.sets.map((set) => `${set.store}/${set.set}`))
            const entries: StoredEntry[] = []
            for await (const item of source.entries()) if (held.has(`${item.store}/${item.entry.set}`)) entries.push(item)
            const bytes = entries.reduce((sum, item) => sum + item.entry.body.byteLength, 0)
            if (limits.maxCopyBytes !== null && bytes > limits.maxCopyBytes)
                throw new DataRefusal("DATA_GIT_CAP_EXCEEDED", "configuration", { driver: init.id, bytes, cap: limits.maxCopyBytes })
            const warnings = limits.warnCopyBytes !== null && bytes > limits.warnCopyBytes ? ["DATA_GIT_CAP_NEAR"] : []
            const at = new Date().toISOString()
            const newest = copies[0]
            if (newest?.ref.exportDigest === source.manifest.exportDigest)
                return { schema: "starci/data-copy@1", ref: newest.ref, holding, bytes, changed: 0, warnings, at }
            const ref: CopyRef = { driver: init.id, kind, locator: `${init.id}#${String(copies.length + 1)}`, exportDigest: source.manifest.exportDigest, takenAt: source.manifest.takenAt }
            copies.unshift({ ref, manifest: source.manifest, entries })
            return { schema: "starci/data-copy@1", ref, holding, bytes, changed: entries.length, warnings, at }
        },
        list: () => Promise.resolve(copies.map((copy) => copy.ref)),
        async read(ref: CopyRef): Promise<ExportSource> {
            failOn("read")
            const kept = find(ref)
            const spool = memorySpool()
            for (const item of kept.entries) await spool.append(item)
            return spooledSource(kept.manifest, spool)
        },
        verify(ref: CopyRef): Promise<CopyVerdict> {
            failOn("verify")
            const kept = find(ref)
            const builder = new ManifestBuilder()
            const checks: VerifyCheck[] = []
            let intact = true
            try {
                for (const item of kept.entries) builder.add(item.store, item.entry)
            } catch (cause) {
                intact = false
                checks.push({ name: "digests", ok: false, detail: String(cause) })
            }
            if (intact) {
                const rebuilt = builder.build(kept.manifest)
                const held = new Map(rebuilt.sets.map((set) => [`${set.store}/${set.set}`, set.digest]))
                const wrong = kept.manifest.sets.filter((set) => held.has(`${set.store}/${set.set}`) && held.get(`${set.store}/${set.set}`) !== set.digest)
                checks.push({ name: "digests", ok: wrong.length === 0, detail: wrong.length === 0 ? "every set matches" : `differ: ${wrong.map((set) => set.set).join(", ")}` })
            }
            return Promise.resolve({ ref, healthy: checks.every((check) => check.ok), checks, manifest: kept.manifest })
        },
        corrupt(set: string, key: string): void {
            const newest = copies[0]
            const at = newest?.entries.findIndex((item) => item.entry.set === set && item.entry.key === key) ?? -1
            if (newest === undefined || at < 0) throw new TypeError(`no entry ${set}/${key} to corrupt`)
            const item = newest.entries[at] as StoredEntry
            const body = new Uint8Array(item.entry.body)
            body[0] = (body[0] ?? 0) ^ 1
            newest.entries[at] = { store: item.store, entry: { ...item.entry, body } }
        },
    }
}

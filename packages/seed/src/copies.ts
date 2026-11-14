import type { CopyReceipt, CopyRef, CopyVerdict, DriverAdapter, ExportSource, WriteContext } from "./driver.ts"
import { DataRefusal } from "./driver.ts"
import type { DataEntry, DataManifest, ManifestHeader, Selection } from "./manifest.ts"
import { ManifestBuilder, byteOrder } from "./manifest.ts"
import type { ImportOptions, ImportReport, StoreAdapter } from "./store.ts"

/** An entry with the store it was read from. */
export interface StoredEntry {
    /** The store id. */
    readonly store: string
    /** The entry. */
    readonly entry: DataEntry
}

/**
 * Where one export is held so every driver writes the same bytes: plaintext, outside every repository, removed after
 * the run. The harness spools to a private scratch directory; tests spool in memory.
 */
export interface Spool {
    /** Keeps one entry. */
    append(item: StoredEntry): Promise<void>
    /** Every kept entry, in the order appended. */
    replay(): AsyncIterable<StoredEntry>
    /** Removes everything kept. */
    dispose(): Promise<void>
}

/** One destination's part of a run. */
export interface CopyLeg {
    /** The driver id. */
    readonly driver: string
    /** `written`, `unchanged` (it already held the export) or `failed`. */
    readonly outcome: "written" | "unchanged" | "failed"
    /** The driver's receipt, when it wrote or already held the export. */
    readonly receipt: CopyReceipt | null
    /** The failure, by code and retry class; never a value. */
    readonly failure: { readonly code: string; readonly retry: "configuration" | "transient" } | null
}

/** One run: one manifest, one leg per destination. `partial` is one item for a person (the dead-letter frame of the jobs). */
export interface CopyRun {
    /** The export every leg wrote. */
    readonly manifest: DataManifest
    /** One per driver, in the declared order. */
    readonly legs: readonly CopyLeg[]
    /** `complete` when every leg holds the export, `partial` when some do, `failed` when none. */
    readonly outcome: "complete" | "partial" | "failed"
}

function selects(selection: Selection | undefined, set: string): boolean {
    return selection?.sets === undefined || selection.sets.includes(set)
}

/** An export source over a spool and its manifest. */
export function spooledSource(manifest: DataManifest, spool: Spool): ExportSource {
    return {
        manifest,
        async *entries(selection?: Selection) {
            for await (const item of spool.replay()) if (selects(selection, item.entry.set)) yield item
        },
    }
}

/**
 * Reads every store once, in the order given, into the spool and computes the manifest. A store must yield its entries
 * in (set, key) byte order; an entry out of order, a repeated key or a hash that does not match its body is refused.
 */
export async function exportOnce(stores: readonly StoreAdapter[], selection: Selection, spool: Spool, header: ManifestHeader): Promise<ExportSource> {
    const builder = new ManifestBuilder()
    for (const store of stores) {
        let last: { set: string; key: string } | null = null
        try {
            for await (const entry of store.export(selection)) {
                if (last !== null && (byteOrder(last.set, entry.set) || byteOrder(last.key, entry.key)) > 0)
                    throw new TypeError(`${store.id}: ${entry.set}/${entry.key} comes after ${last.set}/${last.key}`)
                builder.add(store.id, entry)
                await spool.append({ store: store.id, entry })
                last = { set: entry.set, key: entry.key }
            }
        } catch (cause) {
            if (cause instanceof DataRefusal) throw cause
            throw new DataRefusal("DATA_STORE_FAILED", "configuration", { store: store.id, cause: causeLabel(cause) }, cause)
        }
    }
    return spooledSource(builder.build(header), spool)
}

/**
 * What a store's failure was, safe to log: the coded error's code (a DomainError of any copy of @starci/common, so read by shape,
 * never by `instanceof`), a driver's `code` (a PostgreSQL SQLSTATE, a Node errno) with the error's class, or the class alone. Never the
 * message, which may quote a value.
 */
export function causeLabel(cause: unknown): string {
    if (typeof cause !== "object" || cause === null) return typeof cause
    const shaped = cause as { readonly code?: unknown; readonly name?: unknown; readonly table?: unknown }
    const name = typeof shaped.name === "string" ? shaped.name : "Error"
    const code = typeof shaped.code === "string" || typeof shaped.code === "number" ? String(shaped.code) : null
    const table = typeof shaped.table === "string" ? ` on ${shaped.table}` : ""
    return code === null ? name : `${name} ${code}${table}`
}

/** True when the export equals the one the last receipt recorded: a scheduled backup then writes nothing. */
export function unchangedSince(manifest: DataManifest, lastExportDigest: string | null): boolean {
    return lastExportDigest !== null && manifest.exportDigest === lastExportDigest
}

/** Writes the one export to every driver; each leg is isolated, so a failing driver never stops another. */
export async function writeEverywhere(source: ExportSource, drivers: readonly DriverAdapter[], context: WriteContext): Promise<CopyRun> {
    const legs: CopyLeg[] = []
    for (const driver of drivers) {
        try {
            const receipt = await driver.write(source, context)
            legs.push({ driver: driver.id, outcome: receipt.changed === 0 ? "unchanged" : "written", receipt, failure: null })
        } catch (cause) {
            const failure = cause instanceof DataRefusal
                ? { code: cause.code, retry: cause.retry }
                : { code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" as const }
            legs.push({ driver: driver.id, outcome: "failed", receipt: null, failure })
        }
    }
    const held = legs.filter((leg) => leg.outcome !== "failed").length
    const outcome = held === legs.length ? "complete" : held === 0 ? "failed" : "partial"
    return { manifest: source.manifest, legs, outcome }
}

/** One set whose copies differ, with each copy's digest by driver. */
export interface CopyDifference {
    /** `<store>/<set>`. */
    readonly set: string
    /** Digest per driver; a copy that does not hold the set is absent. */
    readonly digests: Readonly<Record<string, string>>
}

/**
 * Copies are equal when every set two or more copies hold has one digest. A subset copy is compared on the sets it holds;
 * an unhealthy copy (or one without a manifest) is left out and makes the comparison unequal.
 */
export function compareCopies(verdicts: readonly CopyVerdict[]): { readonly equal: boolean; readonly differing: readonly CopyDifference[] } {
    const bySet = new Map<string, Record<string, string>>()
    for (const verdict of verdicts) {
        if (!verdict.healthy || verdict.manifest === null) continue
        for (const set of verdict.manifest.sets) {
            const id = `${set.store}/${set.set}`
            bySet.set(id, { ...bySet.get(id), [verdict.ref.driver]: set.digest })
        }
    }
    const differing = [...bySet.entries()]
        .filter(([, digests]) => new Set(Object.values(digests)).size > 1)
        .map(([set, digests]) => ({ set, digests }))
    const unhealthy = verdicts.some((verdict) => !verdict.healthy || verdict.manifest === null)
    return { equal: differing.length === 0 && !unhealthy, differing }
}

/** The newest healthy copy that holds every selected set, the drivers tried in `preference` order on a tie; null when none. */
export function chooseCopy(verdicts: readonly CopyVerdict[], selection: Selection, preference: readonly string[]): CopyRef | null {
    const rank = (driver: string): number => {
        const at = preference.indexOf(driver)
        return at < 0 ? preference.length : at
    }
    const usable = verdicts.filter((verdict) => {
        if (!verdict.healthy || verdict.manifest === null) return false
        const held = new Set(verdict.manifest.sets.map((set) => set.set))
        return (selection.sets ?? []).every((set) => held.has(set))
    })
    usable.sort((left, right) => byteOrder(right.ref.takenAt, left.ref.takenAt) || rank(left.ref.driver) - rank(right.ref.driver))
    return usable[0]?.ref ?? null
}

async function* entriesOf(source: ExportSource, store: string, selection: Selection | undefined): AsyncIterable<DataEntry> {
    for await (const item of source.entries(selection)) if (item.store === store) yield item.entry
}

/** Imports one copy into the stores it names, in the order given; a store the copy does not hold is skipped. */
export async function restoreFrom(source: ExportSource, stores: readonly StoreAdapter[], options: ImportOptions, selection?: Selection): Promise<readonly ImportReport[]> {
    const reports: ImportReport[] = []
    for (const store of stores) {
        if (!source.manifest.sets.some((set) => set.store === store.id && selects(selection, set.set))) continue
        reports.push(await store.import(entriesOf(source, store.id, selection), options))
    }
    return reports
}

/** A spool held in memory, for tests and small exports. */
export function memorySpool(): Spool {
    let items: StoredEntry[] = []
    return {
        append: (item) => {
            items.push(item)
            return Promise.resolve()
        },
        async *replay() {
            await Promise.resolve()
            yield* items
        },
        dispose: () => {
            items = []
            return Promise.resolve()
        },
    }
}

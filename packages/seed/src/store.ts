import type { DataEntry, Selection } from "./manifest.ts"
import type { DataPurpose, EntryForm, StoreKind, StoreLevel } from "./words.ts"

/** One thing a store cannot do, said with its reason, never left silent. */
export interface Inability {
    /** What it cannot do, e.g. `import of set audit-log`. */
    readonly what: string
    /** Why. */
    readonly reason: string
}

/** One set a store holds. */
export interface StoreSet {
    /** The set name (kebab-case). */
    readonly set: string
    /** `<format>/<set>@<major>` of a record set, `blob@1` of a blob set. */
    readonly schema: string
    /** The form of its entries. */
    readonly form: EntryForm
}

/** What a store holds and can do. */
export interface StoreDescription {
    /** Every set, sorted by name. */
    readonly sets: readonly StoreSet[]
    /** The purposes it serves. */
    readonly purposes: readonly DataPurpose[]
    /** Whether `export` reads anything. */
    readonly canExport: boolean
    /** Whether `import` writes anything. */
    readonly canImport: boolean
    /** What it cannot do, each with its reason. */
    readonly cannot: readonly Inability[]
}

/** How an import treats what the entries do not name. */
export interface ImportOptions {
    /** Count what would change and write nothing. */
    readonly dryRun: boolean
    /**
     * `merge`: create and update by natural key, remove nothing. `mirror`: also remove the keys of the selected sets the
     * entries lack. A mirror is destructive: its caller refuses it without a verified copy of the target younger than the
     * declared maximum age (the reset rule of PROJECT-STACKS-6).
     */
    readonly mode: "merge" | "mirror"
    /** The narrowing the import writes into, e.g. the workspace a seed is applied to. */
    readonly scope?: Readonly<Record<string, string>>
}

/** A key a door refused, with its code; never a value. */
export interface RefusedKey {
    /** The natural key. */
    readonly key: string
    /** The refusal's code. */
    readonly code: string
}

/** What an import did to one set. */
export interface SetImport {
    /** The set. */
    readonly set: string
    /** Keys created. */
    readonly created: number
    /** Keys whose content changed. */
    readonly updated: number
    /** Keys already equal. */
    readonly unchanged: number
    /** Keys removed by a mirror. */
    readonly removed: number
    /** Keys a door refused. */
    readonly refused: readonly RefusedKey[]
}

/** What an import did. `unchanged` when nothing moved: the second run of the same import answers it. */
export interface ImportReport {
    /** Per set, sorted by name. */
    readonly sets: readonly SetImport[]
    /** `unchanged`, `applied`, or `partial` when a door refused a key. */
    readonly outcome: "unchanged" | "applied" | "partial"
}

/** A thing that must be kept: one per declared store of `application-stacks.yaml` `data.stores`. */
export interface StoreAdapter {
    /** The store id the stack manifest declares. */
    readonly id: string
    /** Its kind, from the closed list. */
    readonly kind: StoreKind
    /** logical or physical. */
    readonly level: StoreLevel
    /** What it holds and can do. */
    describe(): Promise<StoreDescription>
    /** Every entry of the selection, in (set, key) byte order; the same content yields the same stream. */
    export(selection: Selection): AsyncIterable<DataEntry>
    /**
     * An upsert by natural key through the app's own doors that KEEPS RELATIONS: a key already held is updated in place and
     * keeps its identity (never deleted and re-created), so every reference to it stays valid; the same entries imported
     * twice change nothing the second time; a key the entries do not name is left alone (reported by a mirror, removed
     * only by it); operational data the entries do not carry is never overwritten.
     */
    import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport>
    /** The store's own identity of the row or object a natural key names (a database id, an object version), or null. The contract suite proves imports keep it. */
    identityOf(set: string, key: string): Promise<string | null>
}

/** The outcome of an import from its per-set counts. */
export function importOutcome(sets: readonly SetImport[]): ImportReport["outcome"] {
    if (sets.some((set) => set.refused.length > 0)) return "partial"
    return sets.some((set) => set.created + set.updated + set.removed > 0) ? "applied" : "unchanged"
}

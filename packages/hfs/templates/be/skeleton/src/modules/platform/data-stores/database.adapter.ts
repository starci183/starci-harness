import type { DataEntry, ImportReport, StoreAdapter, StoreDescription } from "@starci/seed"

/**
 * The relational database as a store of the data standard (PROJECT-STACKS-14). It holds no set yet: the app declares each set it
 * keeps and copies here, with the export and the upsert that go with it.
 */
export class DatabaseStore implements StoreAdapter {
    readonly id = "database"
    readonly kind = "database"
    readonly level = "logical"

    /** Answers that the store holds no set. */
    describe(): Promise<StoreDescription> {
        return Promise.resolve({
            sets: [],
            purposes: [],
            canExport: false,
            canImport: false,
            cannot: [{ what: "every set", reason: "the app declares its sets here" }],
        })
    }

    /** Yields nothing: no set is declared. */
    async *export(): AsyncIterable<DataEntry> {
        yield* []
    }

    /** Counts nothing: no set is declared. */
    import(): Promise<ImportReport> {
        return Promise.resolve({ sets: [], outcome: "unchanged" })
    }

    /** No set is declared, so no key has an identity. */
    identityOf(): Promise<string | null> {
        return Promise.resolve(null)
    }
}

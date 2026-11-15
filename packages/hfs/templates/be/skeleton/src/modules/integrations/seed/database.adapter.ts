import type { DataEntry, ImportReport, StoreAdapter, StoreDescription } from "@starci/seed"
import type { StoreIdentity } from "./seed.contracts"

/** An export of no entry: its iterator is done at once. */
const NO_ENTRIES: AsyncIterable<DataEntry> = {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
}

/**
 * The relational database as a store of the data standard (PROJECT-STACKS-14). It holds no set yet: the app declares each set it
 * keeps and copies here, with the export and the upsert that go with it. It has no dependencies, so the DI container builds it
 * without a decorator.
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
    export(): AsyncIterable<DataEntry> {
        return NO_ENTRIES
    }

    /** Counts nothing: no set is declared. */
    import(): Promise<ImportReport> {
        return Promise.resolve({ sets: [], outcome: "unchanged" })
    }

    /** No set is declared, so no key has an identity. */
    identityOf(): Promise<StoreIdentity> {
        return Promise.resolve(null)
    }
}

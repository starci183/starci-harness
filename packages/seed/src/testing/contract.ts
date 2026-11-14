import { exportOnce, memorySpool, restoreFrom, writeEverywhere } from "../copies.ts"
import type { DriverAdapter, OpenContext, WriteContext } from "../driver.ts"
import { DataRefusal } from "../driver.ts"
import type { DataEntry, ManifestHeader } from "../manifest.ts"
import type { JsonValue } from "../manifest.ts"
import { blobEntry, byteOrder, entryIntact, recordEntry, recordValue } from "../manifest.ts"
import type { StoreAdapter } from "../store.ts"

/** One case of a contract suite: a name and a body that throws on a broken promise. Run it in any test runner. */
export interface ContractCase {
    /** What the case proves. */
    readonly name: string
    /** Throws when the adapter breaks the contract. */
    readonly run: () => Promise<void>
}

function check(condition: boolean, message: string): void {
    if (!condition) throw new Error(`contract broken: ${message}`)
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

async function* from<T>(items: readonly T[]): AsyncIterable<T> {
    await Promise.resolve()
    yield* items
}

const header: ManifestHeader = { format: "contract-seed-backup@1", purpose: "seed-backup", takenAt: "2026-01-01T00:00:00.000Z", source: { project: "contract", environment: "test" } }
const sameBytes = (left: DataEntry, right: DataEntry): boolean => left.sha256 === right.sha256 && left.key === right.key && left.set === right.set

/**
 * The promises every store adapter keeps. `make` builds a fresh store holding at least one entry; `empty` a fresh store of
 * the same kind holding nothing, the target of an import. A real adapter runs this suite against its fakes.
 */
export function storeContract(make: () => Promise<StoreAdapter>, empty: () => Promise<StoreAdapter>): readonly ContractCase[] {
    return [
        {
            name: "describes its sets, each with a schema and a form, and says what it cannot do",
            run: async () => {
                const description = await (await make()).describe()
                check(description.sets.length > 0, "a store with content describes at least one set")
                check(description.sets.every((set) => set.schema !== ""), "every set has a schema")
                check(Array.isArray(description.cannot), "cannot is a list, even when empty")
            },
        },
        {
            name: "exports in (set, key) byte order, every entry intact, each key once",
            run: async () => {
                const entries = await collect((await make()).export({}))
                check(entries.length > 0, "the export holds entries")
                check(entries.every(entryIntact), "every sha256 matches its body")
                entries.reduce((before, after) => {
                    check((byteOrder(before.set, after.set) || byteOrder(before.key, after.key)) < 0, `${after.set}/${after.key} is out of order or repeated`)
                    return after
                })
            },
        },
        {
            name: "exports the same content twice as the same bytes",
            run: async () => {
                const store = await make()
                const first = await collect(store.export({}))
                const second = await collect(store.export({}))
                check(first.length === second.length && first.every((entry, at) => second[at] !== undefined && sameBytes(entry, second[at])), "two exports differ")
            },
        },
        {
            name: "exports only the selected sets",
            run: async () => {
                const store = await make()
                const [first] = (await store.describe()).sets
                const entries = await collect(store.export({ sets: [first?.set ?? ""] }))
                check(entries.every((entry) => entry.set === first?.set), "an entry of an unselected set was exported")
            },
        },
        {
            name: "imports idempotently by natural key: the second import changes nothing",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                const first = await target.import(from(entries), { dryRun: false, mode: "merge" })
                check(first.outcome === "applied", `the first import answered ${first.outcome}`)
                const second = await target.import(from(entries), { dryRun: false, mode: "merge" })
                check(second.outcome === "unchanged", `the second import answered ${second.outcome}`)
            },
        },
        {
            name: "a re-import keeps every identity: the same entries keep the same ids (relations stay valid)",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                await target.import(from(entries), { dryRun: false, mode: "merge" })
                const before = await Promise.all(entries.map((entry) => target.identityOf(entry.set, entry.key)))
                check(before.every((id) => id !== null), "an imported key has no identity")
                await target.import(from(entries), { dryRun: false, mode: "merge" })
                const after = await Promise.all(entries.map((entry) => target.identityOf(entry.set, entry.key)))
                check(after.every((id, at) => id === before[at]), "a re-import changed an identity")
            },
        },
        {
            name: "a changed entry is updated in place: same identity, new content",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                await target.import(from(entries), { dryRun: false, mode: "merge" })
                const first = entries.find((entry) => entry.form === "record") ?? entries[0]
                if (first === undefined) throw new Error("contract broken: no entry to change")
                const id = await target.identityOf(first.set, first.key)
                const changed = first.form === "record"
                    ? recordEntry(first.set, first.key, { ...(recordValue(first) as Record<string, JsonValue>), contractChanged: true })
                    : blobEntry(first.set, first.key, new Uint8Array([...first.body, 1]), first.media)
                const report = await target.import(from([changed]), { dryRun: false, mode: "merge" })
                check(report.sets.some((set) => set.updated === 1), "the changed entry was not counted as an update")
                check((await target.identityOf(first.set, first.key)) === id, "the update re-created the row")
                const back = await collect(target.export({ sets: [first.set] }))
                check(back.some((entry) => entry.key === first.key && entry.sha256 === changed.sha256), "the new content was not written")
            },
        },
        {
            name: "a merge leaves alone every key the entries do not name",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                await target.import(from(entries), { dryRun: false, mode: "merge" })
                const sets = new Map<string, DataEntry[]>()
                for (const entry of entries) sets.set(entry.set, [...(sets.get(entry.set) ?? []), entry])
                const several = [...sets.values()].find((items) => items.length > 1) ?? entries
                const report = await target.import(from(several.slice(0, 1)), { dryRun: false, mode: "merge" })
                check(report.sets.every((set) => set.removed === 0), "a merge removed a key")
                const back = await collect(target.export({}))
                check(back.length === entries.length, "a key absent from the import disappeared")
            },
        },
        {
            name: "a dry-run import writes nothing",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                await target.import(from(entries), { dryRun: true, mode: "merge" })
                const after = await collect(target.export({}))
                check(after.length === 0, "a dry run wrote entries")
            },
        },
        {
            name: "export then import into an empty store round-trips every entry",
            run: async () => {
                const entries = await collect((await make()).export({}))
                const target = await empty()
                await target.import(from(entries), { dryRun: false, mode: "merge" })
                const back = await collect(target.export({}))
                check(back.length === entries.length && back.every((entry, at) => entries[at] !== undefined && sameBytes(entry, entries[at])), "the round trip changed the content")
            },
        },
    ]
}

/**
 * The promises every driver adapter keeps. `make` builds a fresh driver; `store` a store with content to export; `open`
 * the identity a sealed copy is read with (a throwaway test key in a driver's own specs, never a real one).
 */
export function driverContract(make: () => Promise<DriverAdapter>, store: () => Promise<StoreAdapter>, context: WriteContext, open: OpenContext = { identity: { kind: "age-identity", env: {} } }): readonly ContractCase[] {
    const exported = async () => exportOnce([await store()], {}, memorySpool(), header)
    return [
        {
            name: "plans a holding of the export, naming every omitted set",
            run: async () => {
                const source = await exported()
                const holding = (await make()).plan(source.manifest)
                check(holding.exportDigest === source.manifest.exportDigest, "the holding names another export")
                check((holding.holds === "all") === (holding.omitted.length === 0), "holds and omitted disagree")
            },
        },
        {
            name: "writes, lists, reads back the same entries and verifies healthy",
            run: async () => {
                const driver = await make()
                const source = await exported()
                const receipt = await driver.write(source, context)
                const [ref] = await driver.list()
                if (ref === undefined) throw new Error("contract broken: no copy listed after a write")
                check(ref.exportDigest === source.manifest.exportDigest, "the newest copy is not the export written")
                check(receipt.ref.locator === ref.locator, "the receipt names another copy")
                const back = await collect((await driver.read(ref, open)).entries())
                const sent = await collect(source.entries())
                check(back.length === sent.length && back.every((item, at) => sameBytes(item.entry, (sent[at] as { entry: DataEntry }).entry)), "the copy reads back other entries")
                const verdict = await driver.verify(ref, open)
                check(verdict.healthy, `verify: ${verdict.checks.filter((item) => !item.ok).map((item) => item.detail).join("; ")}`)
            },
        },
        {
            name: "writing an export it already holds changes nothing",
            run: async () => {
                const driver = await make()
                const source = await exported()
                await driver.write(source, context)
                const again = await driver.write(source, context)
                check(again.changed === 0, `the second write changed ${String(again.changed)} files`)
            },
        },
        {
            name: "a failing driver is one failed leg; the others still hold the export",
            run: async () => {
                const driver = await make()
                const broken: DriverAdapter = { ...driver, id: "broken", write: () => Promise.reject(new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient")) }
                const run = await writeEverywhere(await exported(), [driver, broken], context)
                check(run.outcome === "partial", `the run answered ${run.outcome}`)
                check(run.legs[1]?.failure?.code === "DATA_DRIVER_UNAVAILABLE", "the failed leg lost its code")
            },
        },
        {
            name: "a copy restores into an empty store",
            run: async () => {
                const driver = await make()
                const source = await exported()
                await driver.write(source, context)
                const [ref] = await driver.list()
                if (ref === undefined) throw new Error("contract broken: no copy listed")
                const target = await store()
                const reports = await restoreFrom(await driver.read(ref, open), [target], { dryRun: false, mode: "merge" })
                check(reports.every((report) => report.outcome !== "partial"), "the restore was refused in part")
            },
        },
    ]
}

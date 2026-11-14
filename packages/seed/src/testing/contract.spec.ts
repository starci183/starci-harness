import assert from "node:assert/strict"
import { test } from "node:test"
import type { DriverAdapter, WriteContext } from "../driver.ts"
import type { DataEntry } from "../manifest.ts"
import type { StoreAdapter } from "../store.ts"
import type { ContractCase } from "./contract.ts"
import { driverContract, storeContract } from "./contract.ts"
import { memoryDriver, memoryStore } from "./memory.ts"

const context: WriteContext = { recipients: ["age1recipient"], dryRun: false }

const content = { products: { a: { n: 1 }, b: { n: 2 } }, images: { logo: new Uint8Array([1, 2, 3]) } }
const fresh = (): Promise<StoreAdapter> => Promise.resolve(memoryStore({ id: "db", sets: content }))
const empty = (): Promise<StoreAdapter> => Promise.resolve(memoryStore({ id: "db" }))

interface CaseResult {
    readonly name: string
    readonly error: string | null
}

async function results(cases: readonly ContractCase[]): Promise<CaseResult[]> {
    const out: CaseResult[] = []
    for (const contractCase of cases) {
        try {
            await contractCase.run()
            out.push({ name: contractCase.name, error: null })
        } catch (error) {
            out.push({ name: contractCase.name, error: error instanceof Error ? error.message : String(error) })
        }
    }
    return out
}

const failing = (all: readonly CaseResult[]): string[] => all.filter((result) => result.error !== null).map((result) => result.name)

async function* reversed(items: AsyncIterable<DataEntry>): AsyncIterable<DataEntry> {
    const all: DataEntry[] = []
    for await (const item of items) all.push(item)
    yield* all.reverse()
}

test("the memory store passes every case of storeContract", async () => {
    const all = await results(storeContract(fresh, empty))
    assert.equal(all.length, 10)
    assert.deepEqual(failing(all), [])
})

test("the memory store passes storeContract for blobs only, which updates a blob in place", async () => {
    const blobs = (): Promise<StoreAdapter> => Promise.resolve(memoryStore({ id: "db", sets: { images: { logo: new Uint8Array([1]) } } }))
    assert.deepEqual(failing(await results(storeContract(blobs, empty))), [])
})

test("an empty store is no vacuous pass: the cases that need content fail", async () => {
    const all = await results(storeContract(empty, empty))
    const failed = failing(all)
    assert.ok(failed.includes("describes its sets, each with a schema and a form, and says what it cannot do"))
    assert.ok(failed.includes("a changed entry is updated in place: same identity, new content"))
    assert.match(all.find((result) => result.name.startsWith("a changed entry"))?.error ?? "", /no entry to change/u)
})

test("a store that exports out of order fails the ordering case", async () => {
    const broken = (): Promise<StoreAdapter> => {
        const store = memoryStore({ id: "db", sets: content })
        return Promise.resolve({ ...store, export: (selection) => reversed(store.export(selection)) })
    }
    const failed = failing(await results(storeContract(broken, empty)))
    assert.ok(failed.includes("exports in (set, key) byte order, every entry intact, each key once"))
})

test("a store that gives a new identity at every import fails the identity case and a store that re-creates on update fails it too", async () => {
    let counter = 0
    const unstable = (): Promise<StoreAdapter> => {
        const store = memoryStore({ id: "db" })
        return Promise.resolve({ ...store, identityOf: () => Promise.resolve(`id-${String((counter += 1))}`) })
    }
    const failed = failing(await results(storeContract(fresh, unstable)))
    assert.ok(failed.includes("a re-import keeps every identity: the same entries keep the same ids (relations stay valid)"))
    assert.ok(failed.includes("a changed entry is updated in place: same identity, new content"))
})

test("a store with no identity at all fails the identity case", async () => {
    const anonymous = (): Promise<StoreAdapter> => Promise.resolve({ ...memoryStore({ id: "db" }), identityOf: () => Promise.resolve(null) })
    assert.ok(failing(await results(storeContract(fresh, anonymous))).includes("a re-import keeps every identity: the same entries keep the same ids (relations stay valid)"))
})

test("a store whose dry run writes, and whose export ignores the selection fails those cases", async () => {
    const eager = (): Promise<StoreAdapter> => {
        const store = memoryStore({ id: "db" })
        return Promise.resolve({ ...store, import: (entries, options) => store.import(entries, { ...options, dryRun: false }) })
    }
    const wide = (): Promise<StoreAdapter> => {
        const store = memoryStore({ id: "db", sets: content })
        return Promise.resolve({ ...store, export: () => store.export({}) })
    }
    assert.ok(failing(await results(storeContract(fresh, eager))).includes("a dry-run import writes nothing"))
    assert.ok(failing(await results(storeContract(wide, empty))).includes("exports only the selected sets"))
})

test("the memory driver passes every case of driverContract", async () => {
    const all = await results(driverContract(() => Promise.resolve(memoryDriver({ id: "git" })), fresh, context))
    assert.equal(all.length, 5)
    assert.deepEqual(failing(all), [])
})

test("a driver that lists nothing, forgets the export or rewrites it every time fails driverContract", async () => {
    const forgetful = (): Promise<DriverAdapter> => Promise.resolve({ ...memoryDriver({ id: "git" }), list: () => Promise.resolve([]) })
    const forgot = failing(await results(driverContract(forgetful, fresh, context)))
    assert.ok(forgot.includes("writes, lists, reads back the same entries and verifies healthy"))
    assert.ok(forgot.includes("a copy restores into an empty store"))

    const restless = (): Promise<DriverAdapter> => {
        const driver = memoryDriver({ id: "git" })
        return Promise.resolve({ ...driver, write: async (source, ctx) => ({ ...(await driver.write(source, ctx)), changed: 1 }) })
    }
    assert.ok(failing(await results(driverContract(restless, fresh, context))).includes("writing an export it already holds changes nothing"))

    const lying = (): Promise<DriverAdapter> => {
        const driver = memoryDriver({ id: "git" })
        return Promise.resolve({ ...driver, plan: (manifest) => ({ ...driver.plan(manifest), exportDigest: "other" }) })
    }
    assert.ok(failing(await results(driverContract(lying, fresh, context))).includes("plans a holding of the export, naming every omitted set"))

    const sick = (): Promise<DriverAdapter> => {
        const driver = memoryDriver({ id: "git" })
        return Promise.resolve({ ...driver, verify: async (ref, open) => ({ ...(await driver.verify(ref, open)), healthy: false, checks: [{ name: "digests", ok: false, detail: "shard missing" }] }) })
    }
    const sickRuns = await results(driverContract(sick, fresh, context))
    assert.match(sickRuns.find((result) => result.name.startsWith("writes, lists"))?.error ?? "", /verify: shard missing/u)

    const lonely = (): Promise<DriverAdapter> => Promise.resolve({ ...memoryDriver({ id: "git" }), write: (source, ctx) => memoryDriver({ id: "other" }).write(source, ctx) })
    assert.ok(failing(await results(driverContract(lonely, fresh, context))).length > 0)
})

test("a contract case that breaks says so with the contract broken prefix", async () => {
    const all = await results(storeContract(empty, empty))
    assert.ok(all.some((result) => result.error?.startsWith("contract broken: ") === true))
})

test("a store that mirrors on a merge import fails the merge case", async () => {
    const mirroring = (): Promise<StoreAdapter> => {
        const store = memoryStore({ id: "db" })
        return Promise.resolve({ ...store, import: (entries, options) => store.import(entries, { ...options, mode: "mirror" }) })
    }
    assert.ok(failing(await results(storeContract(fresh, mirroring))).includes("a merge leaves alone every key the entries do not name"))
})

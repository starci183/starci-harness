import { DatabaseStore } from "./database.adapter"

describe("DatabaseStore", () => {
    it("is the logical database store the stack declaration names", () => {
        const store = new DatabaseStore()

        expect([store.id, store.kind, store.level]).toEqual(["database", "database", "logical"])
    })

    it("describes a store that holds no set yet and says why it can do nothing", async () => {
        const store = new DatabaseStore()

        await expect(store.describe()).resolves.toEqual({
            sets: [],
            purposes: [],
            canExport: false,
            canImport: false,
            cannot: [{ what: "every set", reason: "the app declares its sets here" }],
        })
    })

    it("exports no entry", async () => {
        const store = new DatabaseStore()

        const first = await store.export()[Symbol.asyncIterator]().next()

        expect(first.done).toBe(true)
    })

    it("imports nothing and answers no identity", async () => {
        const store = new DatabaseStore()

        await expect(store.import()).resolves.toEqual({ sets: [], outcome: "unchanged" })
        await expect(store.identityOf()).resolves.toBeNull()
    })
})

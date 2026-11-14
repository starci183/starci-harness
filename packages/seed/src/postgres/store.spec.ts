import assert from "node:assert/strict"
import { test } from "node:test"
import { DataRefusal } from "../driver.ts"
import type { DataEntry } from "../manifest.ts"
import { blobEntry, recordEntry, recordValue } from "../manifest.ts"
import { storeContract } from "../testing/contract.ts"
import type { FakeDb } from "./fake.spec.ts"
import { fakeRunner, shopDb } from "./fake.spec.ts"
import { postgresStore } from "./store.ts"

const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

async function* from<T>(items: readonly T[]): AsyncIterable<T> {
    await Promise.resolve()
    yield* items
}

const make = (db: FakeDb, extra: Partial<Parameters<typeof postgresStore>[0]> = {}) => postgresStore({ id: "database", run: fakeRunner(db), ...extra })

/** A changed copy of an entry that stays a valid row: its first non-key text value gets a mark. */
const change = (entry: DataEntry): DataEntry => {
    const row = recordValue(entry) as Record<string, string | null>
    const name = Object.keys(row).find((key) => key === "name" || key === "role") ?? "tag"
    return recordEntry(entry.set, entry.key, { ...row, [name]: `${row[name] ?? ""}!` })
}

for (const item of storeContract(
    () => Promise.resolve(make(shopDb(true))),
    () => Promise.resolve(make(shopDb(false))),
    { change },
)) {
    test(`the fake database passes the store contract: ${item.name}`, async () => {
        await item.run()
    })
}

test("describes held tables sorted by name, record form, backup only, and says every table it cannot hold", async () => {
    const db = shopDb(true)
    db.tables.push(
        { schema: "public", name: "jobs", columns: [{ name: "id", type: "integer" }], pk: ["id"], rows: [] },
        { schema: "public", name: "log", columns: [{ name: "line", type: "text" }], pk: null, rows: [] },
        { schema: "public", name: "Odd Name", columns: [{ name: "id", type: "integer" }], pk: ["id"], rows: [] },
        { schema: "public", name: "gen", columns: [{ name: "id", type: "integer", generated: true }, { name: "v", type: "text" }], pk: ["id"], rows: [] },
        { schema: "public", name: "accounts_2026", columns: [{ name: "id", type: "integer" }], pk: ["id"], rows: [], partition: true },
        { schema: "other", name: "elsewhere", columns: [{ name: "id", type: "integer" }], pk: ["id"], rows: [] },
    )
    const description = await make(db, { exclude: [{ table: "public.jobs", reason: "a queue, rebuilt by the app" }] }).describe()
    assert.deepEqual(description.sets.map((set) => set.set), ["public.accounts", "public.memberships", "public.tags"])
    assert.ok(description.sets.every((set) => set.form === "record" && set.schema === `postgres/${set.set}@1`))
    assert.deepEqual(description.purposes, ["seed-backup"])
    assert.equal(description.canExport && description.canImport, true)
    assert.deepEqual(
        description.cannot.map((item) => item.what),
        [
            "export and import of table public.Odd Name",
            "export and import of table public.gen",
            "export and import of table public.jobs",
            "export and import of table public.log",
        ],
    )
    assert.match(description.cannot[2]?.reason ?? "", /a queue, rebuilt by the app/u)
    assert.match(description.cannot[3]?.reason ?? "", /no primary key/u)
    assert.match(description.cannot[1]?.reason ?? "", /generated column/u)
    assert.match(description.cannot[0]?.reason ?? "", /characters a set name cannot hold/u)
    const other = await make(db, { schemas: ["other"] }).describe()
    assert.deepEqual(other.sets.map((set) => set.set), ["other.elsewhere"])
    const ghost = await make(db, { exclude: [{ table: "public.ghost", reason: "gone" }] }).describe()
    assert.ok(ghost.cannot.some((item) => item.what.endsWith("public.ghost")))
})

test("exports a table in byte order of its keys, paged by keyset, every column as text, generated columns left out", async () => {
    const db = shopDb(true)
    db.reversePages = true
    const store = make(db, { pageRows: 2 })
    const entries = await collect(store.export({ sets: ["public.accounts"] }))
    assert.deepEqual(entries.map((entry) => entry.key), ["10", "2", "9"])
    const [, second] = entries
    assert.ok(second)
    assert.deepEqual(recordValue(second), { balance: "0.00", id: "2", name: "two" })
    assert.equal(db.log.filter((line) => line.marker === "page").length, 2)
    assert.deepEqual(db.log.filter((line) => line.marker === "page").map((line) => line.params), [[], ["2"]])
    assert.ok(db.log.every((line) => line.isolation === "repeatable read"))
    const all = await collect(store.export({}))
    assert.deepEqual(
        all.map((entry) => `${entry.set}/${entry.key}`),
        ["public.accounts/10", "public.accounts/2", "public.accounts/9", 'public.memberships/["a","a"]', 'public.memberships/["a","b"]', "public.tags/x"],
    )
    assert.deepEqual(await collect(make(shopDb(false)).export({})), [])
})

test("a page exactly as long as the page size is followed by one more query that comes back empty", async () => {
    const db = shopDb(true)
    const entries = await collect(make(db, { pageRows: 3 }).export({ sets: ["public.accounts"] }))
    assert.equal(entries.length, 3)
    assert.equal(db.log.filter((line) => line.marker === "page").length, 2)
})

test("a reader that stops early rolls the export back and the producer ends quietly, also when it is mid-query", async () => {
    const stopped = shopDb(true)
    for await (const entry of make(stopped, { pageRows: 1 }).export({})) {
        assert.equal(entry.set, "public.accounts")
        break
    }
    const slow = shopDb(true)
    let release: () => void = () => undefined
    slow.before = (marker, call) => (marker === "page" && call === 2 ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve())
    for await (const entry of make(slow, { pageRows: 1 }).export({})) {
        assert.equal(entry.key, "10")
        setTimeout(() => { release() }, 20)
        break
    }
})

test("a failing statement is a DATA_STORE_FAILED refusal naming the store, the table and the SQLSTATE, never the message", async () => {
    const db = shopDb(true)
    db.fail = (marker, table) => (marker === "page" && table === "public.memberships" ? Object.assign(new Error("duplicate key value violates unique constraint secret-value"), { code: "57014" }) : undefined)
    const seen = collect(make(db).export({}))
    await assert.rejects(seen, (error: unknown) => {
        assert.ok(error instanceof DataRefusal)
        assert.equal(error.code, "DATA_STORE_FAILED")
        assert.equal(error.retry, "configuration")
        assert.deepEqual(error.params, { store: "database", table: "public.memberships", cause: "Error 57014" })
        assert.doesNotMatch(JSON.stringify(error.params), /secret-value/u)
        return true
    })
    const broken = shopDb(true)
    broken.fail = (marker) => (marker === "catalog" ? new Error("down") : undefined)
    await assert.rejects(collect(make(broken).export({})), (error: unknown) => error instanceof DataRefusal && error.params.table === undefined)
    await assert.rejects(make(broken).describe(), (error: unknown) => error instanceof DataRefusal && error.params.cause === "Error")
})

test("an import upserts by primary key and counts created, updated and unchanged; a second import changes nothing", async () => {
    const source = shopDb(true)
    const entries = await collect(make(source).export({}))
    const target = shopDb(false)
    const store = make(target)
    const first = await store.import(from(entries), { dryRun: false, mode: "merge" })
    assert.equal(first.outcome, "applied")
    assert.deepEqual(first.sets.map((set) => [set.set, set.created, set.updated, set.unchanged]), [["public.accounts", 3, 0, 0], ["public.memberships", 2, 0, 0], ["public.tags", 1, 0, 0]])
    assert.ok(target.log.filter((line) => line.marker === "upsert").length === 6)
    assert.equal(target.log.find((line) => line.marker === "replica")?.isolation, "read committed")
    const second = await store.import(from(entries), { dryRun: false, mode: "merge" })
    assert.equal(second.outcome, "unchanged")
    assert.deepEqual(second.sets.map((set) => set.unchanged), [3, 2, 1])
    const edited = recordEntry("public.accounts", "2", { balance: "1.00", id: "2", name: "two" })
    const third = await store.import(from([edited]), { dryRun: false, mode: "merge" })
    assert.deepEqual(third.sets, [{ set: "public.accounts", created: 0, updated: 1, unchanged: 0, removed: 0, refused: [] }])
    assert.equal(target.tables[0]?.rows.find((row) => row.id === "2")?.balance, "1.00")
})

test("an import sets every sequence owned by a column of an imported table to the column's maximum; an empty table leaves it", async () => {
    const entries = await collect(make(shopDb(true)).export({}))
    const target = shopDb(false)
    await make(target).import(from(entries), { dryRun: false, mode: "merge" })
    assert.deepEqual(target.sequenceValues, { '"public"."accounts_id_seq"': 10 })
    const empty = shopDb(false)
    await make(empty).import(from([recordEntry("public.tags", "t", { tag: "t" })]), { dryRun: false, mode: "mirror" })
    assert.deepEqual(empty.sequenceValues, {})
    const none = shopDb(false)
    const accounts = none.tables[0]
    assert.ok(accounts !== undefined)
    await make(none).import(from([recordEntry("public.accounts", "5", { balance: null, id: "5", name: "five" })]), { dryRun: false, mode: "merge" })
    assert.deepEqual(none.sequenceValues, { '"public"."accounts_id_seq"': 5 })
    const gone = shopDb(true)
    await make(gone).import(from([]), { dryRun: false, mode: "mirror" })
    assert.equal(gone.tables[0]?.rows.length, 3)
})

test("a mirror deletes the keys of the imported sets the entries do not name, and only those sets", async () => {
    const target = shopDb(true)
    const entries = [recordEntry("public.memberships", JSON.stringify(["a", "a"]), { org: "a", role: "member", user: "a" })]
    const report = await make(target).import(from(entries), { dryRun: false, mode: "mirror" })
    assert.deepEqual(report.sets.map((set) => [set.set, set.removed, set.unchanged]), [["public.memberships", 1, 1]])
    assert.equal(report.outcome, "applied")
    assert.deepEqual(target.tables[1]?.rows, [{ org: "a", user: "a", role: "member" }])
    assert.equal(target.tables[0]?.rows.length, 3)
})

test("a dry run does every write inside the transaction, counts it, rolls back and moves no sequence", async () => {
    const entries = await collect(make(shopDb(true)).export({}))
    const target = shopDb(false)
    const report = await make(target).import(from(entries), { dryRun: true, mode: "mirror" })
    assert.equal(report.outcome, "applied")
    assert.equal(report.sets[0]?.created, 3)
    assert.ok(target.tables.every((table) => table.rows.length === 0))
    assert.deepEqual(target.sequenceValues, {})
    assert.equal(target.log.filter((line) => line.marker === "setval" || line.marker === "sequences").length, 0)
})

test("a set of an unknown or excluded table, and a row that is not a whole row of its table, is a refused key, not a throw", async () => {
    const db = shopDb(false)
    db.tables.push({ schema: "public", name: "jobs", columns: [{ name: "id", type: "integer" }], pk: ["id"], rows: [] })
    const store = make(db, { exclude: [{ table: "public.jobs", reason: "a queue" }] })
    const enc = new TextEncoder()
    const raw = (set: string, key: string, body: string): DataEntry => ({ ...recordEntry(set, key, null), body: enc.encode(body), sha256: "x" })
    const entries: DataEntry[] = [
        recordEntry("public.jobs", "1", { id: "1" }),
        recordEntry("public.nothing", "1", { id: "1" }),
        blobEntry("public.tags", "blob", new Uint8Array([1]), "application/octet-stream"),
        raw("public.tags", "bad-json", "{"),
        raw("public.tags", "array", "[]"),
        raw("public.tags", "null", "null"),
        recordEntry("public.tags", "extra", { other: "x", tag: "extra" }),
        recordEntry("public.tags", "short", {}),
        recordEntry("public.tags", "number", { tag: 1 }),
        recordEntry("public.tags", "wrong-key", { tag: "other" }),
        recordEntry("public.memberships", "not-json", { org: "a", role: "r", user: "b" }),
        recordEntry("public.memberships", '["a"]', { org: "a", role: "r", user: "b" }),
        recordEntry("public.memberships", "[1,2]", { org: "a", role: "r", user: "b" }),
        recordEntry("public.memberships", '{"a":"b"}', { org: "a", role: "r", user: "b" }),
        recordEntry("public.memberships", '["a","c"]', { org: "a", role: "r", user: "b" }),
        recordEntry("public.tags", "good", { tag: "good" }),
    ]
    const report = await store.import(from(entries), { dryRun: false, mode: "merge" })
    assert.equal(report.outcome, "partial")
    const refused = (set: string): string[] => (report.sets.find((item) => item.set === set)?.refused ?? []).map((item) => `${item.key}:${item.code}`)
    assert.deepEqual(refused("public.jobs"), ["1:DATA_TABLE_NOT_HELD"])
    assert.deepEqual(refused("public.nothing"), ["1:DATA_TABLE_NOT_HELD"])
    assert.equal(refused("public.tags").length, 8)
    assert.ok(refused("public.tags").every((line) => line.endsWith(":DATA_ROW_INVALID")))
    assert.equal(refused("public.memberships").length, 5)
    assert.equal(report.sets.find((item) => item.set === "public.tags")?.created, 1)
    assert.deepEqual(db.tables[2]?.rows, [{ tag: "good" }])
})

test("a mirror never deletes a key the entries name, even a refused one", async () => {
    const db = shopDb(true)
    const report = await make(db).import(from([recordEntry("public.tags", "x", { tag: "x", nope: "1" })]), { dryRun: false, mode: "mirror" })
    assert.equal(report.outcome, "partial")
    assert.equal(db.tables[2]?.rows.length, 1)
})

test("an import that needs the owner role fails as DATA_STORE_FAILED with the SQLSTATE, and writes nothing", async () => {
    const db = shopDb(false)
    db.fail = (marker) => (marker === "replica" ? Object.assign(new Error("permission denied to set parameter"), { code: "42501" }) : undefined)
    await assert.rejects(make(db).import(from([recordEntry("public.tags", "x", { tag: "x" })]), { dryRun: false, mode: "merge" }), (error: unknown) => error instanceof DataRefusal && error.params.cause === "Error 42501" && error.params.table === undefined)
    assert.equal(db.tables[2]?.rows.length, 0)
    const broken = shopDb(false)
    broken.fail = (marker) => (marker === "upsert" ? { code: "23505", name: "DatabaseError", table: "tags" } : undefined)
    await assert.rejects(make(broken).import(from([recordEntry("public.tags", "x", { tag: "x" })]), { dryRun: false, mode: "merge" }), (error: unknown) => error instanceof DataRefusal && error.params.cause === "DatabaseError 23505 on tags" && error.params.table === "public.tags")
})

test("a refusal thrown by the entry source passes through untouched", async () => {
    const refusal = new DataRefusal("DATA_COPY_CORRUPT", "configuration")
    const failing: AsyncIterable<DataEntry> = { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(refusal) }) }
    await assert.rejects(make(shopDb(false)).import(failing, { dryRun: false, mode: "merge" }), (error: unknown) => error === refusal)
})

test("identityOf is the key itself when the row exists, else null, for an unknown table and a key not of the table too", async () => {
    const store = make(shopDb(true))
    assert.equal(await store.identityOf("public.accounts", "9"), "9")
    assert.equal(await store.identityOf("public.accounts", "404"), null)
    assert.equal(await store.identityOf("public.memberships", '["a","b"]'), '["a","b"]')
    assert.equal(await store.identityOf("public.memberships", '["a","zzz"]'), null)
    assert.equal(await store.identityOf("public.memberships", "not json"), null)
    assert.equal(await store.identityOf("public.nothing", "1"), null)
    const broken = shopDb(true)
    broken.fail = (marker) => (marker === "exists" ? new Error("down") : undefined)
    await assert.rejects(make(broken).identityOf("public.accounts", "9"), (error: unknown) => error instanceof DataRefusal && error.params.table === "public.accounts")
})

test("a page size that is not a whole number of at least one is refused when the store is made", () => {
    assert.throws(() => make(shopDb(true), { pageRows: 0 }), TypeError)
    assert.throws(() => make(shopDb(true), { pageRows: 1.5 }), TypeError)
})

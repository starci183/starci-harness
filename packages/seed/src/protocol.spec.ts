import assert from "node:assert/strict"
import { test } from "node:test"
import type { DataEntry, Selection } from "./manifest.ts"
import { blobEntry, recordEntry } from "./manifest.ts"
import type { CommandRunner, ServeIo } from "./protocol.ts"
import { ANSWER_MARK, DATA_PROTOCOL, commandStore, decodeEntry, encodeEntry, protocolText, serveStore } from "./protocol.ts"
import type { ImportOptions, ImportReport, StoreAdapter } from "./store.ts"
import type { MemoryStore } from "./testing/memory.ts"
import { memoryStore } from "./testing/memory.ts"

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of items) out.push(item)
    return out
}

async function* linesFrom(lines: readonly string[]): AsyncIterable<string> {
    await Promise.resolve()
    yield* lines
}

async function* entriesFrom(entries: readonly DataEntry[]): AsyncIterable<DataEntry> {
    await Promise.resolve()
    yield* entries
}

/** Runs serveStore in memory with the given arguments and stdin lines; answers the exit code and the lines written. */
async function serve(store: StoreAdapter, args: readonly string[], input: readonly string[] = []): Promise<{ code: number; out: string[] }> {
    const out: string[] = []
    const io: ServeIo = { args, lines: linesFrom(input), write: (line) => { out.push(line) } }
    const code = await serveStore(store, io)
    assert.ok(out.every((line) => line.startsWith(ANSWER_MARK)), "every line a door writes is marked")
    return { code, out: out.map((line) => line.slice(ANSWER_MARK.length)) }
}

/** A command runner that is the app's command, served in memory. */
const runnerOver = (store: StoreAdapter): CommandRunner => async function* (args, input) {
    const out: string[] = []
    await serveStore(store, { args, lines: input ?? linesFrom([]), write: (line) => { out.push(line) } })
    yield* out
}

const seeded = (): MemoryStore =>
    memoryStore({ id: "db", sets: { products: { a: { n: 1 }, b: { n: 2 } }, images: { logo: new Uint8Array([0, 255, 7]) } } })

test("the protocol has one name", () => {
    assert.equal(DATA_PROTOCOL, "starci/data-entries@1")
})

test("encodeEntry and decodeEntry round-trip a record and a blob", () => {
    const record = recordEntry("products", "a", { n: 1, s: "é" })
    const blob = blobEntry("images", "logo", new Uint8Array([0, 255, 7]), "image/png")
    const recordLine = JSON.parse(encodeEntry(record)) as { body: string; form: string }
    assert.equal(recordLine.form, "record")
    assert.equal(recordLine.body, '{"n":1,"s":"é"}')
    assert.equal((JSON.parse(encodeEntry(blob)) as { body: string }).body, "AP8H")
    assert.deepEqual(decodeEntry(encodeEntry(record)), record)
    assert.deepEqual(decodeEntry(encodeEntry(blob)), blob)
})

test("decodeEntry refuses a body that does not match its sha256, for a record and for a blob", () => {
    for (const entry of [recordEntry("s", "k", 1), blobEntry("s", "k", new Uint8Array([1]), "x/y")]) {
        const line = JSON.parse(encodeEntry(entry)) as Record<string, string>
        const tampered = JSON.stringify({ ...line, sha256: "0".repeat(64) })
        assert.throws(() => decodeEntry(tampered), /s\/k: the body does not match its sha256/u)
    }
})

test("serveStore describe writes the description and answers 0", async () => {
    const { code, out } = await serve(seeded(), ["describe"])
    assert.equal(code, 0)
    assert.equal(out.length, 1)
    assert.deepEqual((JSON.parse(out[0] ?? "") as { sets: { set: string }[] }).sets.map((set) => set.set), ["images", "products"])
})

test("serveStore export writes one line per entry then the end line with the count", async () => {
    const { code, out } = await serve(seeded(), ["export", JSON.stringify({ sets: ["products"] } satisfies Selection)])
    assert.equal(code, 0)
    assert.equal(out.length, 3)
    assert.deepEqual(JSON.parse(out[2] ?? ""), { end: true, items: 2 })
    assert.equal(decodeEntry(out[0] ?? "").key, "a")
})

test("serveStore export without an argument exports every set", async () => {
    const { out } = await serve(seeded(), ["export"])
    assert.deepEqual(JSON.parse(out[out.length - 1] ?? ""), { end: true, items: 3 })
})

test("serveStore import reads entry lines, ignores blank lines and answers the report", async () => {
    const target = memoryStore({ id: "db" })
    const lines = [encodeEntry(recordEntry("products", "a", { n: 1 })), "", "   ", encodeEntry(recordEntry("products", "b", { n: 2 }))]
    const { code, out } = await serve(target, ["import", JSON.stringify({ dryRun: false, mode: "merge" } satisfies ImportOptions)], lines)
    assert.equal(code, 0)
    const report = JSON.parse(out[0] ?? "") as ImportReport
    assert.equal(report.outcome, "applied")
    assert.deepEqual(target.snapshot(), { products: { a: { n: 1 }, b: { n: 2 } } })
})

test("serveStore import without an argument is a merge dry run", async () => {
    const target = memoryStore({ id: "db" })
    const { out } = await serve(target, ["import"], [encodeEntry(recordEntry("s", "k", 1))])
    assert.equal((JSON.parse(out[0] ?? "") as ImportReport).outcome, "applied")
    assert.deepEqual(target.snapshot(), {})
})

test("serveStore identity answers the store's identity of a key, or null; missing arguments ask for the empty key", async () => {
    const store = seeded()
    const known = await serve(store, ["identity", "products", "a"])
    assert.deepEqual(JSON.parse(known.out[0] ?? ""), { identity: await store.identityOf("products", "a") })
    assert.notEqual((JSON.parse(known.out[0] ?? "") as { identity: string | null }).identity, null)
    assert.deepEqual(JSON.parse((await serve(store, ["identity", "products", "nope"])).out[0] ?? ""), { identity: null })
    assert.deepEqual(JSON.parse((await serve(store, ["identity"])).out[0] ?? ""), { identity: null })
    assert.deepEqual(JSON.parse((await serve(store, ["identity", "products"])).out[0] ?? ""), { identity: null })
})

test("serveStore answers usage and exit code 2 for an unknown verb or none", async () => {
    for (const args of [["frobnicate"], []]) {
        const { code, out } = await serve(seeded(), args)
        assert.equal(code, 2)
        assert.equal((JSON.parse(out[0] ?? "") as { error: string }).error, "DATA_PROTOCOL_USAGE")
    }
})

test("commandStore keeps what the declaration says and runs describe over the command", async () => {
    const source = seeded()
    const remote = commandStore({ id: "remote", kind: "storage", level: "physical" }, runnerOver(source))
    assert.equal(remote.id, "remote")
    assert.equal(remote.kind, "storage")
    assert.equal(remote.level, "physical")
    assert.deepEqual(await remote.describe(), await source.describe())
})

test("commandStore exports the entries the command writes and imports through its stdin", async () => {
    const source = seeded()
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, runnerOver(source))
    const exported = await collect(remote.export({}))
    assert.deepEqual(exported, await collect(source.export({})))
    const target = memoryStore({ id: "db" })
    const through = commandStore({ id: "remote", kind: "database", level: "logical" }, runnerOver(target))
    const report = await through.import(entriesFrom(exported), { dryRun: false, mode: "merge" })
    assert.equal(report.outcome, "applied")
    assert.deepEqual(target.snapshot(), source.snapshot())
})

test("commandStore asks identity of the command", async () => {
    const source = seeded()
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, runnerOver(source))
    assert.equal(await remote.identityOf("products", "a"), await source.identityOf("products", "a"))
    assert.equal(await remote.identityOf("products", "nope"), null)
})

test("commandStore ignores blank lines of the command's output", async () => {
    const entry = recordEntry("s", "k", 1)
    const run: CommandRunner = async function* () {
        await Promise.resolve()
        yield ""
        yield encodeEntry(entry)
        yield "  "
        yield JSON.stringify({ end: true, items: 1 })
    }
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, run)
    assert.deepEqual(await collect(remote.export({})), [entry])
})

test("commandStore refuses an end line whose count differs from the entries that arrived", async () => {
    const run: CommandRunner = () => linesFrom([encodeEntry(recordEntry("s", "k", 1)), JSON.stringify({ end: true, items: 2 })])
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, run)
    await assert.rejects(() => collect(remote.export({})), /remote: the command counted 2 entries, 1 arrived/u)
    const noCount: CommandRunner = () => linesFrom([JSON.stringify({ end: true })])
    await assert.rejects(() => collect(commandStore({ id: "remote", kind: "database", level: "logical" }, noCount).export({})), /counted undefined entries, 0 arrived/u)
})

test("commandStore refuses an export that ends without its end line", async () => {
    const run: CommandRunner = () => linesFrom([encodeEntry(recordEntry("s", "k", 1))])
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, run)
    await assert.rejects(() => collect(remote.export({})), /the export ended without its end line/u)
})

test("commandStore refuses an entry whose body does not match its hash", async () => {
    const line = JSON.parse(encodeEntry(recordEntry("s", "k", 1))) as Record<string, string>
    const run: CommandRunner = () => linesFrom([JSON.stringify({ ...line, sha256: "0".repeat(64) }), JSON.stringify({ end: true, items: 1 })])
    await assert.rejects(() => collect(commandStore({ id: "remote", kind: "database", level: "logical" }, run).export({})), /does not match its sha256/u)
})

test("protocolText reads a marked line, an unmarked JSON object line until a line is marked, and leaves log lines out", () => {
    assert.equal(protocolText(`${ANSWER_MARK}{"a":1}`, false), '{"a":1}')
    assert.equal(protocolText(`${ANSWER_MARK}{"a":1}`, true), '{"a":1}')
    assert.equal(protocolText(' {"a":1} ', false), '{"a":1}')
    assert.equal(protocolText('{"a":1}', true), null)
    assert.equal(protocolText("[Nest] 123 - LOG [NestApplication] shutdown", false), null)
    assert.equal(protocolText("{not json", false), null)
})

test("commandStore reads the answer of a door whose app framework logs before and after it (a NestJS CLI at shutdown)", async () => {
    const source = seeded()
    const noisy: CommandRunner = async function* (args, input) {
        yield "[Nest] 4242  - LOG [NestFactory] Starting Nest application..."
        yield '{"level":"info","msg":"a JSON log line before the answer"}'
        yield* runnerOver(source)(args, input)
        yield "[Nest] 4242  - LOG [NestApplication] Nest application successfully stopped"
        yield '{"level":"info","msg":"a JSON log line after the answer"}'
    }
    const remote = commandStore({ id: "remote", kind: "database", level: "logical" }, noisy)
    assert.deepEqual(await remote.describe(), await source.describe())
    assert.equal(await remote.identityOf("products", "a"), await source.identityOf("products", "a"))
    assert.deepEqual(await collect(remote.export({})), await collect(source.export({})))
    const target = memoryStore({ id: "db" })
    const report = await commandStore({ id: "remote", kind: "database", level: "logical" }, async function* (args, input) {
        yield* runnerOver(target)(args, input)
        yield "[Nest] 4242  - LOG [NestApplication] Nest application successfully stopped"
    }).import(entriesFrom(await collect(source.export({}))), { dryRun: false, mode: "merge" })
    assert.equal(report.outcome, "applied")
})

test("commandStore still reads a door that marks no line (built on @starci/seed before 0.3.0) by its JSON object lines", async () => {
    const entry = recordEntry("s", "k", 1)
    const legacy: CommandRunner = () => linesFrom(["booting", encodeEntry(entry), JSON.stringify({ end: true, items: 1 }), "bye"])
    assert.deepEqual(await collect(commandStore({ id: "remote", kind: "database", level: "logical" }, legacy).export({})), [entry])
})

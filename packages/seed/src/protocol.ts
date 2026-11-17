import type { DataEntry, Selection } from "./manifest.ts"
import { sha256Hex } from "./manifest.ts"
import type { ImportOptions, ImportReport, StoreAdapter, StoreDescription } from "./store.ts"
import type { StoreKind, StoreLevel } from "./words.ts"

/**
 * The line protocol `starci/data-entries@1` between the harness and an app's store command: newline-delimited JSON.
 *
 *   <argv> describe                  -> one line: StoreDescription
 *   <argv> export <Selection JSON>   -> one line per entry, then {"end": true, "items": n}
 *   <argv> import <ImportOptions>    <- entry lines on stdin; -> last line: ImportReport
 *   <argv> identity <set> <key>      -> one line: {"identity": string | null}
 *
 * A record's body travels as its canonical JSON text, a blob's as base64. A value never reaches argv or a log.
 *
 * Every protocol line `serveStore` writes starts with ANSWER_MARK, so the harness reads the protocol out of a stdout an app framework also logs
 * to, before or after the answer (a NestJS CLI that logs at shutdown). The harness reads the marked lines; a door that marks none (a door built
 * on @starci/seed before 0.3.0) is read by its JSON object lines, any other line being a log line.
 */
export const DATA_PROTOCOL = "starci/data-entries@1"

/** The prefix of every protocol line a door writes: the protocol's name and one space. */
export const ANSWER_MARK = `${DATA_PROTOCOL} `

/** The protocol text of one stdout line: a marked line without its mark, an unmarked JSON object line as it is, a log line null. */
export function protocolText(line: string, marked: boolean): string | null {
    if (line.startsWith(ANSWER_MARK)) return line.slice(ANSWER_MARK.length)
    if (marked) return null
    const text = line.trim()
    if (!text.startsWith("{")) return null
    try {
        JSON.parse(text)
        return text
    } catch {
        return null
    }
}

/** One entry as a protocol line. */
export interface EntryLine {
    /** The set. */
    readonly set: string
    /** The natural key. */
    readonly key: string
    /** record or blob. */
    readonly form: DataEntry["form"]
    /** The media type. */
    readonly media: string
    /** sha256 of the body. */
    readonly sha256: string
    /** The canonical JSON text of a record, the base64 of a blob. */
    readonly body: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

/** The protocol line of an entry. */
export function encodeEntry(entry: DataEntry): string {
    const body = entry.form === "record" ? decoder.decode(entry.body) : Buffer.from(entry.body).toString("base64")
    const line: EntryLine = { set: entry.set, key: entry.key, form: entry.form, media: entry.media, sha256: entry.sha256, body }
    return JSON.stringify(line)
}

/** The entry of a protocol line; a body that does not match its sha256 is refused. */
export function decodeEntry(text: string): DataEntry {
    const line = JSON.parse(text) as EntryLine
    const body = line.form === "record" ? encoder.encode(line.body) : new Uint8Array(Buffer.from(line.body, "base64"))
    if (sha256Hex(body) !== line.sha256) throw new TypeError(`${line.set}/${line.key}: the body does not match its sha256`)
    return { set: line.set, key: line.key, form: line.form, media: line.media, body, sha256: line.sha256 }
}

/** What the app's command reads and writes. */
export interface ServeIo {
    /** The arguments after the command's own: `describe`, `export <json>` or `import <json>`. */
    readonly args: readonly string[]
    /** stdin, line by line (only `import` reads it). */
    readonly lines: AsyncIterable<string>
    /** Writes one line to stdout. */
    readonly write: (line: string) => void
}

async function* entriesFromLines(lines: AsyncIterable<string>): AsyncIterable<DataEntry> {
    for await (const line of lines) if (line.trim() !== "") yield decodeEntry(line)
}

/** Serves one store over the protocol from an app's command; answers the exit code. Every line it writes carries ANSWER_MARK. */
export async function serveStore(store: StoreAdapter, served: ServeIo): Promise<number> {
    const io: ServeIo = { ...served, write: (line) => { served.write(`${ANSWER_MARK}${line}`) } }
    const [verb, argument] = io.args
    if (verb === "describe") {
        io.write(JSON.stringify(await store.describe()))
        return 0
    }
    if (verb === "export") {
        const selection = JSON.parse(argument ?? "{}") as Selection
        let items = 0
        for await (const entry of store.export(selection)) {
            io.write(encodeEntry(entry))
            items += 1
        }
        io.write(JSON.stringify({ end: true, items }))
        return 0
    }
    if (verb === "import") {
        const options = JSON.parse(argument ?? '{"dryRun":true,"mode":"merge"}') as ImportOptions
        io.write(JSON.stringify(await store.import(entriesFromLines(io.lines), options)))
        return 0
    }
    if (verb === "identity") {
        io.write(JSON.stringify({ identity: await store.identityOf(argument ?? "", io.args[2] ?? "") }))
        return 0
    }
    io.write(JSON.stringify({ error: "DATA_PROTOCOL_USAGE", usage: "describe | export <selection> | import <options> | identity <set> <key>" }))
    return 2
}

/** Runs the app's command with extra arguments and optional stdin lines; yields its stdout lines. */
export type CommandRunner = (args: readonly string[], input?: AsyncIterable<string>) => AsyncIterable<string>

/**
 * The protocol lines of a command's stdout: its marked lines when it marks any (a JSON log line before the first one is dropped), else, at
 * its end, its JSON object lines; log lines are left out.
 */
async function* protocolLines(lines: AsyncIterable<string>): AsyncIterable<string> {
    let marked = false
    const held: string[] = []
    for await (const line of lines) {
        if (line.startsWith(ANSWER_MARK)) marked = true
        const text = protocolText(line, marked)
        if (text === null || text.trim() === "") continue
        if (marked) {
            held.length = 0
            yield text
        } else held.push(text)
    }
    yield* held
}

/** The answer of a command: its last protocol line, whatever the app logged before or after it. */
async function lastLine(lines: AsyncIterable<string>): Promise<string> {
    let last = ""
    for await (const line of protocolLines(lines)) last = line
    return last
}

async function* linesOf(entries: AsyncIterable<DataEntry>): AsyncIterable<string> {
    for await (const entry of entries) yield encodeEntry(entry)
}

/** A store reached through an app's command: the harness side of the protocol. */
export function commandStore(declared: { readonly id: string; readonly kind: StoreKind; readonly level: StoreLevel }, run: CommandRunner): StoreAdapter {
    return {
        ...declared,
        describe: async () => JSON.parse(await lastLine(run(["describe"]))) as StoreDescription,
        async *export(selection: Selection) {
            let items = 0
            let ended = false
            for await (const line of protocolLines(run(["export", JSON.stringify(selection)]))) {
                const parsed = JSON.parse(line) as { end?: boolean; items?: number }
                if (parsed.end === true) {
                    if (parsed.items !== items) throw new TypeError(`${declared.id}: the command counted ${String(parsed.items)} entries, ${String(items)} arrived`)
                    ended = true
                    continue
                }
                yield decodeEntry(line)
                items += 1
            }
            if (!ended) throw new TypeError(`${declared.id}: the export ended without its end line`)
        },
        identityOf: async (set: string, key: string) => (JSON.parse(await lastLine(run(["identity", set, key]))) as { identity: string | null }).identity,
        import: async (entries: AsyncIterable<DataEntry>, options: ImportOptions) =>
            JSON.parse(await lastLine(run(["import", JSON.stringify(options)], linesOf(entries)))) as ImportReport,
    }
}

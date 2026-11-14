import { createHash } from "node:crypto"
import type { DataPurpose, EntryForm } from "./words.ts"

/** One unit of content. The same content always yields the same entry, byte for byte. */
export interface DataEntry {
    /** The set it belongs to: an entity of a database store, a bucket of a storage store, a part of a dump. kebab-case. */
    readonly set: string
    /** The natural key, unique in its set; never a database id or a workspace id. Entries are ordered by (set, key) in UTF-8 byte order. */
    readonly key: string
    /** `record` (canonical JSON) or `blob` (opaque bytes). */
    readonly form: EntryForm
    /** The media type: `application/json` for a record, the stored content type for a blob. */
    readonly media: string
    /** The content. */
    readonly body: Uint8Array
    /** Lower-case hex sha256 of `body`. */
    readonly sha256: string
}

/** What one set of an export holds. Two copies hold the same set exactly when their digests are equal. */
export interface DataSetSummary {
    /** The store the set was read from. */
    readonly store: string
    /** The set. */
    readonly set: string
    /** `<format>/<set>@<major>` for a record set, `blob@1` for a blob set. */
    readonly schema: string
    /** The form of every entry of the set. */
    readonly form: EntryForm
    /** How many entries. */
    readonly items: number
    /** The plaintext bytes of all entries. */
    readonly bytes: number
    /** sha256 over the sorted lines `<key>\t<sha256>\n`: independent of driver, sealing and sharding. */
    readonly digest: string
}

/** Where an export was taken. */
export interface DataSource {
    /** The project `hfs.json` names. */
    readonly project: string
    /** The environment of the stack manifest the stores belong to. */
    readonly environment: string
    /** The release the environment ran, when known. */
    readonly release?: string
}

/** The plaintext manifest of one export. It holds no value of any entry. */
export interface DataManifest {
    /** The schema of this document. */
    readonly schema: "starci/data-manifest@1"
    /** `<copy name>@<major>`, e.g. `nivo-lite-seed-standard@1`, the repository name and the format major. */
    readonly format: string
    /** Why it was taken. */
    readonly purpose: DataPurpose
    /** ISO time it was taken. */
    readonly takenAt: string
    /** Where it was taken. */
    readonly source: DataSource
    /** Sorted by (store, set). */
    readonly sets: readonly DataSetSummary[]
    /** sha256 of the canonical JSON of `sets` (takenAt and source excluded): the identity copies are compared on. */
    readonly exportDigest: string
}

/** The fields of a manifest the caller states; the sets and the digest are computed from the entries. */
export type ManifestHeader = Omit<DataManifest, "exportDigest" | "sets" | "schema">

/** What a selection reads: whole sets, optionally narrowed by a scope the store understands (a workspace for a seed). */
export interface Selection {
    /** The sets to read; every set of the store when absent. */
    readonly sets?: readonly string[]
    /** A narrowing the store understands, e.g. `{ workspace: "nivo-web" }`. */
    readonly scope?: Readonly<Record<string, string>>
}

/** The JSON a record body may hold. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

/** Lower-case hex sha256 of bytes or of a UTF-8 string. */
export function sha256Hex(content: Uint8Array | string): string {
    return createHash("sha256").update(typeof content === "string" ? encoder.encode(content) : content).digest("hex")
}

/** Compares two strings by their UTF-8 bytes, the one order every set and key list uses. */
export function byteOrder(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function canonical(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("a record holds no NaN or Infinity")
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (typeof value === "object") {
        const keys = Object.keys(value).sort(byteOrder)
        const fields = keys.flatMap((key) => {
            const item = (value as Record<string, unknown>)[key]
            return item === undefined ? [] : [`${JSON.stringify(key)}:${canonical(item)}`]
        })
        return `{${fields.join(",")}}`
    }
    throw new TypeError(`a record holds no ${typeof value}`)
}

/** The canonical JSON text of a value: keys sorted by byte order, no insignificant whitespace, undefined fields dropped. */
export function canonicalJson(value: unknown): string {
    return canonical(value)
}

/** A record entry of `value`, its body the canonical JSON. */
export function recordEntry(set: string, key: string, value: JsonValue): DataEntry {
    const body = encoder.encode(canonicalJson(value))
    return { set, key, form: "record", media: "application/json", body, sha256: sha256Hex(body) }
}

/** A blob entry of `body`. */
export function blobEntry(set: string, key: string, body: Uint8Array, media: string): DataEntry {
    return { set, key, form: "blob", media, body, sha256: sha256Hex(body) }
}

/** The value of a record entry. */
export function recordValue(entry: DataEntry): JsonValue {
    if (entry.form !== "record") throw new TypeError(`${entry.set}/${entry.key} is a blob, not a record`)
    return JSON.parse(decoder.decode(entry.body)) as JsonValue
}

/** True when the entry's sha256 is the hash of its body. */
export function entryIntact(entry: DataEntry): boolean {
    return sha256Hex(entry.body) === entry.sha256
}

/** The digest of a set: sha256 over the sorted lines `<key>\t<sha256>\n`. */
export function setDigest(items: readonly { readonly key: string; readonly sha256: string }[]): string {
    const lines = [...items].sort((left, right) => byteOrder(left.key, right.key)).map((item) => `${item.key}\t${item.sha256}\n`)
    return sha256Hex(lines.join(""))
}

/** The identity of an export: sha256 of the canonical JSON of its sets. */
export function exportDigestOf(sets: readonly DataSetSummary[]): string {
    return sha256Hex(canonicalJson(sets))
}

/** The schema id of a set: `<format without @major>/<set>@<major>` for records, `blob@1` for blobs. */
export function setSchemaOf(format: string, set: string, form: EntryForm): string {
    if (form === "blob") return "blob@1"
    const at = format.lastIndexOf("@")
    return at < 0 ? `${format}/${set}@1` : `${format.slice(0, at)}/${set}${format.slice(at)}`
}

/** One set's running summary while its entries stream past. */
interface Tally {
    readonly store: string
    readonly set: string
    readonly form: EntryForm
    readonly items: { readonly key: string; readonly sha256: string }[]
    bytes: number
}

/**
 * Builds summaries from entries as they pass, refusing an entry whose hash does not match its body, a key repeated in
 * its set, or a set whose entries mix forms.
 */
export class ManifestBuilder {
    private readonly tallies = new Map<string, Tally>()

    /** Counts one entry of `store`. */
    add(store: string, entry: DataEntry): void {
        if (!entryIntact(entry)) throw new TypeError(`${store}/${entry.set}/${entry.key}: sha256 does not match the body`)
        const id = `${store}\u0000${entry.set}`
        const tally = this.tallies.get(id) ?? { store, set: entry.set, form: entry.form, items: [], bytes: 0 }
        if (tally.form !== entry.form) throw new TypeError(`${store}/${entry.set} mixes records and blobs`)
        if (tally.items.some((item) => item.key === entry.key)) throw new TypeError(`${store}/${entry.set}/${entry.key} is repeated`)
        tally.items.push({ key: entry.key, sha256: entry.sha256 })
        tally.bytes += entry.body.byteLength
        this.tallies.set(id, tally)
    }

    /** The finished manifest. */
    build(header: ManifestHeader): DataManifest {
        const sets = [...this.tallies.values()]
            .map((tally): DataSetSummary => ({
                store: tally.store,
                set: tally.set,
                schema: setSchemaOf(header.format, tally.set, tally.form),
                form: tally.form,
                items: tally.items.length,
                bytes: tally.bytes,
                digest: setDigest(tally.items),
            }))
            .sort((left, right) => byteOrder(left.store, right.store) || byteOrder(left.set, right.set))
        return { schema: "starci/data-manifest@1", ...header, sets, exportDigest: exportDigestOf(sets) }
    }
}

/** The reasons a manifest document is not a valid `starci/data-manifest@1`, empty when it is. */
export function manifestProblems(document: unknown): readonly string[] {
    const problems: string[] = []
    if (typeof document !== "object" || document === null || Array.isArray(document)) return ["the manifest is not an object"]
    const value = document as Record<string, unknown>
    if (value.schema !== "starci/data-manifest@1") problems.push("schema is not starci/data-manifest@1")
    if (typeof value.format !== "string" || !/^[a-z0-9][a-z0-9-]*@\d+$/u.test(value.format)) problems.push("format is not <name>@<major>")
    if (!["seed-standard", "seed-backup"].includes(String(value.purpose))) problems.push("purpose is not seed-standard or seed-backup")
    if (typeof value.takenAt !== "string") problems.push("takenAt is missing")
    if (!Array.isArray(value.sets)) return [...problems, "sets is not a list"]
    const sets = value.sets as (DataSetSummary | null)[]
    for (const set of sets) {
        if (typeof set?.store !== "string" || typeof set.set !== "string" || typeof set.digest !== "string" || !Number.isInteger(set.items))
            problems.push(`a set entry is incomplete: ${JSON.stringify(set)}`)
    }
    if (problems.length === 0 && value.exportDigest !== exportDigestOf(sets as DataSetSummary[])) problems.push("exportDigest does not match the sets")
    return problems
}

import { gunzipSync, gzipSync } from "node:zlib"
import { Refusal } from "../../shared/errors.js"

const BLOCK = 512
const SIZE_AT = 124
const SIZE_LENGTH = 12
const CHECKSUM_AT = 148
const CHECKSUM_LENGTH = 8
const MANIFEST = "package/package.json"
const MANIFEST_PATH = "package.json"
const SPACE = 0x20

const field = (header: Buffer, start: number, length: number): string => {
    const text = header.subarray(start, start + length).toString("utf8")
    const end = text.indexOf("\0")
    return end === -1 ? text : text.slice(0, end)
}

/** A header whose size and checksum say a body of `size` bytes follows. */
const resized = (header: Buffer, size: number): Buffer => {
    const next = Buffer.from(header)
    next.fill(0, SIZE_AT, SIZE_AT + SIZE_LENGTH)
    next.write(`${size.toString(8).padStart(SIZE_LENGTH - 1, "0")}\0`, SIZE_AT, "latin1")
    next.fill(SPACE, CHECKSUM_AT, CHECKSUM_AT + CHECKSUM_LENGTH)
    const sum = next.reduce((total, byte) => total + byte, 0)
    next.write(`${sum.toString(8).padStart(CHECKSUM_LENGTH - 2, "0")}\0 `, CHECKSUM_AT, "latin1")
    return next
}

const padded = (body: Buffer): Buffer => Buffer.concat([body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK)])

/** An entry's path inside the package (`package/` taken off), the ustar prefix field joined when the name was split. */
const entryPath = (header: Buffer): string => {
    const prefix = field(header, 345, 155)
    const name = field(header, 0, 100)
    const full = prefix === "" ? name : `${prefix}/${name}`
    return full.startsWith("package/") ? full.slice("package/".length) : full
}

/**
 * An npm tarball whose text entries `edit` rewrites: it is called with each file's path inside the package (`package.json`,
 * `runtime/knowledge/hfs/canon-pins.yaml`) and its text, and returns the new text or undefined to keep the entry byte for byte.
 * Returns the archive and the paths it edited. A package is published from the tarball `npm pack` made in its own folder, with
 * these files changed in memory, so no committed file is ever written.
 */
export const withEntries = (archive: Buffer, edit: (path: string, text: string) => string | undefined): { readonly archive: Buffer; readonly edited: readonly string[] } => {
    const tar = gunzipSync(archive)
    const parts: Buffer[] = []
    const edited: string[] = []
    let offset = 0
    while (offset + BLOCK <= tar.length) {
        const header = tar.subarray(offset, offset + BLOCK)
        if (header.every((byte) => byte === 0)) break
        const size = Number.parseInt(field(header, SIZE_AT, SIZE_LENGTH).trim() || "0", 8)
        const body = tar.subarray(offset + BLOCK, offset + BLOCK + size)
        offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
        const type = field(header, 156, 1)
        const next = type === "" || type === "0" ? edit(entryPath(header), body.toString("utf8")) : undefined
        if (next === undefined) {
            parts.push(Buffer.from(header), padded(Buffer.from(body)))
            continue
        }
        const text = Buffer.from(next, "utf8")
        parts.push(resized(header, text.length), padded(text))
        edited.push(entryPath(header))
    }
    return { archive: gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2)])), edited }
}

/**
 * An npm tarball with its `package/package.json` replaced by `edit` of its text, and each other text entry `others` rewrites (undefined
 * keeps it); every other entry is copied byte for byte. PUBLISH_LOCAL_TARBALL_UNREADABLE when the archive holds no manifest.
 */
export const withManifest = (archive: Buffer, edit: (text: string) => string, others: (path: string, text: string) => string | undefined = () => undefined): Buffer => {
    const done = withEntries(archive, (path, text) => (path === MANIFEST_PATH ? edit(text) : others(path, text)))
    if (!done.edited.includes(MANIFEST_PATH)) throw new Refusal("PUBLISH_LOCAL_TARBALL_UNREADABLE", `the packed tarball holds no ${MANIFEST}`)
    return done.archive
}

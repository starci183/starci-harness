import { gunzipSync, gzipSync } from "node:zlib"
import { Refusal } from "../../shared/errors.js"

const BLOCK = 512
const SIZE_AT = 124
const SIZE_LENGTH = 12
const CHECKSUM_AT = 148
const CHECKSUM_LENGTH = 8
const MANIFEST = "package/package.json"
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

/**
 * An npm tarball with its `package/package.json` replaced by `edit` of its text; every other entry is copied byte for byte. A
 * package is published from the tarball `npm pack` made in its own folder (its lifecycle scripts ran there), with the one manifest
 * line changed in memory, so the version in git is never written. PUBLISH_LOCAL_TARBALL_UNREADABLE when the archive holds no manifest.
 */
export const withManifest = (archive: Buffer, edit: (text: string) => string): Buffer => {
    const tar = gunzipSync(archive)
    const parts: Buffer[] = []
    let offset = 0
    let found = false
    while (offset + BLOCK <= tar.length) {
        const header = tar.subarray(offset, offset + BLOCK)
        if (header.every((byte) => byte === 0)) break
        const size = Number.parseInt(field(header, SIZE_AT, SIZE_LENGTH).trim() || "0", 8)
        const body = tar.subarray(offset + BLOCK, offset + BLOCK + size)
        offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
        if (field(header, 0, 100) === MANIFEST && field(header, 156, 1) !== "x") {
            const edited = Buffer.from(edit(body.toString("utf8")), "utf8")
            parts.push(resized(header, edited.length), padded(edited))
            found = true
        } else parts.push(Buffer.from(header), padded(Buffer.from(body)))
    }
    if (!found) throw new Refusal("PUBLISH_LOCAL_TARBALL_UNREADABLE", `the packed tarball holds no ${MANIFEST}`)
    return gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2)]))
}

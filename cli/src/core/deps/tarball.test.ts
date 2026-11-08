// A package is published from its packed tarball with the manifest rewritten in memory: the version in git is never written.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { gunzipSync, gzipSync } from "node:zlib"
import { withManifest } from "./tarball.js"

const header = (name: string, size: number): Buffer => {
    const block = Buffer.alloc(512)
    block.write(name, 0, "utf8")
    block.write("0000644\0", 100, "latin1")
    block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1")
    block.write("0", 156, "latin1")
    block.fill(0x20, 148, 156)
    const sum = block.reduce((total, byte) => total + byte, 0)
    block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1")
    return block
}

const entry = (name: string, body: string): Buffer => {
    const bytes = Buffer.from(body)
    return Buffer.concat([header(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}

const archive = (files: Record<string, string>): Buffer => gzipSync(Buffer.concat([...Object.entries(files).map(([name, body]) => entry(name, body)), Buffer.alloc(1024)]))

const filesOf = (gz: Buffer): Record<string, string> => {
    const tar = gunzipSync(gz)
    const found: Record<string, string> = {}
    let offset = 0
    while (offset + 512 <= tar.length && tar[offset] !== 0) {
        const name = tar.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/s, "")
        const size = Number.parseInt(tar.subarray(offset + 124, offset + 135).toString("latin1"), 8)
        found[name] = tar.subarray(offset + 512, offset + 512 + size).toString("utf8")
        offset += 512 + Math.ceil(size / 512) * 512
    }
    return found
}

void test("only the manifest changes; the other entries stay byte for byte", () => {
    const long = "x".repeat(1500)
    const manifest = '{"name":"@starci/x","version":"1.0.0"}'
    const packed = archive({ "package/README.md": "readme", "package/package.json": manifest, "package/dist/big.js": long })
    const files = filesOf(withManifest(packed, (text) => text.replace("1.0.0", "1.0.1")))
    assert.equal(files["package/package.json"], '{"name":"@starci/x","version":"1.0.1"}')
    assert.equal(files["package/README.md"], "readme")
    assert.equal(files["package/dist/big.js"], long)
    const grown = filesOf(withManifest(packed, (text) => `${text}${" ".repeat(900)}`))
    assert.equal(grown["package/package.json"]?.length, manifest.length + 900)
    assert.equal(grown["package/dist/big.js"], long)
})

void test("a tarball without a manifest is refused", () => {
    assert.throws(
        () => withManifest(archive({ "package/a.js": "1" }), (text) => text),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PUBLISH_LOCAL_TARBALL_UNREADABLE",
    )
})

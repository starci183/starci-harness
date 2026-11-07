// The tarball name read from `npm pack --json`, whose stdout also carries what the package's lifecycle scripts printed.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { packedFilename } from "./publish-local.js"

const report = JSON.stringify([{ id: "@starci/grammar@0.25.2", filename: "starci-grammar-0.25.2.tgz", files: [{ path: "dist/index.js" }] }], null, 2)

void test("the pack report is read after what a prepack script printed", () => {
    assert.equal(packedFilename(report), "starci-grammar-0.25.2.tgz")
    assert.equal(packedFilename(`dist/.build-stamp.json: @starci/grammar@0.25.2 sha256:dc9cfebb96ab\n${report}\n`), "starci-grammar-0.25.2.tgz")
    assert.equal(packedFilename(`[\nnot json\n${report}`), "starci-grammar-0.25.2.tgz")
})

void test("a stdout with no pack report names no tarball", () => {
    assert.equal(packedFilename(""), undefined)
    assert.equal(packedFilename("npm error code E404\n[\n"), undefined)
    assert.equal(packedFilename("[]"), undefined)
})

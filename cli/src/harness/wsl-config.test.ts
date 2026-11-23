// The WSL reclaim key is merged into .wslconfig, never clobbering it: appended as a section when there is none, added under an existing section,
// set in place when it has another value, left alone when it is already set, with the file's line endings kept.
import assert from "node:assert/strict"
import test from "node:test"
import { mergeWslConfig } from "./wsl-config.js"

void test("an empty file gets the section", () => {
    assert.deepEqual(mergeWslConfig(""), { text: "[experimental]\nautoMemoryReclaim=dropcache\n", changed: true, was: null })
})

void test("other sections and keys are kept, the section appended", () => {
    const merged = mergeWslConfig("[wsl2]\r\nmemory=32GB\r\nswap=0\r\n")
    assert.equal(merged.text, "[wsl2]\r\nmemory=32GB\r\nswap=0\r\n\r\n[experimental]\r\nautoMemoryReclaim=dropcache\r\n")
})

void test("an existing section gets the key; another value is set in place; the same value changes nothing", () => {
    assert.equal(mergeWslConfig("[experimental]\nsparseVhd=true\n[wsl2]\nmemory=8GB\n").text, "[experimental]\nautoMemoryReclaim=dropcache\nsparseVhd=true\n[wsl2]\nmemory=8GB\n")
    const set = mergeWslConfig("[Experimental]\nautoMemoryReclaim = gradual\n")
    assert.equal(set.text, "[Experimental]\nautoMemoryReclaim=dropcache\n")
    assert.equal(set.was, "gradual")
    assert.equal(mergeWslConfig("[experimental]\nautoMemoryReclaim=dropcache\n").changed, false)
})

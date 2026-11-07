// The version a package is published under in the local registry: the next number of its own `-local` series, never the version in git.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { isLocalVersion, latestLocal, localVersionOf, nextLocalNumber } from "./local-version.js"

void test("a stable version publishes as its next patch with a local number, a prerelease keeps its own series", () => {
    assert.equal(localVersionOf("6.0.4", 1), "6.0.5-local.1")
    assert.equal(localVersionOf("0.25.0", 12), "0.25.1-local.12")
    assert.equal(localVersionOf("1.1.0-alpha.85", 3), "1.1.0-alpha.85.local.3")
})

void test("the number is one above the highest of the same series the registry holds, 1 for the first", () => {
    assert.equal(nextLocalNumber("6.0.4", ["6.0.4", "6.0.5"]), 1)
    assert.equal(nextLocalNumber("6.0.4", ["6.0.4", "6.0.5-local.1", "6.0.5-local.2", "6.0.5-local.10"]), 11)
    assert.equal(nextLocalNumber("6.0.4", ["6.1.0-local.7", "7.0.1-local.3"]), 1)
    assert.equal(nextLocalNumber("1.1.0-alpha.85", ["1.1.0-alpha.85.local.1", "1.1.0-alpha.84.local.9"]), 2)
})

void test("a local version is recognised, a released one is not", () => {
    assert.equal(isLocalVersion("6.0.5-local.1"), true)
    assert.equal(isLocalVersion("1.1.0-alpha.85.local.2"), true)
    assert.equal(isLocalVersion("6.0.5"), false)
    assert.equal(isLocalVersion("1.1.0-alpha.85"), false)
})

void test("the latest local version is the one published last", () => {
    const times = { created: "2026-01-01T00:00:00Z", "6.0.4": "2026-02-01T00:00:00Z", "6.0.5-local.1": "2026-03-01T00:00:00Z", "6.0.5-local.2": "2026-03-02T00:00:00Z", "5.9.9-local.4": "2026-03-01T00:00:00Z" }
    assert.equal(latestLocal(times), "6.0.5-local.2")
    assert.equal(latestLocal({ "6.0.4": "2026-02-01T00:00:00Z" }), undefined)
})

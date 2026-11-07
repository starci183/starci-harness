// A peer range admits the version an app installs: a canon peering hfs ~6.0.0 against the pinned hfs 6.1.0 is refused before it publishes.
import assert from "node:assert/strict"
import test from "node:test"
import { peerAdmits, peerSkews } from "./peer-range.js"

const row = (name: string, version: string, action: string) => ({ package: name, version, action })
const pkg = (name: string, peers: Record<string, string>) => ({ name, peers })

void test("peerAdmits judges exact, ~, ^, >= and *, and leaves any other spelling alone", () => {
    assert.equal(peerAdmits("~6.0.0", "6.1.0"), false)
    assert.equal(peerAdmits("~6.1.0", "6.1.1"), true)
    assert.equal(peerAdmits("6.1.0", "6.1.1"), false)
    assert.equal(peerAdmits("^6.0.0", "6.1.0"), true)
    assert.equal(peerAdmits("^6.0.0", "7.0.0"), false)
    assert.equal(peerAdmits(">=9", "10.0.0"), undefined)
    assert.equal(peerAdmits(">=9.0.0", "8.9.9"), false)
    assert.equal(peerAdmits("*", "1.0.0"), true)
    assert.equal(peerAdmits("1 || 2", "1.0.0"), undefined)
})

void test("a package to publish whose peer excludes the pinned sibling is named", () => {
    const rows = [row("@starci/eslint-canon-be", "3.19.4", "publish"), row("@starci/hfs", "6.1.1", "publish")]
    const packages = [pkg("@starci/eslint-canon-be", { "@starci/hfs": "~6.0.0", eslint: ">=9" }), pkg("@starci/hfs", {})]
    const pins = { "@starci/hfs": "6.1.1", "@starci/eslint-canon-be": "3.19.4" }
    assert.deepEqual(peerSkews(rows, packages, pins), ["@starci/eslint-canon-be@3.19.4 peers @starci/hfs ~6.0.0, which excludes 6.1.1"])
    assert.deepEqual(peerSkews(rows, [pkg("@starci/eslint-canon-be", { "@starci/hfs": "~6.1.0" }), pkg("@starci/hfs", {})], pins), [])
})

void test("a pinned package already served is judged too, and an unpinned served one is not", () => {
    const rows = [row("@starci/eslint-canon-fe", "9.16.3", "published"), row("@starci/other", "1.0.0", "published"), row("@starci/hfs", "6.1.0", "published")]
    const packages = [pkg("@starci/eslint-canon-fe", { "@starci/hfs": "~6.0.0" }), pkg("@starci/other", { "@starci/hfs": "~6.0.0" }), pkg("@starci/hfs", {})]
    const pins = { "@starci/hfs": "6.1.0", "@starci/eslint-canon-fe": "9.16.3" }
    assert.deepEqual(peerSkews(rows, packages, pins), ["@starci/eslint-canon-fe@9.16.3 peers @starci/hfs ~6.0.0, which excludes 6.1.0"])
})

void test("a peer the plan publishes at another version than its pin is judged at both, and a private package is not judged", () => {
    const rows = [row("@starci/a", "1.0.0", "publish"), row("@starci/hfs", "6.2.0", "publish"), row("@starci/p", "1.0.0", "private")]
    const packages = [pkg("@starci/a", { "@starci/hfs": "~6.1.0" }), pkg("@starci/hfs", {}), pkg("@starci/p", { "@starci/hfs": "~5.0.0" })]
    assert.deepEqual(peerSkews(rows, packages, { "@starci/hfs": "6.1.0" }), ["@starci/a@1.0.0 peers @starci/hfs ~6.1.0, which excludes 6.2.0"])
})

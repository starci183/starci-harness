// A cli-follow commit (publish.yml) moves only the CLI's version and @starci requirements: its ci run has nothing left to test or publish.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { FOLLOW_FILES, sameBesidesFollow } from "./affected.js"

void test("a cli-follow commit moves only the CLI's version and requirements", () => {
    const before = { name: "starci-harness", version: "1.1.0-alpha.104", scripts: { build: "tsc" }, dependencies: { "@starci/hfs": "6.5.1" } }
    assert.equal(sameBesidesFollow(before, { ...before, version: "1.1.0-alpha.105", dependencies: { "@starci/hfs": "6.5.2" } }), true)
    assert.equal(sameBesidesFollow(before, { ...before, scripts: { build: "tsc && node x.js" } }), false)
    assert.equal(sameBesidesFollow(before, { ...before, bin: { starci: "dist/main.js" } }), false)
    assert.equal(sameBesidesFollow(before, null), false)
})

void test("the files of a cli-follow commit are the CLI's manifest, its lockfile and the changelog", () => {
    assert.deepEqual([...FOLLOW_FILES].toSorted((left, right) => left.localeCompare(right)), ["CHANGELOG.md", "cli/package-lock.json", "cli/package.json"])
})

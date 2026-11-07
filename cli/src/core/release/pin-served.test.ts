// A version raised in a package.json is published, never skipped for an unchanged content; a pin names a version the plan publishes or npm serves.
import assert from "node:assert/strict"
import test from "node:test"
import { unservedPins } from "./pin-served.js"

const served = (...names: string[]) => (name: string, version: string) => Promise.resolve(names.includes(`${name}@${version}`))

void test("a pin at the version the plan publishes, or at a version npm serves, is installable; any other pin is named", async () => {
    const rows = [
        { package: "@starci/heroicons", version: "0.3.6", action: "publish" },
        { package: "@starci/tsconfig", version: "2.1.1", action: "published" },
        { package: "@starci/test-world", version: "1.3.5", action: "published" },
    ]
    const pins = { "@starci/heroicons": "0.3.6", "@starci/tsconfig": "2.1.1", "@starci/test-world": "1.3.5" }
    assert.deepEqual(await unservedPins(rows, pins, served("@starci/tsconfig@2.1.1", "@starci/test-world@1.3.5")), [])
    assert.deepEqual(await unservedPins(rows, pins, served("@starci/tsconfig@2.1.1")), ["@starci/test-world@1.3.5"])
    assert.deepEqual(await unservedPins(rows, { "@starci/heroicons": "0.3.5" }, served()), ["@starci/heroicons@0.3.5"])
})

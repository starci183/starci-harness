import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Refusal } from "../shared/errors.js"
import { loadPolicy, locatePolicy } from "./policy.js"

const copyOfPolicy = (): string => {
    const folder = mkdtempSync(join(tmpdir(), "starci-policy-"))
    cpSync(locatePolicy(), folder, { recursive: true })
    return folder
}

void test("quality.yaml carries no gate key: the policy loads and app check has no error limit", () => {
    const folder = copyOfPolicy()
    try {
        const policy = loadPolicy(undefined, folder)
        assert.equal("gate" in policy.quality, false)
    } finally {
        rmSync(folder, { recursive: true, force: true })
    }
})

void test("a quality.yaml that sets gate.errorLimit is refused with a message that says there is no limit", () => {
    const folder = copyOfPolicy()
    try {
        const file = join(folder, "quality.yaml")
        writeFileSync(file, `${readFileSync(file, "utf8")}\ngate:\n  errorLimit: 20\n`)
        assert.throws(() => loadPolicy(undefined, folder), (error: unknown) => {
            assert.ok(error instanceof Refusal)
            assert.equal(error.code, "POLICY_INVALID")
            assert.match(error.message, /quality\.yaml has no `gate`: `starci app check` is green only with zero error findings/u)
            return true
        })
    } finally {
        rmSync(folder, { recursive: true, force: true })
    }
})

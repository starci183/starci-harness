// What `release push` judges in the harness repository: only a harness checkout is judged, and a dangling anchor refuses the push
// with PUSH_ANCHORS_RED. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { isHarnessCheckout, judgeHarnessPush } from "./push-gate.js"

const harness = (readme: string, then: (root: string) => Promise<void>): Promise<void> => {
    const root = mkdtempSync(join(tmpdir(), "starci-push-gate-"))
    for (const dir of ["cli", "contexts", "packages"]) mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, "cli", "package.json"), "{}")
    writeFileSync(join(root, "contexts", "README.md"), readme)
    writeFileSync(join(root, "contexts", "other.md"), "# Other\n\nText.\n")
    return then(root).finally(() => { rmSync(root, { recursive: true, force: true }); })
}

void test("a repository without the CLI, contexts and packages is not a harness checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-push-gate-"))
    try {
        assert.equal(isHarnessCheckout(root), false)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a dangling anchor in the pushed tree refuses the push", () =>
    harness("# Contexts\n\nSee [other](other.md#no-such-heading).\n", async (root) => {
        assert.equal(isHarnessCheckout(root), true)
        await assert.rejects(judgeHarnessPush(root, "0".repeat(40), null), (error: unknown) => error instanceof Error && "code" in error && error.code === "PUSH_ANCHORS_RED")
    }))

void test("a tree whose anchors all resolve passes the judgement", () =>
    harness("# Contexts\n\nSee [other](other.md#other).\n", async (root) => {
        const said = await judgeHarnessPush(root, "0".repeat(40), null)
        assert.match(said, /anchors green/)
    }))

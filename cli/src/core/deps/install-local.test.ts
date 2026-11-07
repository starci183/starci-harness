// The app side of the local registry: the argument forms, the pin edits an install and its restore make, and the refusal of the removed overlay.
// Real files in a scratch folder with the state base pointed at a temp folder; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { projectDir } from "../../harness/ledger.js"
import { captureGitSync } from "../../shared/git.js"
import { parseRequested, withPin } from "./install-local.js"
import { clearOverlayRecord, refuseRecordedOverlay } from "./overlay-refusal.js"

void test("a package argument is a name, scoped or not, with an optional local version", () => {
    assert.deepEqual(parseRequested("grammar"), { name: "@starci/grammar", version: undefined })
    assert.deepEqual(parseRequested("@starci/grammar"), { name: "@starci/grammar", version: undefined })
    assert.deepEqual(parseRequested("hfs@6.0.5-local.2"), { name: "@starci/hfs", version: "6.0.5-local.2" })
    assert.deepEqual(parseRequested("@starci/hfs@6.0.5-local.2"), { name: "@starci/hfs", version: "6.0.5-local.2" })
})

void test("a pin is raised in the file's own indent and line ending, and put back to the exact original text", () => {
    const original = '{\n    "name": "app",\n    "dependencies": {\n        "@starci/grammar": "0.25.0"\n    }\n}\n'
    const raised = withPin(original, "dependencies", "@starci/grammar", "0.25.1-local.1")
    assert.equal(raised, original.replace("0.25.0", "0.25.1-local.1"))
    assert.equal(withPin(raised, "dependencies", "@starci/grammar", "0.25.0"), original)
    const crlf = original.replaceAll("\n", "\r\n")
    assert.equal(withPin(crlf, "dependencies", "@starci/grammar", "0.25.1-local.1"), crlf.replace("0.25.0", "0.25.1-local.1"))
})

void test("an override an install added is removed again, with the emptied overrides field", () => {
    const original = '{\n  "name": "app"\n}\n'
    const added = withPin(original, "overrides", "@starci/hfs", "6.0.5-local.1")
    assert.match(added, /"overrides": \{\s+"@starci\/hfs": "6\.0\.5-local\.1"\s+\}/u)
    assert.equal(withPin(added, "overrides", "@starci/hfs", null), original)
})

const scratch = (t: { after: (fn: () => void) => void }): string => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-overlay-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const root = join(base, "app")
    mkdirSync(root, { recursive: true })
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], base).exitCode, 0)
    return root
}

void test("a project that still records the removed overlay is refused with one message that names the registry flow; restore clears the record", (t) => {
    const root = scratch(t)
    refuseRecordedOverlay(root)
    writeFileSync(join(projectDir(root), "deps-local.json"), '{"schema":"starci/deps-local@1","packages":[]}\n')
    assert.throws(
        () => {
            refuseRecordedOverlay(root)
        },
        (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPS_OVERLAY_REMOVED" && error.message.includes("deps install-local --restore") && error.message.includes("deps publish-local --execute"),
    )
    assert.equal(clearOverlayRecord(root), true)
    refuseRecordedOverlay(root)
    assert.equal(clearOverlayRecord(root), false)
})

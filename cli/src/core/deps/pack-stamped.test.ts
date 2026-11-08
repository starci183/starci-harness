// The source digest a packed harness package carries: equal for the local-registry build and the npm build of one source, different when the source differs.
// Real files in a scratch git repository; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { SOURCE_FIELD, sourceDigest, withSource } from "./pack-stamped.js"

const repository = (t: { after: (fn: () => void) => void }, files: Record<string, string>): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-source-digest-")))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], root).exitCode, 0)
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), text)
    }
    assert.equal(captureGitSync(["add", "-A"], root).exitCode, 0)
    assert.equal(captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one"], root).exitCode, 0)
    return root
}

const SOURCE = { "packages/x/package.json": '{\n  "name": "@starci/x",\n  "version": "1.0.0"\n}\n', "packages/x/src/a.ts": "export const a = 1\n", "packages/y/src/b.ts": "export const b = 1\n" }

void test("one source digests the same in two checkouts, whatever sits beside the package, and a source change digests differently", async (t) => {
    const first = repository(t, SOURCE)
    const second = repository(t, { ...SOURCE, "packages/y/src/b.ts": "export const b = 2\n" })
    const third = repository(t, { ...SOURCE, "packages/x/src/a.ts": "export const a = 2\n" })
    const digest = await sourceDigest(first, "packages/x")
    assert.match(digest, /^[0-9a-f]{64}$/u)
    assert.equal(await sourceDigest(second, "packages/x"), digest)
    assert.notEqual(await sourceDigest(third, "packages/x"), digest)
})

void test("a file the work tree changed never claims the digest of the commit it started from", async (t) => {
    const root = repository(t, SOURCE)
    const clean = await sourceDigest(root, "packages/x")
    writeFileSync(join(root, "packages/x/src/a.ts"), "export const a = 3\n")
    const dirty = await sourceDigest(root, "packages/x")
    assert.notEqual(dirty, clean)
    writeFileSync(join(root, "packages/x/src/a.ts"), "export const a = 1\n")
    assert.equal(await sourceDigest(root, "packages/x"), clean)
})

void test("the local build and the npm build of one source carry one version and one digest, the npm build also its commit", () => {
    const committed = JSON.stringify({ name: "@starci/x", version: "1.0.0", dependencies: { "@starci/y": "1.0.0" } }, null, 2) + "\n"
    const digest = "b".repeat(64)
    const local: unknown = JSON.parse(withSource(committed, digest))
    const npm: unknown = JSON.parse(withSource(committed, digest, "abc123"))
    assert.deepEqual(local, { name: "@starci/x", version: "1.0.0", dependencies: { "@starci/y": "1.0.0" }, [SOURCE_FIELD]: digest })
    assert.deepEqual(npm, { name: "@starci/x", version: "1.0.0", dependencies: { "@starci/y": "1.0.0" }, gitHead: "abc123", [SOURCE_FIELD]: digest })
})

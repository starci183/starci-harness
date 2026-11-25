// The source digest a packed harness package carries: equal for the local-registry build and the npm build of one source, different when the source differs.
// Real files in a scratch git repository; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { SOURCE_FIELD, SOURCE_PARTS_FIELD, SOURCE_SPLITS, sourceDigest, withSource } from "./pack-stamped.js"
import { sourceDigestParts } from "./packages.js"

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

const PINS = [{ name: "canon-pins", file: "data/pins.yaml" }] as const
const PARTED = { "packages/x/package.json": "{}\n", "packages/x/src/a.ts": "export const a = 1\n", "packages/x/data/pins.yaml": "pins: 1\n", "packages/y/data/pins.yaml": "other: 1\n" }

void test("the source digest in parts: a data file moves its own part and the whole, never the core; any other file moves the core and never the data part", async (t) => {
    const original = repository(t, PARTED)
    const base = await sourceDigestParts(original, "packages/x", PINS)
    const whole = await sourceDigest(original, "packages/x")
    const pins = repository(t, { ...PARTED, "packages/x/data/pins.yaml": "pins: 2\n" })
    const moved = await sourceDigestParts(pins, "packages/x", PINS)
    assert.equal(moved.core, base.core, "a pins-only change leaves the core as it was")
    assert.notEqual(moved["canon-pins"], base["canon-pins"])
    assert.notEqual(await sourceDigest(pins, "packages/x"), whole, "the whole digest still moves: the publish judgement republishes a data change")
    const code = repository(t, { ...PARTED, "packages/x/src/a.ts": "export const a = 2\n" })
    const edited = await sourceDigestParts(code, "packages/x", PINS)
    assert.notEqual(edited.core, base.core)
    assert.equal(edited["canon-pins"], base["canon-pins"], "a code change leaves the data part as it was")
    const beside = repository(t, { ...PARTED, "packages/y/data/pins.yaml": "other: 2\n" })
    assert.deepEqual(await sourceDigestParts(beside, "packages/x", PINS), base, "a file of another package is no part of this one")
    const missing = await sourceDigestParts(repository(t, { "packages/x/src/a.ts": "export const a = 1\n" }), "packages/x", PINS)
    assert.equal(missing["canon-pins"], "absent")
})

void test("a data file the work tree changed is named by its bytes, so a dirty build never claims the digest of its commit", async (t) => {
    const root = repository(t, PARTED)
    const clean = await sourceDigestParts(root, "packages/x", PINS)
    writeFileSync(join(root, "packages/x/data/pins.yaml"), "pins: 9\n")
    const dirty = await sourceDigestParts(root, "packages/x", PINS)
    assert.notEqual(dirty["canon-pins"], clean["canon-pins"])
    assert.equal(dirty.core, clean.core)
    writeFileSync(join(root, "packages/x/data/pins.yaml"), "pins: 1\n")
    assert.deepEqual(await sourceDigestParts(root, "packages/x", PINS), clean)
})

void test("the packed manifest carries the parts beside the whole digest, and none when the package splits no file", () => {
    const committed = JSON.stringify({ name: "@starci/hfs", version: "1.0.0" }, null, 2) + "\n"
    const parts = { core: "c".repeat(64), "canon-pins": "d".repeat(64) }
    const stamped: unknown = JSON.parse(withSource(committed, "b".repeat(64), undefined, parts))
    assert.deepEqual(stamped, { name: "@starci/hfs", version: "1.0.0", [SOURCE_FIELD]: "b".repeat(64), [SOURCE_PARTS_FIELD]: parts })
    assert.equal(SOURCE_PARTS_FIELD in (JSON.parse(withSource(committed, "b".repeat(64))) as object), false)
})

void test("@starci/hfs splits its pin data into the part the check cache keys apart, and the file is where the cache says it is", () => {
    assert.deepEqual(SOURCE_SPLITS["@starci/hfs"], [{ name: "canon-pins", file: "runtime/knowledge/hfs/canon-pins.yaml" }])
    assert.equal(existsSync(join(import.meta.dirname, "..", "..", "..", "..", "packages", "hfs", "runtime", "knowledge", "hfs", "canon-pins.yaml")), true, "the split names a file the package tracks")
})

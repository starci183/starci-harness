// What CI's publish run relies on: tarballs packed once after the tests are published as they are (stamped, not rebuilt), up to four at a time,
// and a cli-follow commit is published from before it is pushed. Real files in a scratch git repository; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { gunzipSync, gzipSync } from "node:zlib"
import { captureGitSync } from "../../shared/git.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { SOURCE_FIELD, stampArchive, tarballName } from "../deps/pack-stamped.js"
import { onMainOrFollowsIt, pooled } from "./publish.js"

const header = (name: string, size: number): Buffer => {
    const block = Buffer.alloc(512)
    block.write(name, 0, "utf8")
    block.write("0000644\0", 100, "latin1")
    block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1")
    block.write("0", 156, "latin1")
    block.fill(0x20, 148, 156)
    const sum = block.reduce((total, byte) => total + byte, 0)
    block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1")
    return block
}
const entry = (name: string, body: string): Buffer => {
    const bytes = Buffer.from(body)
    return Buffer.concat([header(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}
const archive = (files: Record<string, string>): Buffer => gzipSync(Buffer.concat([...Object.entries(files).map(([name, body]) => entry(name, body)), Buffer.alloc(1024)]))

interface Cleanup {
    after: (fn: () => void) => void
}
const scratch = (t: Cleanup): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "starci-publish-tarballs-")))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    return dir
}
const run = (cwd: string, ...args: string[]): string => {
    const result = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd)
    assert.equal(result.exitCode, 0, result.stderr)
    return result.stdout.trim()
}
const commit = (root: string, files: Record<string, string>, message: string): string => {
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), text)
    }
    run(root, "add", "-A")
    run(root, "commit", "-q", "-m", message)
    return run(root, "rev-parse", "HEAD")
}

void test("npm pack names a scoped tarball without the scope's @ and slash", () => {
    assert.equal(tarballName("@starci/hfs", "6.5.2"), "starci-hfs-6.5.2.tgz")
    assert.equal(tarballName("starci-harness", "1.1.0-alpha.105"), "starci-harness-1.1.0-alpha.105.tgz")
})

void test("pooled never runs more than the limit at once, starts items in order and finishes them all", async () => {
    let active = 0
    let peak = 0
    const started: number[] = []
    await pooled([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (item) => {
        started.push(item)
        active += 1
        peak = Math.max(peak, active)
        await new Promise((done) => setTimeout(done, 5 + (item % 3)))
        active -= 1
    })
    assert.equal(peak, 4)
    assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.equal(active, 0)
    await pooled([], 4, () => Promise.reject(new Error("no item to work on")))
})

void test("a packed tarball is stamped with the source digest and the commit, its other files untouched", async (t) => {
    const root = scratch(t)
    run(root, "init", "-q", "-b", "main")
    commit(root, { "packages/x/package.json": '{"name":"@starci/x","version":"1.0.0"}\n', "packages/x/src/a.ts": "export const a = 1\n" }, "one")
    const packed = join(scratch(t), "starci-x-1.0.0.tgz")
    writeFileSync(packed, archive({ "package/package.json": '{"name":"@starci/x","version":"1.0.0"}\n', "package/dist/a.js": "built\n" }))
    const pkg = { name: "@starci/x", version: "1.0.0", relativeDir: "packages/x", dir: join(root, "packages/x") } as unknown as WorkspacePackage
    const out = scratch(t)
    const stamped = await stampArchive({ pkg, root, archive: packed, scratch: out, name: "stamped-1.0.0.tgz", gitHead: "c".repeat(40) })
    const tar = gunzipSync(readFileSync(stamped)).toString("utf8")
    assert.match(tar, new RegExp(`"${SOURCE_FIELD}": "[0-9a-f]{64}"`, "u"))
    assert.match(tar, /"gitHead": "c{40}"/u)
    assert.match(tar, /built\n/u)
})

void test("a commit on the remote main, or the one cli-follow commit on its tip, may be published; nothing else", async (t) => {
    const root = scratch(t)
    run(root, "init", "-q", "-b", "main")
    const tip = commit(root, { "cli/package.json": '{"version":"1.0.0"}\n', "CHANGELOG.md": "# Changelog\n", "src/a.ts": "a\n" }, "tip")
    run(root, "update-ref", "refs/remotes/origin/main", tip)
    assert.equal(await onMainOrFollowsIt(root, tip), true)

    const follow = commit(root, { "cli/package.json": '{"version":"1.0.1"}\n', "CHANGELOG.md": "# Changelog\n\n## 1.0.1\n" }, "follow")
    assert.equal(await onMainOrFollowsIt(root, follow), true)

    const stray = commit(root, { "cli/package.json": '{"version":"1.0.2"}\n', "src/a.ts": "b\n" }, "also touches source")
    assert.equal(await onMainOrFollowsIt(root, stray), false)

    const second = commit(root, { "CHANGELOG.md": "# Changelog\n\n## 1.0.2\n" }, "two commits above the tip")
    assert.equal(await onMainOrFollowsIt(root, second), false)
})

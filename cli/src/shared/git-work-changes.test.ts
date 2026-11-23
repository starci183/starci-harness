import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { trackedChanges, trackedWorkChanges } from "./git.js"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" })

void test("a gate's rewrite of the committed check cache is no work, an edited source file is", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "starci-work-changes-"))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    git(root, "init", "-q", "-b", "dev")
    mkdirSync(join(root, ".starcistacks", "cache", "check", "types"), { recursive: true })
    writeFileSync(join(root, ".starcistacks", "cache", "check", "types", "root.jsonl"), "a\n")
    writeFileSync(join(root, "page.ts"), "export {}\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    writeFileSync(join(root, ".starcistacks", "cache", "check", "types", "root.jsonl"), "b\n")
    assert.deepEqual(await trackedChanges(root), [".starcistacks/cache/check/types/root.jsonl"])
    assert.deepEqual(await trackedWorkChanges(root), [])
    writeFileSync(join(root, "page.ts"), "export const x = 1\n")
    assert.deepEqual(await trackedWorkChanges(root), ["page.ts"])
})

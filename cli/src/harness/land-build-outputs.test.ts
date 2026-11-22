// The lander clears its worktree's build outputs before each batch: `git clean -fd` keeps ignored files, so the compiled tests of an aborted
// batch (cli/dist/**/*.test.js) ran again in the next gate and turned it red. A scratch git repository stands in for the lander's worktree.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../shared/git.js"
import { clearBuildOutputs, isBuildOutput } from "./land-batch.js"

void test("a build output is an ignored dist folder or tsbuildinfo file, never inside node_modules", () => {
    assert.equal(isBuildOutput("cli/dist/"), true)
    assert.equal(isBuildOutput("packages/hfs/dist/"), true)
    assert.equal(isBuildOutput("cli/tsconfig.tsbuildinfo"), true)
    assert.equal(isBuildOutput("node_modules/"), false)
    assert.equal(isBuildOutput("cli/node_modules/x/dist/"), false)
    assert.equal(isBuildOutput("dist.txt"), false)
    assert.equal(isBuildOutput(".runtime/"), false)
})

void test("the stale compiled tests of an aborted batch are deleted, node_modules and tracked files are kept", async (t) => {
    const wt = realpathSync(mkdtempSync(join(tmpdir(), "starci-lander-outputs-")))
    t.after(() => {
        rmSync(wt, { recursive: true, force: true })
    })
    const write = (file: string, text = "x"): void => {
        mkdirSync(join(wt, file, ".."), { recursive: true })
        writeFileSync(join(wt, file), text)
    }
    assert.equal(captureGitSync(["init", "-q", "-b", "main", wt], tmpdir()).exitCode, 0)
    write(".gitignore", "node_modules/\ndist/\n*.tsbuildinfo\n.runtime/\n")
    write("cli/src/a.ts")
    assert.equal(captureGitSync(["add", "-A"], wt).exitCode, 0)
    write("cli/dist/core/stale.test.js", "throw new Error('a test of an aborted batch')")
    write("packages/hfs/dist/main.js")
    write("cli/tsconfig.tsbuildinfo")
    write("cli/node_modules/pkg/dist/index.js")
    write(".runtime/cache.json")
    const removed = await clearBuildOutputs(wt)
    assert.deepEqual(removed.toSorted((left, right) => left.localeCompare(right)), ["cli/dist/", "cli/tsconfig.tsbuildinfo", "packages/hfs/dist/"])
    assert.equal(existsSync(join(wt, "cli", "dist")), false)
    assert.equal(existsSync(join(wt, "packages", "hfs", "dist")), false)
    assert.equal(existsSync(join(wt, "cli", "node_modules", "pkg", "dist", "index.js")), true)
    assert.equal(existsSync(join(wt, ".runtime", "cache.json")), true)
    assert.equal(existsSync(join(wt, "cli", "src", "a.ts")), true)
})

// `starci release cut --from <sha>`: the fixed sha is cut in its own temporary worktree, removed again whatever the cut did, and the
// checkout it is called from (the app's dev checkout) never moves. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { inReleaseWorktree } from "./cut.js"

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

const repo = (t: { after: (fn: () => void) => void }): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-cut-from-")))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    gitIn(root, "init", "-q", "-b", "dev")
    writeFileSync(join(root, "package.json"), '{"name":"app","version":"1.0.0"}\n')
    gitIn(root, "add", ".")
    gitIn(root, "commit", "-q", "-m", "release 1.0.0")
    return root
}

void test("the fixed sha is cut in a temporary worktree at that sha; the checkout keeps its HEAD and its uncommitted work", async (t) => {
    const root = repo(t)
    const release = gitIn(root, "rev-parse", "HEAD")
    writeFileSync(join(root, "package.json"), '{"name":"app","version":"1.1.0-dev"}\n')
    gitIn(root, "commit", "-q", "-am", "dev moves on")
    const dev = gitIn(root, "rev-parse", "HEAD")
    writeFileSync(join(root, "wip.txt"), "uncommitted\n")
    let seen = ""
    const version = await inReleaseWorktree(root, release, (tree) => {
        seen = tree
        assert.equal(gitIn(tree, "rev-parse", "HEAD"), release)
        return Promise.resolve((JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as { version: string }).version)
    })
    assert.equal(version, "1.0.0")
    assert.equal(existsSync(seen), false, "the worktree is removed after the cut")
    assert.equal(gitIn(root, "rev-parse", "HEAD"), dev, "the dev checkout did not move")
    assert.equal(readFileSync(join(root, "wip.txt"), "utf8"), "uncommitted\n")
    assert.doesNotMatch(gitIn(root, "worktree", "list"), /starci-release-/u)
})

void test("a cut that fails still removes its worktree", async (t) => {
    const root = repo(t)
    const release = gitIn(root, "rev-parse", "HEAD")
    let seen = ""
    await assert.rejects(inReleaseWorktree(root, release, (tree) => {
        seen = tree
        return Promise.reject(new Error("CUT_NO_NOTES"))
    }), /CUT_NO_NOTES/u)
    assert.equal(existsSync(seen), false)
    assert.doesNotMatch(gitIn(root, "worktree", "list"), /starci-release-/u)
})

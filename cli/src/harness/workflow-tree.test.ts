// A lane step is satisfied only by work on the tree being judged (onThisTree), and a workflow forks from its header's base (harnessWorktree).
// Real git in a scratch repository, the state base pointed at a temp folder; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../shared/git.js"
import { harnessWorktree } from "./kernel.js"
import { onThisTree } from "./lanes.js"

const git = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, run.stderr)
    return run.stdout.trim()
}

const commit = (root: string, file: string): string => {
    writeFileSync(join(root, file), file)
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", file)
    return git(root, "rev-parse", "HEAD")
}

/** A scratch repository on main with one commit, and a state base for the ledger registry. */
const scratch = (t: { after: (fn: () => void) => void }): { readonly root: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-tree-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const root = join(base, "app")
    mkdirSync(root, { recursive: true })
    git(base, "init", "-q", "-b", "main", root)
    commit(root, "init.txt")
    return { root }
}

void test("a done task of a stopped workflow on an archive branch satisfies nothing of another workflow; its own and an ancestor's do", (t) => {
    const { root } = scratch(t)
    const landedOnMain = commit(root, "main-work.txt")
    git(root, "checkout", "-q", "-b", "archive/auth-sign-in")
    const landedOnArchive = commit(root, "archive-work.txt")
    git(root, "checkout", "-q", "main")
    const place = { repo: root, db: undefined, requires: [], workflowId: "auth-sign-in-v2", base: "main" }
    assert.equal(onThisTree(place, { workflow_id: "auth-sign-in", settle_commit: landedOnArchive }), false, "work on a branch the base does not hold")
    assert.equal(onThisTree(place, { workflow_id: "auth-sign-in", settle_commit: null }), false, "a task that landed nothing proves nothing about this tree")
    assert.equal(onThisTree(place, { workflow_id: "earlier", settle_commit: landedOnMain }), true, "work the base holds")
    assert.equal(onThisTree(place, { workflow_id: "auth-sign-in-v2", settle_commit: null }), true, "the workflow's own task")
    assert.equal(onThisTree({ repo: root, db: undefined, requires: [], base: "no-such-ref" }, { workflow_id: "earlier", settle_commit: landedOnMain }), false, "an unknown base holds nothing")
    assert.equal(onThisTree({ repo: root, db: undefined, requires: [] }, { workflow_id: "earlier", settle_commit: landedOnMain }), true, "the base defaults to HEAD")
})

void test("a workflow's worktree forks from its base, not from HEAD, and a missing base is refused before anything is made", async (t) => {
    const { root } = scratch(t)
    git(root, "branch", "harness-1.2")
    const forked = commit(root, "later.txt")
    const made = await harnessWorktree(root, "wf-base", "harness-1.2")
    assert.equal(made.created, true)
    assert.equal(made.branch, "starci/wf-base")
    assert.equal(git(made.path, "rev-parse", "HEAD"), git(root, "rev-parse", "harness-1.2"))
    assert.notEqual(git(made.path, "rev-parse", "HEAD"), forked)
    assert.equal(existsSync(join(made.path, "later.txt")), false)
    await assert.rejects(harnessWorktree(root, "wf-missing", "no-such-base"), { code: "WORKFLOW_BASE_MISSING" })
    assert.equal(git(root, "branch", "--list", "starci/wf-missing"), "", "no branch is made for a refused base")
    const head = await harnessWorktree(root, "wf-head")
    assert.equal(git(head.path, "rev-parse", "HEAD"), forked, "the default base is HEAD")
})

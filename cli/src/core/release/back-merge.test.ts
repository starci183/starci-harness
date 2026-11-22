// A release train lands dev on main and publish.yml may add the cli-follow commit on main; `release back-merge` brings main back into dev at once, so the two
// lines never drift (core/release/back-merge.ts). Dry until --execute.
import assert from "node:assert/strict"
import test from "node:test"
import { backMerge, backMergeMessage } from "./back-merge.js"
import type { BackMergeGit } from "./back-merge.js"

const MAIN = "a".repeat(40)
const DEV = "b".repeat(40)
const MERGED = "c".repeat(40)

/** A fake git: `main` holds dev (fast-forward), dev holds main (in sync), or neither (merge); `conflict` makes the merge fail. */
const fakeGit = (shape: "in-sync" | "fast-forward" | "merge", conflict = false): { readonly git: BackMergeGit; readonly calls: (readonly string[])[] } => {
    const calls: (readonly string[])[] = []
    const git: BackMergeGit = (_cwd, args) => {
        calls.push(args)
        const ok = { ok: true, out: "", err: "" }
        if (args[0] === "rev-parse") return Promise.resolve({ ...ok, out: args[1] === "origin/main" ? MAIN : args[1] === "origin/dev" ? DEV : MERGED })
        if (args[0] === "merge-base") {
            const [ancestor] = args.slice(2)
            const holds = (shape === "in-sync" && ancestor === MAIN) || (shape === "fast-forward" && ancestor === DEV)
            return Promise.resolve({ ...ok, ok: holds })
        }
        if (args[0] === "log") return Promise.resolve({ ...ok, out: shape === "in-sync" ? "" : "aaaaaaa cli 1.1.0-alpha.195: require @starci/hfs@6.17.9 (cli-follow)" })
        if (args[0] === "merge" && args[1] === "--no-ff") return Promise.resolve(conflict ? { ok: false, out: "", err: "conflict" } : ok)
        if (args[0] === "diff") return Promise.resolve({ ...ok, out: "cli/package.json" })
        return Promise.resolve(ok)
    }
    return { git, calls }
}

void test("a dev that holds main changes nothing, executed or not", async () => {
    const { git, calls } = fakeGit("in-sync")
    const done = await backMerge({ root: "/r", execute: true, git })
    assert.equal(done.kind, "in-sync")
    assert.equal(done.pushed, undefined)
    assert.equal(calls.some((args) => args[0] === "push"), false)
})

void test("a dry run reports the commits main holds that dev lacks and pushes nothing", async () => {
    const { git, calls } = fakeGit("merge")
    const done = await backMerge({ root: "/r", execute: false, git })
    assert.equal(done.kind, "merge")
    assert.equal(done.dryRun, true)
    assert.deepEqual(done.missing, ["aaaaaaa cli 1.1.0-alpha.195: require @starci/hfs@6.17.9 (cli-follow)"])
    assert.equal(calls.some((args) => args[0] === "push" || args[0] === "worktree"), false)
})

void test("a dev behind main is fast-forwarded to it by a push of main's commit", async () => {
    const { git, calls } = fakeGit("fast-forward")
    const done = await backMerge({ root: "/r", execute: true, git })
    assert.equal(done.pushed, MAIN)
    assert.deepEqual(calls.find((args) => args[0] === "push"), ["push", "origin", `${MAIN}:refs/heads/dev`])
})

void test("a dev apart from main gets a merge commit made in a temporary worktree at dev, pushed to dev, and the worktree goes", async () => {
    const { git, calls } = fakeGit("merge")
    const done = await backMerge({ root: "/r", execute: true, git, scratch: () => "/tmp/bm" })
    assert.equal(done.pushed, MERGED)
    assert.deepEqual(calls.find((args) => args[0] === "worktree" && args[1] === "add"), ["worktree", "add", "--detach", "/tmp/bm", DEV])
    const merge = calls.find((args) => args[0] === "merge" && args[1] === "--no-ff")
    assert.equal(merge?.at(-1), MAIN)
    assert.equal(merge[4], backMergeMessage(MAIN, done.missing))
    assert.deepEqual(calls.find((args) => args[0] === "push"), ["push", "origin", `${MERGED}:refs/heads/dev`])
    assert.deepEqual(calls.at(-1), ["worktree", "remove", "--force", "/tmp/bm"])
})

void test("a conflicting back-merge pushes nothing, names its files and removes its worktree", async () => {
    const { git, calls } = fakeGit("merge", true)
    await assert.rejects(backMerge({ root: "/r", execute: true, git, scratch: () => "/tmp/bm" }), /cli\/package\.json/)
    assert.equal(calls.some((args) => args[0] === "push"), false)
    assert.ok(calls.some((args) => args[0] === "merge" && args[1] === "--abort"))
    assert.deepEqual(calls.at(-1), ["worktree", "remove", "--force", "/tmp/bm"])
})

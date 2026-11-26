// `starci dev promote`: dev takes the integration branch the lanes land into, under the dev lock: a fast-forward when dev is behind it, one merge commit
// when dev holds commits it lacks, a conflict that pushes nothing, a dry run that only lists the lanes, and the dev sync marked once. Built with the CLI,
// run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureTool } from "../../shared/exec.js"
import { captureGitSync } from "../../shared/git.js"
import { landPaths, landedLanesOf } from "../../harness/lane-state.js"
import { promote, promoteMessage } from "./promote.js"
import type { PromoteDeps } from "./promote.js"

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

/** A bare origin with dev, a clone (the app's checkout) and dev2 holding two landed lanes, a lanes folder and this machine's settings. */
const scratch = (t: { after: (fn: () => void) => void }): { readonly app: string; readonly origin: string; readonly dir: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-promote-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    for (const name of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) process.env[name] = "t"
    for (const name of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) process.env[name] = "t@example.invalid"
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const origin = join(base, "origin.git")
    gitIn(base, "init", "-q", "--bare", "-b", "dev", origin)
    const app = join(base, "app")
    gitIn(base, "clone", "-q", origin, app)
    gitIn(app, "switch", "-q", "-c", "dev")
    writeFileSync(join(app, "a.txt"), "one\n")
    gitIn(app, "add", ".")
    gitIn(app, "commit", "-q", "-m", "start")
    gitIn(app, "push", "-q", "origin", "dev")
    gitIn(app, "switch", "-q", "-c", "dev2")
    for (const lane of ["alpha", "beta"]) {
        writeFileSync(join(app, `${lane}.txt`), `${lane}\n`)
        gitIn(app, "add", ".")
        gitIn(app, "commit", "-q", "-m", `land lane ${lane} onto dev2\n\nLanded-lane: ${lane} ${"a".repeat(40)}`)
    }
    gitIn(app, "push", "-q", "origin", "dev2")
    gitIn(app, "switch", "-q", "dev")
    const dir = join(base, "lanes")
    mkdirSync(join(base, "state"), { recursive: true })
    writeFileSync(join(base, "state", "local-settings.json"), JSON.stringify({ devSync: { repos: { [app]: { checkout: join(base, "devcheckout"), afterLand: true, landInto: "dev2" } } } }))
    return { app, origin, dir }
}

const fakeDeps = (log: string[]): PromoteDeps => ({
    push: (repo, _profile, sha) => {
        log.push("push")
        return captureTool("git", ["push", "origin", `${sha}:refs/heads/dev`], repo)
    },
    requestSync: (checkout) => {
        log.push(`sync ${checkout.endsWith("devcheckout") ? "devcheckout" : checkout}`)
        return Promise.resolve()
    },
    publish: () => Promise.resolve(),
    watchCi: (_repo, _dir, _sha, lanes) => {
        log.push(`watch ${lanes.join(",")}`)
        return Promise.resolve()
    },
})

void test("the trailers of a log name its lanes, oldest first", () => {
    const log = `land lane b onto dev2\n\nLanded-lane: b ${"b".repeat(40)}\n\nland lane a onto dev2\n\nLanded-lane: a ${"a".repeat(40)}\n`
    assert.deepEqual(landedLanesOf(log).map((lane) => lane.lane), ["a", "b"])
    assert.match(promoteMessage("dev2", "c".repeat(40), landedLanesOf(log)), /^promote dev2 c{10} into dev\n\n- a /u)
})

void test("a dry run lists the lanes that would arrive on dev and pushes nothing", async (t) => {
    const { app, origin, dir } = scratch(t)
    const dev = gitIn(origin, "rev-parse", "dev")
    const log: string[] = []
    const seen = await promote({ root: app, from: "dev2", execute: false, dir, say: () => undefined }, fakeDeps(log))
    assert.equal(seen.kind, "fast-forward")
    assert.deepEqual(seen.lanes.map((lane) => lane.lane), ["alpha", "beta"])
    assert.equal(seen.dryRun, true)
    assert.deepEqual(log, [])
    assert.equal(gitIn(origin, "rev-parse", "dev"), dev)
})

void test("dev behind the integration branch is fast-forwarded to it, the dev sync marked once and the lock released", async (t) => {
    const { app, origin, dir } = scratch(t)
    const log: string[] = []
    const done = await promote({ root: app, from: "dev2", execute: true, dir, say: () => undefined }, fakeDeps(log))
    assert.equal(done.kind, "fast-forward")
    assert.equal(gitIn(origin, "rev-parse", "dev"), gitIn(origin, "rev-parse", "dev2"), "dev is the integration tip itself")
    assert.deepEqual(log, ["push", "sync devcheckout", "watch alpha,beta"])
    assert.equal(existsSync(landPaths(dir).devLock), false)
    const again = await promote({ root: app, from: "dev2", execute: true, dir, say: () => undefined }, fakeDeps([]))
    assert.equal(again.kind, "in-sync")
    assert.equal(again.pushed, undefined)
})

void test("dev holding a commit the branch lacks gets ONE merge commit of both; a conflict pushes nothing", async (t) => {
    const { app, origin, dir } = scratch(t)
    writeFileSync(join(app, "hotfix.txt"), "hotfix\n")
    gitIn(app, "add", ".")
    gitIn(app, "commit", "-q", "-m", "hotfix on dev")
    gitIn(app, "push", "-q", "origin", "dev")
    const dev = gitIn(origin, "rev-parse", "dev")
    const tip = gitIn(origin, "rev-parse", "dev2")
    const done = await promote({ root: app, from: "dev2", execute: true, dir, say: () => undefined }, fakeDeps([]))
    assert.equal(done.kind, "merge")
    assert.equal(gitIn(origin, "rev-parse", "dev^1"), dev)
    assert.equal(gitIn(origin, "rev-parse", "dev^2"), tip)
    assert.match(gitIn(origin, "log", "-1", "--format=%s", "dev"), /^promote dev2 /u)

    const { app: other, origin: otherOrigin, dir: otherDir } = scratch(t)
    writeFileSync(join(other, "alpha.txt"), "dev's own alpha\n")
    gitIn(other, "add", ".")
    gitIn(other, "commit", "-q", "-m", "alpha on dev")
    gitIn(other, "push", "-q", "origin", "dev")
    const before = gitIn(otherOrigin, "rev-parse", "dev")
    const log: string[] = []
    await assert.rejects(promote({ root: other, from: "dev2", execute: true, dir: otherDir, say: () => undefined }, fakeDeps(log)), (error: { code?: string; message?: string }) => error.code === "DEV_PROMOTE_CONFLICT" && (error.message ?? "").includes("alpha.txt"))
    assert.deepEqual(log, [])
    assert.equal(gitIn(otherOrigin, "rev-parse", "dev"), before)
    assert.equal(existsSync(landPaths(otherDir).devLock), false)
})

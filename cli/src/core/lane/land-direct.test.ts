// `lane gate --push --land`: a gated lane lands on dev itself under the dev lock: the newest origin/dev merged in, a fast re-check only when dev moved past
// the gate's merge, ONE squashed commit on dev (the batch squash's message and trailer) pushed without force, the lane's status landed and its dev checkout
// marked for the debounced sync; a conflict stops with its files and lands nothing. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureTool } from "../../shared/exec.js"
import { captureGitSync } from "../../shared/git.js"
import { landPaths } from "../../harness/land-queue.js"
import { landLane } from "./land-direct.js"
import type { LandDeps } from "./land-direct.js"

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

/** A bare origin with dev, a lane clone on lane/feature with one commit, a second clone that pushes to dev, a lanes folder and this machine's settings. */
const scratch = (t: { after: (fn: () => void) => void }): { readonly lane: string; readonly pusher: string; readonly dir: string; readonly origin: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-land-direct-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    // The merge and the squash commit as a fixed author, whatever this machine's git identity.
    for (const name of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) process.env[name] = "t"
    for (const name of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) process.env[name] = "t@example.invalid"
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const origin = join(base, "origin.git")
    gitIn(base, "init", "-q", "--bare", "-b", "dev", origin)
    const pusher = join(base, "pusher")
    gitIn(base, "clone", "-q", origin, pusher)
    gitIn(pusher, "switch", "-q", "-c", "dev")
    writeFileSync(join(pusher, "a.txt"), "one\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "start")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const lane = join(base, "lane")
    gitIn(base, "clone", "-q", "-b", "dev", origin, lane)
    gitIn(lane, "switch", "-q", "-c", "lane/feature")
    mkdirSync(join(lane, "db", "migrations"), { recursive: true })
    writeFileSync(join(lane, "db", "migrations", "001.sql"), "select 1;\n")
    writeFileSync(join(lane, "b.txt"), "lane\n")
    gitIn(lane, "add", ".")
    gitIn(lane, "commit", "-q", "-m", "feature")
    const dir = join(base, "lanes")
    mkdirSync(join(base, "state"), { recursive: true })
    writeFileSync(join(base, "state", "local-settings.json"), JSON.stringify({ devSync: { repos: { [lane]: { checkout: join(base, "devcheckout"), afterLand: true } } } }))
    return { lane, pusher, dir, origin }
}

const fakeDeps = (log: string[], red?: string): LandDeps => ({
    recheck: () => {
        log.push("recheck")
        return Promise.resolve(red)
    },
    push: (root, _profile, sha) => {
        log.push("push")
        return captureTool("git", ["push", "origin", `${sha}:refs/heads/dev`], root)
    },
    publish: () => Promise.resolve([]),
    requestSync: (checkout, reason) => {
        log.push(`sync ${checkout.endsWith("devcheckout") ? "devcheckout" : checkout}: ${reason.split(" ")[0] ?? ""}`)
        return Promise.resolve()
    },
    watchCi: (_root, _dir, sha, lanes) => {
        log.push(`watch ${lanes.join(",")} ${sha.length === 40 ? "sha" : sha}`)
        return Promise.resolve()
    },
})

void test("a lane whose gate merged the dev that still stands lands as ONE squashed commit on dev, with no re-check, and marks its dev checkout", async (t) => {
    const { lane, dir, origin } = scratch(t)
    const gated = gitIn(lane, "rev-parse", "origin/dev")
    const log: string[] = []
    const done = await landLane({ root: lane, lane: "feature", branch: "lane/feature", profile: "app", dir, gatedBase: gated, say: () => undefined }, fakeDeps(log))
    assert.deepEqual(log, ["push", "sync devcheckout: feature", "watch feature sha"], "the landed sha's CI is watched once the landing stands")
    assert.equal(done.rechecked, false)
    const dev = gitIn(origin, "rev-parse", "dev")
    assert.equal(dev, done.sha)
    assert.equal(gitIn(origin, "rev-parse", "dev^"), gated, "one commit on top of the dev it landed on")
    assert.equal(gitIn(origin, "rev-list", "--count", `${gated}..dev`), "1")
    const message = gitIn(origin, "log", "-1", "--format=%B", "dev")
    assert.match(message, /onto dev \(feature\)/u)
    assert.match(message, /Landed-lane: feature [0-9a-f]{40}/u)
    assert.deepEqual(done.migrations, ["db/migrations/001.sql"])
    const status = JSON.parse(readFileSync(join(landPaths(dir).status, "feature.json"), "utf8")) as { state: string; sha: string }
    assert.equal(status.state, "landed")
    assert.equal(status.sha, done.sha)
    assert.equal(existsSync(landPaths(dir).devLock), false, "the dev lock is released")
})

void test("dev that moved since the gate is merged in and re-checked; a red re-check lands nothing and releases the lock", async (t) => {
    const { lane, pusher, dir, origin } = scratch(t)
    const gated = gitIn(lane, "rev-parse", "origin/dev")
    writeFileSync(join(pusher, "c.txt"), "other lane\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "another landing")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const moved = gitIn(origin, "rev-parse", "dev")
    const log: string[] = []
    await assert.rejects(landLane({ root: lane, lane: "feature", branch: "lane/feature", profile: "app", dir, gatedBase: gated, say: () => undefined }, fakeDeps(log, "npm run typecheck exited 2")), (error: { code?: string }) => error.code === "LANE_LAND_RED")
    assert.deepEqual(log, ["recheck"])
    assert.equal(gitIn(origin, "rev-parse", "dev"), moved, "nothing landed")
    assert.equal(existsSync(landPaths(dir).devLock), false)
    const green: string[] = []
    const done = await landLane({ root: lane, lane: "feature", branch: "lane/feature", profile: "app", dir, gatedBase: gated, say: () => undefined }, fakeDeps(green))
    assert.deepEqual(green.slice(0, 2), ["recheck", "push"])
    assert.equal(gitIn(origin, "rev-parse", "dev^"), moved)
    assert.ok(done.rechecked)
})

void test("a conflict with the newest dev stops with its files, lands nothing and leaves the lane clean", async (t) => {
    const { lane, pusher, dir, origin } = scratch(t)
    writeFileSync(join(pusher, "b.txt"), "dev's own b\n")
    gitIn(pusher, "add", ".")
    gitIn(pusher, "commit", "-q", "-m", "b on dev")
    gitIn(pusher, "push", "-q", "origin", "dev")
    const dev = gitIn(origin, "rev-parse", "dev")
    await assert.rejects(landLane({ root: lane, lane: "feature", branch: "lane/feature", profile: "app", dir, gatedBase: undefined, say: () => undefined }, fakeDeps([])), (error: { code?: string; message?: string }) => error.code === "LANE_LAND_CONFLICT" && (error.message ?? "").includes("b.txt"))
    assert.equal(gitIn(origin, "rev-parse", "dev"), dev)
    assert.equal(gitIn(lane, "status", "--porcelain"), "")
    assert.equal(existsSync(landPaths(dir).devLock), false)
})

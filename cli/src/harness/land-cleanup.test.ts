// The cleanup after `lane gate --push --land`: the landed lane's worktree is removed (the same removal as `lane remove`, behind the install janitor's in-use
// guard) with its branch kept; --keep, uncommitted non-cache work and a non-lane folder keep it with the one line saying why; the check-cache records are
// discarded; a busy host (EBUSY) is retried with backoff and then leaves a marker the janitor's sweep and `lane remove` consume, never an error.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { LiveContext } from "./install-janitor.js"
import { cleanupLanded, clearMarkersOf, readMarkers, realCleanupDeps, sweepCleanupMarkers, transientCode } from "./land-cleanup.js"
import type { CleanupDeps } from "./land-cleanup.js"
import type { SlotRules } from "./slots.js"
import { removeWorktree } from "./worktree-remove.js"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim()

interface World {
    readonly root: string
    readonly main: string
    readonly tree: string
    readonly sha: string
}

/** A lanes folder holding a repository `app` and a lane worktree `app-x` on `lane/x`, with a tracked check-cache record and an ignored node_modules. */
const world = (t: { after: (fn: () => void) => void }): World => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-cleanup-")))
    const before = process.env.STARCI_LANES_DIR
    process.env.STARCI_LANES_DIR = root
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LANES_DIR
        else process.env.STARCI_LANES_DIR = before
        rmSync(root, { recursive: true, force: true })
    })
    const main = join(root, "app")
    mkdirSync(main)
    git(main, "init", "-q", "-b", "dev")
    writeFileSync(join(main, ".gitignore"), "node_modules\n")
    mkdirSync(join(main, ".starcistacks", "cache"), { recursive: true })
    writeFileSync(join(main, ".starcistacks", "cache", "record.json"), "{}\n")
    writeFileSync(join(main, "a.txt"), "one\n")
    git(main, "add", "-A")
    git(main, "commit", "-q", "-m", "init")
    const tree = join(root, "app-x")
    git(main, "worktree", "add", "-q", "-b", "lane/x", tree)
    mkdirSync(join(tree, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(tree, "node_modules", "pkg", "index.js"), "x\n")
    return { root, main, tree, sha: git(tree, "rev-parse", "HEAD") }
}

const rules: SlotRules = { schema: "starci/slots@1", root: null, kinds: { gate: { count: 2, file: "_gate-slot-{n}.lock", warnMinutes: 120, pollSeconds: 1 } }, janitor: { idleHours: 6, touchedMinutes: 60, dirs: ["node_modules"] } }

/** The live context of a quiet host: the given processes, this one spared. */
const quiet = (root: string, processes: LiveContext["processes"] = []): Promise<LiveContext> => Promise.resolve({ root, rules, processes, spared: new Set([process.pid]) })

/** Real removal, a quiet host, a recorded leave and no waiting; any seam may be replaced. */
const deps = (root: string, over: Partial<CleanupDeps> = {}, left: string[] = []): CleanupDeps => ({
    ...realCleanupDeps,
    leave: (folder) => {
        left.push(folder)
    },
    sleep: () => Promise.resolve(),
    live: () => quiet(root),
    attempts: 3,
    ...over,
})

const landed = (w: World, keep = false): Parameters<typeof cleanupLanded>[0] => ({ root: w.tree, lane: "x", branch: "lane/x", laneSha: w.sha, dir: w.root, keep })

void test("a landed lane's worktree is removed, the branch kept, the cache records discarded, and the process left the worktree first", async (t) => {
    const w = world(t)
    // The gate's push rewrote a check-cache record: not work. The worktree was touched a second ago: not a reason after a landing.
    writeFileSync(join(w.tree, ".starcistacks", "cache", "record.json"), '{"new":1}\n')
    const left: string[] = []
    const result = await cleanupLanded(landed(w), deps(w.root, {}, left))
    assert.deepEqual({ removed: result.removed, line: result.line }, { removed: true, line: "worktree removed" })
    assert.equal(existsSync(w.tree), false)
    assert.equal(git(w.main, "branch", "--list", "lane/x").replace(/^[*+ ]+/, ""), "lane/x")
    assert.equal(left.length, 1)
    assert.ok(!String(left[0]).includes("app-x"), `left for ${String(left[0])}`)
})

void test("--keep keeps the worktree and says so", async (t) => {
    const w = world(t)
    const left: string[] = []
    const result = await cleanupLanded(landed(w, true), deps(w.root, {}, left))
    assert.equal(result.removed, false)
    assert.match(result.line, /^kept: --keep given; remove it when you are done with `starci lane remove .+ --execute`/)
    assert.ok(existsSync(w.tree))
    assert.equal(left.length, 0)
})

void test("uncommitted non-cache work keeps the worktree; the line names it", async (t) => {
    const w = world(t)
    writeFileSync(join(w.tree, "follow-up.txt"), "wip\n")
    const result = await cleanupLanded(landed(w), deps(w.root))
    assert.equal(result.removed, false)
    assert.match(result.line, /^kept: uncommitted work \(follow-up\.txt\)/)
    assert.match(result.line, /holds non-generated changes the landing did not take: commit or discard them, then `starci lane remove /)
    assert.ok(existsSync(w.tree))
})

void test("a stale generated contexts file is no work: the worktree is removed with it", async (t) => {
    const w = world(t)
    mkdirSync(join(w.tree, "contexts", "project"), { recursive: true })
    writeFileSync(join(w.tree, "contexts", "project", "index.md"), "landed" + String.fromCharCode(10))
    git(w.tree, "add", "-A")
    git(w.tree, "commit", "-q", "-m", "lane")
    const sha = git(w.tree, "rev-parse", "HEAD")
    writeFileSync(join(w.tree, "contexts", "project", "index.md"), "regenerated after the landing" + String.fromCharCode(10))
    const result = await cleanupLanded({ ...landed(w), laneSha: sha }, deps(w.root))
    assert.deepEqual({ removed: result.removed, line: result.line }, { removed: true, line: "worktree removed" })
    assert.ok(!existsSync(w.tree))
})

void test("a worktree held only by a process of the moment leaves a marker, and the sweep removes it once the process is gone", async (t) => {
    const w = world(t)
    const working = [{ pid: 4242, ppid: 1, name: "bash.exe", workingSetMb: 0, cpuMs: 0, startedMs: 0, cwd: w.tree, commandLine: "bash" }]
    const result = await cleanupLanded(landed(w), deps(w.root, { live: () => quiet(w.root, working) }))
    assert.equal(result.removed, false)
    assert.match(result.line, /^kept: pid 4242 bash\.exe works there; marked for the next lane remove or janitor run$/)
    assert.deepEqual(readMarkers(w.root).map((marker) => marker.lane), ["x"])
    const swept = await sweepCleanupMarkers(w.root, w.root, rules, deps(w.root))
    assert.deepEqual(swept.map((one) => one.state), ["removed"])
    assert.deepEqual(readMarkers(w.root), [])
})

void test("a branch that moved past the landed sha and a process working inside: the guard keeps it", async (t) => {
    const w = world(t)
    writeFileSync(join(w.tree, "b.txt"), "two\n")
    git(w.tree, "add", "-A")
    git(w.tree, "commit", "-q", "-m", "follow-up")
    const moved = await cleanupLanded(landed(w), deps(w.root))
    assert.match(moved.line, /^kept: its branch has 1 commit\(s\) after the landed sha/)
    const working = [{ pid: 4242, ppid: 1, name: "node.exe", workingSetMb: 0, cpuMs: 0, startedMs: 0, cwd: join(w.tree, "web"), commandLine: "node dev.js" }]
    const busy = await cleanupLanded({ ...landed(w), laneSha: git(w.tree, "rev-parse", "HEAD") }, deps(w.root, { live: () => quiet(w.root, working) }))
    assert.match(busy.line, /^kept: pid 4242 node\.exe works there/)
    assert.ok(existsSync(w.tree))
})

void test("a folder that is no lane worktree (the main checkout, outside the lanes folder) is kept", async (t) => {
    const w = world(t)
    const main = await cleanupLanded({ ...landed(w), root: w.main }, deps(w.root))
    assert.match(main.line, /^kept: .* is not a lane worktree under the lanes folder/)
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "starci-cleanup-out-")))
    t.after(() => {
        rmSync(outside, { recursive: true, force: true })
    })
    git(w.main, "worktree", "add", "-q", "-b", "lane/y", join(outside, "y"))
    const away = await cleanupLanded({ ...landed(w), root: join(outside, "y"), lane: "y" }, deps(w.root))
    assert.match(away.line, /^kept: .* is not a lane worktree/)
    assert.ok(existsSync(join(outside, "y")))
})

void test("a busy host is retried with backoff, then leaves a marker and the landing is not failed; the sweep removes it later and clears the marker", async (t) => {
    const w = world(t)
    const waits: number[] = []
    let tries = 0
    const busy = deps(w.root, {
        attempts: 4,
        baseMs: 100,
        capMs: 250,
        sleep: (ms) => {
            waits.push(ms)
            return Promise.resolve()
        },
        remove: () => {
            tries += 1
            return Promise.reject(Object.assign(new Error("EBUSY: resource busy or locked, rmdir node_modules"), { code: "EBUSY" }))
        },
    })
    const result = await cleanupLanded(landed(w), busy)
    assert.equal(result.removed, false)
    assert.match(result.line, /^kept: busy \(EBUSY after 4 attempt\(s\): .*\); marked for the next lane remove or janitor run$/)
    assert.equal(tries, 4)
    assert.deepEqual(waits, [100, 200, 250])
    assert.ok(existsSync(w.tree))
    assert.deepEqual(readMarkers(w.root).map((marker) => [marker.lane, marker.branch, marker.laneSha]), [["x", "lane/x", w.sha]])
    // The next janitor run: the host is quiet now, so the real removal goes through and the marker goes.
    const swept = await sweepCleanupMarkers(w.root, w.root, rules, deps(w.root))
    assert.deepEqual(swept.map((one) => [one.lane, one.state]), [["x", "removed"]])
    assert.equal(existsSync(w.tree), false)
    assert.deepEqual(readMarkers(w.root), [])
    assert.equal(git(w.main, "branch", "--list", "lane/x").replace(/^[*+ ]+/, ""), "lane/x")
})

void test("a marker still held is kept, lane remove clears the markers of its worktree, a worktree gone loses its marker", async (t) => {
    const w = world(t)
    const held = deps(w.root, { remove: () => Promise.reject(new Error("EPERM: operation not permitted")) })
    await cleanupLanded(landed(w), held)
    const stillHeld = await sweepCleanupMarkers(w.root, w.root, rules, held)
    assert.equal(stillHeld[0]?.state, "kept")
    assert.match(String(stillHeld[0].reason), /^EPERM after 3 attempt\(s\)/)
    assert.equal(readMarkers(w.root).length, 1)
    clearMarkersOf(w.root, w.tree)
    assert.deepEqual(readMarkers(w.root), [])
    await cleanupLanded(landed(w), held)
    // Removed by hand meanwhile (lane remove): the sweep finds nothing to do and drops the marker.
    await removeWorktree({ worktree: w.tree, main: w.main, branch: "lane/x", dirty: [], links: [] }, "x", () => undefined)
    assert.deepEqual((await sweepCleanupMarkers(w.root, w.root, rules, deps(w.root))).map((one) => one.state), ["gone"])
    assert.deepEqual(readdirSync(join(w.root, "_land-cleanup")), [])
})

void test("a refusal that is no busy host keeps the worktree without a marker", async (t) => {
    const w = world(t)
    const result = await cleanupLanded(landed(w), deps(w.root, { remove: () => Promise.reject(new Error("WORKTREE_TARGET_GONE: a target vanished")) }))
    assert.deepEqual({ removed: result.removed, line: result.line }, { removed: false, line: "kept: WORKTREE_TARGET_GONE: a target vanished" })
    assert.deepEqual(readMarkers(w.root), [])
})

void test("the codes of a busy host are read from the error or its message", () => {
    assert.equal(transientCode(Object.assign(new Error("x"), { code: "ENOTEMPTY" })), "ENOTEMPTY")
    assert.equal(transientCode(new Error("git worktree remove: EPERM unlink")), "EPERM")
    assert.equal(transientCode(new Error("link remains")), undefined)
})

// The install janitor on a scratch lanes folder: it takes only lane worktrees (a `lane/<lane>` branch, not a `_` folder), lists the ignored install
// folders git reports and never a tracked file, skips a worktree that is live (a slot of its lane, a removal lock, a process working inside it, an
// unreadable process table), and deletes link-safely: a link is unlinked and its target survives, the branch and the tracked files stay.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { installTargets, isInstallEntry, laneTrees, liveReasons, pruneTree, type LiveContext } from "./install-janitor.js"
import type { HostProcess } from "./process-table.js"
import type { SlotRules } from "./slots.js"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" })
const rules: SlotRules = { schema: "starci/slots@1", root: null, kinds: { gate: { count: 2, file: "_gate-slot-{n}.lock", warnMinutes: 120, pollSeconds: 1 } }, janitor: { idleHours: 6, dirs: ["node_modules", ".next", "dist"] } }
const DIRS = ["node_modules", ".next", "dist"]

/** A lanes folder holding a repository `app`, a lane worktree `app-x` on `lane/x` and a harness-owned `_lander` worktree. */
const lanes = (): { readonly root: string; readonly tree: string; readonly outside: string } => {
    const root = mkdtempSync(join(tmpdir(), "starci-janitor-"))
    const main = join(root, "app")
    mkdirSync(main)
    git(main, "init", "-q", "-b", "dev")
    writeFileSync(join(main, ".gitignore"), "node_modules\n.next\ndist\n")
    mkdirSync(join(main, "web"))
    writeFileSync(join(main, "web", "page.ts"), "export {}\n")
    git(main, "add", "-A")
    git(main, "commit", "-q", "-m", "init")
    const tree = join(root, "app-x")
    git(main, "worktree", "add", "-q", "-b", "lane/x", tree)
    git(main, "worktree", "add", "-q", "--detach", join(root, "_lander"))
    const outside = join(root, "_cache", "pkg")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "index.js"), "module.exports = 1\n")
    mkdirSync(join(tree, "node_modules", "a"), { recursive: true })
    writeFileSync(join(tree, "node_modules", "a", "index.js"), "x".repeat(1000))
    symlinkSync(outside, join(tree, "node_modules", "linked"), "junction")
    mkdirSync(join(tree, "web", ".next", "cache"), { recursive: true })
    writeFileSync(join(tree, "web", ".next", "cache", "x"), "x")
    mkdirSync(join(tree, "node_modules.starci-trash-1"), { recursive: true })
    writeFileSync(join(tree, "node_modules.starci-trash-1", "y"), "y")
    return { root, tree, outside }
}

const quiet = (root: string, processes: readonly HostProcess[] = []): LiveContext => ({ root, rules, processes, spared: new Set([process.pid]) })

void test("only a janitor folder or a safe install's trash is an install entry", () => {
    assert.ok(isInstallEntry("node_modules/", DIRS))
    assert.ok(isInstallEntry("web/.next", DIRS))
    assert.ok(isInstallEntry("node_modules.starci-trash-12", DIRS))
    assert.ok(!isInstallEntry("web/src", DIRS))
    assert.ok(!isInstallEntry("dist-notes", DIRS))
})

void test("the lane worktrees exclude the main checkout and the harness's own _ folders; the targets are git's ignored install folders", (t) => {
    const { root, tree } = lanes()
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    assert.deepEqual(laneTrees(root).map((one) => one.lane), ["x"])
    const targets = installTargets(tree, DIRS)
    assert.deepEqual(targets.map((target) => target.relative).sort((left, right) => left.localeCompare(right)), ["node_modules", "node_modules.starci-trash-1", "web/.next"])
    assert.ok(targets.every((target) => !target.link))
})

void test("a live worktree is skipped: a held slot of its lane, a process working inside it, an unreadable process table", (t) => {
    const { root, tree } = lanes()
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    const lane = laneTrees(root)[0]
    assert.ok(lane !== undefined)
    assert.deepEqual(liveReasons(lane, quiet(root)), [], "nothing holds it")
    const shell: HostProcess = { pid: 4242, ppid: 1, name: "bash.exe", workingSetMb: 10, commandLine: "bash", cpuMs: null, startedMs: null, cwd: join(tree, "web") }
    assert.match(liveReasons(lane, quiet(root, [shell])).join(";"), /pid 4242 bash\.exe works there/u)
    const server: HostProcess = { ...shell, pid: 4243, name: "node.exe", cwd: null, commandLine: `node ${join(tree, "node_modules", "next", "dist", "bin", "next")} start` }
    assert.match(liveReasons(lane, quiet(root, [server])).join(";"), /pid 4243 node\.exe works there/u, "a command line inside it counts too")
    assert.match(liveReasons(lane, { ...quiet(root), processes: "denied" }).join(";"), /process table could not be read/u)
    writeFileSync(join(root, "_gate-slot-1.lock"), `x ${new Date().toISOString()} pid=${String(process.pid)} boot=${new Date().toISOString()} host=other-host`)
    assert.match(liveReasons(lane, quiet(root)).join(";"), /lane x holds gate slot 1/u, "a slot held on any host keeps it")
})

void test("a prune unlinks every link first, keeps its target, deletes the install folders and keeps the tracked files and the branch", (t) => {
    const { root, tree, outside } = lanes()
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    const lane = laneTrees(root)[0]
    assert.ok(lane !== undefined)
    const pruned = pruneTree(lane, installTargets(tree, DIRS), root)
    assert.deepEqual(pruned.targets.filter((target) => target.kept !== undefined), [])
    assert.equal(pruned.targets.find((target) => target.target.relative === "node_modules")?.unlinked, 1)
    assert.ok(!existsSync(join(tree, "node_modules")))
    assert.ok(!existsSync(join(tree, "web", ".next")))
    assert.ok(!existsSync(join(tree, "node_modules.starci-trash-1")))
    assert.ok(existsSync(join(outside, "index.js")), "the junction's target survived")
    assert.ok(existsSync(join(tree, "web", "page.ts")), "tracked files stay")
    assert.equal(git(tree, "rev-parse", "--abbrev-ref", "HEAD").trim(), "lane/x", "the branch stays")
    assert.equal(git(tree, "status", "--porcelain").trim(), "", "nothing tracked changed")
})


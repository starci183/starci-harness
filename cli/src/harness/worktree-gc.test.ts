import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import test from "node:test"
import { setTimeout as pause } from "node:timers/promises"
import { captureGitSync } from "../shared/git.js"
import { pidAlive, startDetached } from "../shared/exec.js"
import { unlinkCheckoutLinks } from "./install-cache.js"
import { openMachine, projectDir } from "./ledger.js"
import { processBlockReason, sameRepository, worktreeGc } from "./worktree-gc.js"
import { preserveCheckout } from "./worktree-preserve.js"
import type { HostProcess } from "./process-table.js"

const git = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=fixture", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, run.stderr)
    return run.stdout.trim()
}

interface Fixture {
    readonly base: string
    readonly a: string
    readonly b: string
    readonly c: string
    readonly onCleanup: (fn: () => void) => void
}

const fixture = (t: { after(fn: () => void): void }): Fixture => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-gc-scope-")))
    const previous = process.env.STARCI_LOCAL_ROOT
    const cleanups: (() => void)[] = []
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    t.after(() => {
        for (const clean of cleanups.toReversed()) clean()
        if (previous === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = previous
        unlinkCheckoutLinks(base)
        assert.equal(dirname(base), realpathSync(tmpdir()))
        assert.ok(basename(base).startsWith("starci-gc-scope-"))
        rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    })
    const repo = (name: string): string => {
        const root = join(base, name)
        mkdirSync(root)
        git(root, "init", "-q", "-b", "main")
        writeFileSync(join(root, ".gitignore"), "node_modules/\ncoverage/\nlocal.config\n")
        writeFileSync(join(root, "source.txt"), "base\n")
        writeFileSync(join(root, "hidden.txt"), "base hidden\n")
        writeFileSync(join(root, "binary.dat"), Buffer.from([0, 255, 1, 0]))
        git(root, "add", ".")
        git(root, "commit", "-qm", "fixture base")
        projectDir(root)
        return root
    }
    return { base, a: repo("a"), b: repo("b"), c: repo("c"), onCleanup: (fn) => { cleanups.push(fn) } }
}

const linked = (root: string, base: string, name: string): string => {
    const path = join(base, name)
    git(root, "worktree", "add", "-qb", name, path)
    return path
}

void test("a repository collection cannot remove another repository's landed package or retired worktree", async (t) => {
    const { base, a, b, c } = fixture(t)
    const packageTree = linked(b, base, "package-b")
    const retiredTree = linked(c, join(projectDir(c), "worktrees"), "retired-c")
    const machine = openMachine()
    machine.exec("CREATE TABLE IF NOT EXISTS package_handoffs (branch TEXT, head TEXT, harness TEXT, worktree TEXT)")
    machine.prepare("INSERT INTO package_handoffs (branch,head,harness,worktree) VALUES (?,?,?,?)").run("package-b", git(b, "rev-parse", "HEAD"), b, packageTree)
    machine.prepare("UPDATE ledgers SET state = 'retired' WHERE repo_root = ?").run(c)
    machine.close()
    assert.deepEqual(await worktreeGc(a, true), [])
    assert.deepEqual(await worktreeGc(a, false), [])
    assert.ok(existsSync(packageTree))
    assert.ok(existsSync(retiredTree))
    assert.equal(git(b, "branch", "--show-current"), "main")
    assert.equal(await sameRepository(a, b), false)
})

void test("explicit collection preserves restorable dirty binary, staged, untracked and ignored bytes, refs and junction targets", async (t) => {
    const { base, a, b } = fixture(t)
    const path = linked(a, base, "legacy-a")
    writeFileSync(join(path, "source.txt"), "unique committed source\n")
    git(path, "add", "source.txt")
    git(path, "commit", "-qm", "unmerged work")
    const head = git(path, "rev-parse", "HEAD")
    writeFileSync(join(path, "source.txt"), "staged source\n")
    git(path, "add", "source.txt")
    writeFileSync(join(path, "source.txt"), "unstaged source\n")
    writeFileSync(join(path, "binary.dat"), Buffer.from([0, 2, 255, 0, 3]))
    git(path, "update-index", "--assume-unchanged", "hidden.txt")
    writeFileSync(join(path, "hidden.txt"), "working bytes hidden from Git diff\n")
    writeFileSync(join(path, "notes.txt"), "untracked note\n")
    writeFileSync(join(path, "local.config"), Buffer.from([255, 0, 25, 0, 42]))
    const external = join(base, "external-install")
    mkdirSync(external)
    writeFileSync(join(external, "sentinel.txt"), "keep the install\n")
    symlinkSync(external, join(path, "node_modules"), process.platform === "win32" ? "junction" : "dir")
    const before = git(a, "show-ref")
    const plan = await worktreeGc(a, true, false, { paths: [path], caller: a })
    assert.equal(plan.length, 1)
    assert.equal(plan[0]?.due, true)
    assert.equal(git(a, "show-ref"), before, "dry planning writes no refs")
    assert.ok(existsSync(path))
    const done = await worktreeGc(a, false, false, { paths: [path], caller: a })
    assert.equal(done[0]?.removed, true, done[0]?.detail)
    const preserved = done[0]?.preserved
    assert.ok(preserved)
    assert.equal(existsSync(path), false)
    assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "keep the install\n")
    assert.equal(git(a, "rev-parse", "refs/heads/legacy-a"), head)
    assert.deepEqual(readFileSync(join(preserved, "ignored/local.config")), Buffer.from([255, 0, 25, 0, 42]))
    assert.equal(readFileSync(join(preserved, "untracked/notes.txt"), "utf8"), "untracked note\n")
    assert.equal(readFileSync(join(preserved, "tracked/hidden.txt"), "utf8"), "working bytes hidden from Git diff\n")
    const manifest = JSON.parse(readFileSync(join(preserved, "manifest.json"), "utf8")) as { metadata: { links: { path: string; target: string }[] } }
    assert.ok(manifest.metadata.links.some((link) => link.path === "node_modules" && link.target !== ""))
    const restored = join(base, "restored")
    git(a, "worktree", "add", "--detach", restored, head)
    git(restored, "apply", "--cached", join(preserved, "index.patch"))
    git(restored, "apply", join(preserved, "changes.patch"))
    assert.equal(git(restored, "show", ":source.txt"), "staged source")
    assert.equal(readFileSync(join(restored, "source.txt"), "utf8"), "unstaged source\n")
    assert.deepEqual(readFileSync(join(restored, "binary.dat")), Buffer.from([0, 2, 255, 0, 3]))
    assert.ok(existsSync(b), "the unrelated primary checkout stays")
})

void test("primary, caller, foreign and unlisted selections block execution of the whole selection", async (t) => {
    const { base, a, b } = fixture(t)
    const path = linked(a, base, "guarded-a")
    const foreign = linked(b, base, "foreign-b")
    const alias = join(base, "a-through-link")
    symlinkSync(a, alias, process.platform === "win32" ? "junction" : "dir")
    assert.equal(await sameRepository(a, alias), true)
    const plan = await worktreeGc(a, true, false, { paths: [a, path, foreign, join(base, "not-listed"), alias], caller: path })
    assert.equal(plan.length, 5)
    assert.ok(plan.every((entry) => entry.blocked === true))
    assert.match(plan[0]?.reason ?? "", /primary/)
    assert.match(plan[1]?.reason ?? "", /caller/)
    assert.match(plan[2]?.reason ?? "", /not a listed/)
    const done = await worktreeGc(a, false, false, { paths: [path, foreign], caller: a })
    assert.ok(done.some((entry) => entry.blocked === true))
    assert.ok(existsSync(path))
    assert.ok(existsSync(foreign))
})

void test("a unique detached HEAD receives a durable preservation ref before removal", async (t) => {
    const { base, a } = fixture(t)
    const path = join(base, "detached")
    git(a, "worktree", "add", "--detach", path, "HEAD")
    writeFileSync(join(path, "source.txt"), "detached unique source\n")
    git(path, "add", "source.txt")
    git(path, "commit", "-qm", "detached work")
    const head = git(path, "rev-parse", "HEAD")
    const done = await worktreeGc(a, false, false, { paths: [path], caller: a })
    assert.equal(done[0]?.removed, true)
    const preserved = done[0]?.preserved
    assert.ok(preserved)
    const manifest = JSON.parse(readFileSync(join(preserved, "manifest.json"), "utf8")) as { ref: string }
    assert.equal(git(a, "rev-parse", manifest.ref), head)
    assert.equal(git(a, "show", `${manifest.ref}:source.txt`), "detached unique source")
})

void test("changed files refuse snapshot verification, and a live worker is kept even with --now", async (t) => {
    const { base, a } = fixture(t)
    const path = linked(a, base, "live-a")
    writeFileSync(join(path, "local.config"), "first version")
    const saved = await preserveCheckout(a, path)
    assert.ok(saved)
    writeFileSync(join(path, "local.config"), "a different version")
    await assert.rejects(saved.verify(), /metadata changed/)
    const machine = openMachine()
    machine.exec("CREATE TABLE IF NOT EXISTS supervisor_workers (id TEXT, worktree TEXT, ended_at TEXT)")
    machine.prepare("INSERT INTO supervisor_workers (id,worktree,ended_at) VALUES (?,?,NULL)").run("still-working", path)
    machine.close()
    const plan = await worktreeGc(a, false, true, { paths: [path], caller: a })
    assert.equal(plan[0]?.blocked, true)
    assert.match(plan[0]?.reason ?? "", /worker still-working is live/)
    assert.ok(existsSync(path))
})

void test("an external process working in a selected checkout blocks removal without being killed", async (t) => {
    const { base, a, onCleanup } = fixture(t)
    const path = linked(a, base, "process-a")
    const pid = await startDetached([process.execPath, "-e", 'require("node:fs").writeFileSync("live.marker","ready");setInterval(()=>{},1000)'], path)
    onCleanup(() => { if (pidAlive(pid)) process.kill(pid) })
    for (let i = 0; i < 50 && !existsSync(join(path, "live.marker")); i += 1) await pause(100)
    assert.ok(existsSync(join(path, "live.marker")))
    const plan = await worktreeGc(a, false, false, { paths: [path], caller: a })
    assert.equal(plan[0]?.blocked, true)
    assert.match(plan[0]?.reason ?? "", /holder pid|inventory unavailable/)
    assert.ok(pidAlive(pid))
    assert.ok(existsSync(path))
})

void test("unknown-cwd arguments that name the target are ambiguous, while the collector and its ancestors are protected", () => {
    const process = (pid: number, ppid: number, commandLine: string): HostProcess => ({ pid, ppid, name: "fixture", commandLine, cwd: null, workingSetMb: 1, cpuMs: 0, startedMs: 1 })
    const target = join(tmpdir(), "selected-worktree")
    assert.equal(processBlockReason(target, [process(10, 9, target), process(9, 1, target)], 10), undefined)
    assert.match(processBlockReason(target, [process(11, 1, target)], 10) ?? "", /holder pid 11/)
})

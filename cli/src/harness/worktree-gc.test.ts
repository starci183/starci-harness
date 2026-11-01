import assert from "node:assert/strict"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import test from "node:test"
import { setTimeout as pause } from "node:timers/promises"
import { captureGitSync } from "../shared/git.js"
import { pidAlive, startDetached } from "../shared/exec.js"
import { unlinkCheckoutLinks } from "./install-cache.js"
import { openMachine, projectDir } from "./ledger.js"
import { processBlockReason, sameRepository, worktreeGc } from "./worktree-gc.js"
import { inspectRemnant, preserveCheckout, quarantineRemnant } from "./worktree-preserve.js"
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
        git(root, "config", "core.autocrlf", "false")
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
    const preserved = done[0].preserved
    assert.ok(preserved)
    assert.equal(existsSync(path), false)
    assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "keep the install\n")
    assert.equal(git(a, "rev-parse", "refs/heads/legacy-a"), head)
    assert.deepEqual(readFileSync(join(preserved, "ignored/local.config")), Buffer.from([255, 0, 25, 0, 42]))
    assert.equal(readFileSync(join(preserved, "untracked/notes.txt"), "utf8"), "untracked note\n")
    assert.equal(readFileSync(join(preserved, "tracked/hidden.txt"), "utf8"), "working bytes hidden from Git diff\n")
    assert.equal(readFileSync(join(preserved, "tracked/source.txt"), "utf8"), "unstaged source\n")
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
    const preserved = done[0].preserved
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
    assert.match(plan[0].reason, /worker still-working is live/)
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
    assert.match(plan[0].reason, /holder pid|inventory unavailable/)
    assert.ok(pidAlive(pid))
    assert.ok(existsSync(path))
})

void test("unknown-cwd arguments that name the target are ambiguous, while the collector and its ancestors are protected", () => {
    const process = (pid: number, ppid: number, commandLine: string): HostProcess => ({ pid, ppid, name: "fixture", commandLine, cwd: null, workingSetMb: 1, cpuMs: 0, startedMs: 1 })
    const target = join(tmpdir(), "selected-worktree")
    assert.equal(processBlockReason(target, [process(10, 9, target), process(9, 1, target)], 10), undefined)
    assert.match(processBlockReason(target, [process(11, 1, target)], 10) ?? "", /holder pid 11/)
})

void test("unlisted existing remnants and nested repositories refuse deletion until their custody is resolved", async (t) => {
    const { base, a } = fixture(t)
    const remnant = join(base, "unlisted-remnant")
    mkdirSync(remnant)
    writeFileSync(join(remnant, "local.config"), "retain opaque fixture bytes\n")
    await assert.rejects(preserveCheckout(a, remnant), /lacks Git metadata/)
    assert.equal(readFileSync(join(remnant, "local.config"), "utf8"), "retain opaque fixture bytes\n")
    const path = linked(a, base, "nested-a")
    mkdirSync(join(path, "nested"))
    writeFileSync(join(path, "nested/.git"), "fixture metadata pointer\n")
    await assert.rejects(preserveCheckout(a, path), /nested checkout/)
    assert.ok(existsSync(path))
})

void test("explicit project remnants quarantine every regular byte and unlink dependency links without entering their targets", async (t) => {
    const { base, a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "legacy-remnant")
    mkdirSync(join(path, "node_modules", "local-package"), { recursive: true })
    mkdirSync(join(path, "coverage"))
    writeFileSync(join(path, "local.config"), Buffer.from([0, 255, 23, 0]))
    writeFileSync(join(path, "node_modules/local-package/unique.js"), "unknown ownership must retain these install bytes\n")
    writeFileSync(join(path, "coverage/opaque.dat"), Buffer.from([200, 0, 40, 0]))
    const external = join(base, "remnant-external")
    mkdirSync(external)
    writeFileSync(join(external, "sentinel.txt"), "external bytes stay\n")
    symlinkSync(external, join(path, "node_modules/shared"), process.platform === "win32" ? "junction" : "dir")
    mkdirSync(join(path, "a/b/c/d/e"), { recursive: true })
    symlinkSync(external, join(path, "a/b/c/d/e/node_modules"), process.platform === "win32" ? "junction" : "dir")
    symlinkSync(external, join(path, "reference"), process.platform === "win32" ? "junction" : "dir")
    const linkTarget = readlinkSync(join(path, "node_modules/shared"))
    const refs = git(a, "show-ref")
    const plan = await worktreeGc(a, true, false, { paths: [path], caller: a })
    assert.equal(plan[0]?.due, true)
    assert.equal(plan[0]?.removed, false)
    assert.equal(existsSync(join(projectDir(a), "preserved")), false)
    await assert.rejects(worktreeGc(a, false, true), /lacks Git metadata/)
    assert.ok(existsSync(path), "automatic collection does not quarantine an unreviewed remnant")
    const done = await worktreeGc(a, false, false, { paths: [path], caller: a })
    const result = done[0]
    assert.ok(result)
    assert.equal(result.quarantine, "complete", result.detail)
    assert.equal(result.removed, true)
    const preserved = result.preserved
    assert.ok(preserved)
    const checkout = join(preserved, "checkout")
    assert.equal(existsSync(path), false)
    assert.deepEqual(readFileSync(join(checkout, "local.config")), Buffer.from([0, 255, 23, 0]))
    assert.equal(readFileSync(join(checkout, "node_modules/local-package/unique.js"), "utf8"), "unknown ownership must retain these install bytes\n")
    assert.deepEqual(readFileSync(join(checkout, "coverage/opaque.dat")), Buffer.from([200, 0, 40, 0]))
    assert.equal(lstatSync(join(checkout, "node_modules/shared"), { throwIfNoEntry: false }), undefined)
    assert.equal(lstatSync(join(checkout, "a/b/c/d/e/node_modules"), { throwIfNoEntry: false }), undefined)
    assert.ok(lstatSync(join(checkout, "reference")).isSymbolicLink(), "non-dependency links remain opaque custody")
    assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "external bytes stay\n")
    assert.equal(git(a, "show-ref"), refs, "a Git-less remnant receives no guessed HEAD or reference")
    const manifest: unknown = JSON.parse(readFileSync(join(preserved, "manifest.json"), "utf8"))
    assert.ok(typeof manifest === "object" && manifest !== null && "state" in manifest && "metadata" in manifest)
    assert.equal(manifest.state, "complete")
    const metadata = manifest.metadata
    assert.ok(typeof metadata === "object" && metadata !== null && "links" in metadata && Array.isArray(metadata.links))
    assert.ok(metadata.links.some((link: unknown) => typeof link === "object" && link !== null && "path" in link && "target" in link && link.path === "node_modules/shared" && link.target === linkTarget))
})

void test("remnant scope rejects foreign, outside, nested and linked roots before moving any selected folder", async (t) => {
    const { base, a, b } = fixture(t)
    const worktrees = join(projectDir(a), "worktrees")
    const valid = join(worktrees, "valid-remnant")
    const foreign = join(projectDir(b), "worktrees", "foreign-remnant")
    const outside = join(base, "outside-remnant")
    const nested = join(worktrees, "container", "nested-remnant")
    const containsGit = join(worktrees, "nested-git-remnant")
    for (const path of [valid, foreign, outside, nested, join(containsGit, "node_modules", "vendored")]) {
        mkdirSync(path, { recursive: true })
        writeFileSync(join(path, "local.config"), "retain this scratch file\n")
    }
    writeFileSync(join(containsGit, "node_modules/vendored/.git"), "fixture metadata pointer\n")
    const alias = join(worktrees, "linked-root")
    symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir")
    const done = await worktreeGc(a, false, true, { paths: [valid, foreign, outside, nested, containsGit, alias], caller: a })
    assert.equal(done.length, 6)
    assert.equal(done[0]?.blocked, undefined)
    assert.ok(done.slice(1).every((entry) => entry.blocked === true))
    assert.ok(done.every((entry) => !entry.removed))
    assert.ok(existsSync(valid), "a blocked initial selection moves none of its otherwise valid paths")
    assert.ok(lstatSync(alias).isSymbolicLink())
    assert.equal(readFileSync(join(outside, "local.config"), "utf8"), "retain this scratch file\n")
    assert.equal(existsSync(join(projectDir(a), "preserved")), false)
})

void test("remnant custody refuses a changed file before the atomic rename", async (t) => {
    const { a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "changing-remnant")
    mkdirSync(path, { recursive: true })
    const file = join(path, "local.config")
    writeFileSync(file, "first bytes\n")
    let checks = 0
    await assert.rejects(quarantineRemnant(a, path, () => {
        checks += 1
        if (checks === 2) {
            writeFileSync(file, "other bytes\n")
            utimesSync(file, new Date(), new Date(Date.now() + 60_000))
        }
        return Promise.resolve()
    }), /changed before quarantine/)
    assert.equal(readFileSync(file, "utf8"), "other bytes\n")
    assert.ok(existsSync(path))
})

void test("remnant custody refuses a moved source and does not collect the folder replacing it", async (t) => {
    const { a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "replaced-remnant")
    const moved = join(projectDir(a), "worktrees", "moved-remnant")
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "local.config"), "original bytes\n")
    let checks = 0
    await assert.rejects(quarantineRemnant(a, path, () => {
        checks += 1
        if (checks === 2) {
            renameSync(path, moved)
            mkdirSync(path)
            writeFileSync(join(path, "local.config"), "replacement bytes\n")
        }
        return Promise.resolve()
    }), /changed before quarantine/)
    assert.equal(readFileSync(join(moved, "local.config"), "utf8"), "original bytes\n")
    assert.equal(readFileSync(join(path, "local.config"), "utf8"), "replacement bytes\n")
})

void test("a project state worktrees alias cannot establish remnant provenance", (t) => {
    const { base, a } = fixture(t)
    const outside = join(base, "aliased-state")
    mkdirSync(join(outside, "remnant"), { recursive: true })
    symlinkSync(outside, join(projectDir(a), "worktrees"), process.platform === "win32" ? "junction" : "dir")
    assert.throws(() => inspectRemnant(a, join(projectDir(a), "worktrees/remnant")), /canonical real directories/)
    assert.ok(existsSync(join(outside, "remnant")))
})

void test("a remnant's root dependency junction is unlinked while its target and all real files stay", async (t) => {
    const { base, a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "linked-install-remnant")
    const external = join(base, "root-install-target")
    mkdirSync(path, { recursive: true })
    mkdirSync(external)
    writeFileSync(join(path, "local.config"), "real remnant bytes\n")
    writeFileSync(join(external, "sentinel.txt"), "external install bytes\n")
    symlinkSync(external, join(path, "node_modules"), process.platform === "win32" ? "junction" : "dir")
    const custody = await quarantineRemnant(a, path, () => Promise.resolve())
    assert.equal(custody.quarantine, "complete", custody.detail)
    assert.equal(custody.removed, true)
    assert.equal(lstatSync(join(custody.directory, "checkout/node_modules"), { throwIfNoEntry: false }), undefined)
    assert.equal(readFileSync(join(custody.directory, "checkout/local.config"), "utf8"), "real remnant bytes\n")
    assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "external install bytes\n")
})

void test("a live worker blocks an explicitly selected remnant even with now", async (t) => {
    const { a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "live-remnant")
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "local.config"), "live worker bytes\n")
    const machine = openMachine()
    machine.exec("CREATE TABLE IF NOT EXISTS supervisor_workers (id TEXT, worktree TEXT, ended_at TEXT)")
    machine.prepare("INSERT INTO supervisor_workers (id,worktree,ended_at) VALUES (?,?,NULL)").run("live-remnant-worker", path)
    machine.close()
    const result = (await worktreeGc(a, false, true, { paths: [path], caller: a }))[0]
    assert.ok(result)
    assert.equal(result.blocked, true)
    assert.match(result.reason, /worker live-remnant-worker is live/)
    assert.equal(readFileSync(join(path, "local.config"), "utf8"), "live worker bytes\n")
})

void test("retired project collection refuses Git-less remnants until explicit custody review", async (t) => {
    const { a } = fixture(t)
    const path = join(projectDir(a), "worktrees", "retired-remnant")
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "local.config"), "retain retired bytes\n")
    const old = new Date(Date.now() - 60 * 60_000)
    utimesSync(path, old, old)
    const machine = openMachine()
    machine.prepare("UPDATE ledgers SET state = 'retired' WHERE repo_root = ?").run(a)
    machine.close()
    await assert.rejects(worktreeGc(a, false), /lacks Git metadata/)
    assert.equal(readFileSync(join(path, "local.config"), "utf8"), "retain retired bytes\n")
})

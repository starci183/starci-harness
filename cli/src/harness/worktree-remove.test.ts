// Safe worktree removal (`starci lane remove`) on real folders: a real git worktree holding directory junctions (a nested one too) to
// folders OUTSIDE it, the layout that emptied another lane's node_modules on 2026-11-20. The outside folders must survive.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Refusal } from "../shared/errors.js"
import { assertNotRemoving, releaseRemoveLock, removeLockFile, removeLockOf, takeRemoveLock } from "./remove-lock.js"
import { findLinks, planRemoval, removeWorktree, unlinkLinks } from "./worktree-remove.js"

const link = (target: string, path: string): void => {
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}
const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=rm", "-c", "user.email=rm@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" })

/** Test cleanup that never recurses through a junction: links are unlinked first. */
const cleanup = (world: { readonly root: string; readonly lane: string }): void => {
    if (existsSync(world.lane)) unlinkLinks(findLinks(world.lane))
    rmSync(world.root, { recursive: true, force: true })
}

interface Layout {
    readonly root: string
    readonly main: string
    readonly lane: string
    readonly outside: string
    readonly outsideTwo: string
    readonly locks: string
}

/** A repository, a lane worktree on lane/x with a junction to a folder outside it, a nested junction to a second one, and a workspace junction inside it. */
const layout = (): Layout => {
    const root = mkdtempSync(join(tmpdir(), "starci-rm-"))
    const main = join(root, "main")
    mkdirSync(main)
    git(main, "init", "-q", "-b", "main")
    mkdirSync(join(main, "packages", "w"), { recursive: true })
    writeFileSync(join(main, "packages", "w", "index.js"), "module.exports = 1\n")
    writeFileSync(join(main, ".gitignore"), "node_modules\n")
    git(main, "add", ".")
    git(main, "commit", "-q", "-m", "first")
    const lane = join(root, "lane")
    git(main, "worktree", "add", "-q", "-b", "lane/x", lane)
    const outside = join(root, "outside-install")
    const outsideTwo = join(root, "outside-other")
    for (const dir of [outside, outsideTwo]) {
        mkdirSync(join(dir, "deep"), { recursive: true })
        writeFileSync(join(dir, "keep.txt"), "keep\n")
        writeFileSync(join(dir, "deep", "keep.txt"), "keep deep\n")
    }
    mkdirSync(join(lane, "node_modules", "@scope"), { recursive: true })
    link(outside, join(lane, "node_modules", "@scope", "pkg"))
    link(join(lane, "packages", "w"), join(lane, "node_modules", "w"))
    mkdirSync(join(lane, "a", "b"), { recursive: true })
    link(outsideTwo, join(lane, "a", "b", "nested"))
    writeFileSync(join(lane, "scratch.txt"), "untracked\n")
    const locks = join(root, "locks")
    mkdirSync(locks)
    return { root, main, lane, outside, outsideTwo, locks }
}

void test("lane remove unlinks every junction, keeps every folder outside the worktree, removes the worktree and keeps the branch", async () => {
    const world = layout()
    process.env.STARCI_LANES_DIR = world.locks
    try {
        const plan = await planRemoval(world.lane, world.root, false)
        assert.deepEqual(plan.links.map((entry) => entry.relative).sort((left, right) => left.localeCompare(right)), ["a/b/nested", "node_modules/@scope/pkg", "node_modules/w"])
        const done = await removeWorktree(plan, "x", () => undefined)
        assert.equal(done.unlinked.length, 3)
        assert.ok(done.unlinked.every((entry) => entry.targetSurvived))
        assert.equal(existsSync(world.lane), false, "the worktree is gone")
        for (const dir of [world.outside, world.outsideTwo]) {
            assert.equal(readFileSync(join(dir, "keep.txt"), "utf8"), "keep\n", `${dir} survives`)
            assert.equal(readFileSync(join(dir, "deep", "keep.txt"), "utf8"), "keep deep\n")
        }
        assert.equal(readFileSync(join(world.main, "packages", "w", "index.js"), "utf8"), "module.exports = 1\n", "the main checkout is untouched")
        assert.match(git(world.main, "branch", "--list", "lane/x"), /lane\/x/, "the branch is kept")
        assert.doesNotMatch(git(world.main, "worktree", "list"), /lane$/m, "git forgot the worktree")
        assert.equal(removeLockOf(world.lane), undefined, "the removal lock is released")
        assert.equal(existsSync(removeLockFile(world.locks, world.lane)), false)
    } finally {
        delete process.env.STARCI_LANES_DIR
        cleanup(world)
    }
})

void test("findLinks lists a junction without entering it", () => {
    const world = layout()
    try {
        const links = findLinks(world.lane)
        assert.equal(links.length, 3)
        assert.ok(links.every((entry) => lstatSync(entry.path).isSymbolicLink()))
    } finally {
        cleanup(world)
    }
})

void test("lane remove refuses a main checkout, an unregistered folder and tracked changes", async () => {
    const world = layout()
    try {
        await assert.rejects(planRemoval(world.main, world.root, false), (error: unknown) => error instanceof Refusal && error.code === "WORKTREE_IS_MAIN")
        const loose = join(world.root, "loose")
        mkdirSync(loose)
        await assert.rejects(planRemoval(loose, world.root, false), (error: unknown) => error instanceof Refusal && error.code === "GIT_NOT_A_REPOSITORY")
        await assert.rejects(planRemoval(join(world.lane, "a"), world.root, false), (error: unknown) => error instanceof Refusal && error.code === "WORKTREE_NOT_REGISTERED")
        writeFileSync(join(world.lane, "packages", "w", "index.js"), "module.exports = 2\n")
        await assert.rejects(planRemoval(world.lane, world.root, false), (error: unknown) => error instanceof Refusal && error.code === "WORKTREE_DIRTY")
        const plan = await planRemoval(world.lane, world.root, true)
        assert.equal(plan.dirty.length, 1, "--discard passes with the change named")
    } finally {
        cleanup(world)
    }
})

void test("the removal lock stops installs in the worktree while it is held", () => {
    const world = layout()
    process.env.STARCI_LANES_DIR = world.locks
    try {
        assertNotRemoving(world.lane)
        const lock = takeRemoveLock(world.lane, "x")
        assert.match(readFileSync(lock.file, "utf8"), /^x \S+ pid=\d+ boot=\S+ host=\S+ path=/)
        assert.throws(() => { assertNotRemoving(join(world.lane, "packages", "w")) }, (error: unknown) => error instanceof Refusal && error.code === "WORKTREE_REMOVING")
        assert.throws(() => { takeRemoveLock(world.lane, "y") }, (error: unknown) => error instanceof Refusal && error.code === "WORKTREE_REMOVING")
        assertNotRemoving(world.main)
        assert.equal(releaseRemoveLock(lock), true)
        assertNotRemoving(world.lane)
    } finally {
        delete process.env.STARCI_LANES_DIR
        cleanup(world)
    }
})

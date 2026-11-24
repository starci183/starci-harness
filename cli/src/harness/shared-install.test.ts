// The shared install of a lane on real folders and a real git worktree: hard links from a copied cache entry, never from the dev checkout.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { installSatisfies } from "./install-cache.js"
import { followsBase, lifecycleOf, repoCacheDir, sharedInstall } from "./shared-install.js"
import type { SharedInstall } from "./shared-install.js"

const reasonOf = (result: SharedInstall): string => (result.status === "miss" ? result.reason : "")
const filesOf = (result: SharedInstall): number => (result.status === "linked" ? result.files : 0)

const git = (cwd: string, ...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" })
}
const LOCK = { name: "app", lockfileVersion: 3, packages: { "": { name: "app", workspaces: ["packages/*"] }, "packages/m": { name: "m", version: "1.0.0" }, "node_modules/dep": { version: "1.2.3" }, "node_modules/m": { resolved: "packages/m", link: true } } }

interface Layout {
    readonly top: string
    readonly dev: string
    readonly lane: string
    readonly lanes: string
}

/** A dev checkout holding a finished install (a package, a bin shim, a tool cache, a junction to its own workspace member) and a lane worktree without one. */
const layout = (): Layout => {
    const top = mkdtempSync(join(tmpdir(), "starci-shared-"))
    const dev = join(top, "dev")
    const lanes = join(top, "lanes")
    mkdirSync(join(dev, "packages", "m"), { recursive: true })
    mkdirSync(lanes)
    git(dev, "init", "-q", "-b", "dev")
    writeFileSync(join(dev, "package.json"), JSON.stringify({ name: "app", private: true, workspaces: ["packages/*"] }))
    writeFileSync(join(dev, "package-lock.json"), JSON.stringify(LOCK))
    writeFileSync(join(dev, "packages", "m", "package.json"), JSON.stringify({ name: "m", version: "1.0.0" }))
    writeFileSync(join(dev, ".gitignore"), "node_modules\n")
    git(dev, "add", ".")
    git(dev, "commit", "-q", "-m", "first")
    const modules = join(dev, "node_modules")
    mkdirSync(join(modules, "dep", "lib"), { recursive: true })
    mkdirSync(join(modules, ".bin"))
    mkdirSync(join(modules, ".cache", "tool"), { recursive: true })
    writeFileSync(join(modules, "dep", "index.js"), "module.exports = 1\n")
    writeFileSync(join(modules, "dep", "lib", "a.js"), "a\n")
    writeFileSync(join(modules, ".bin", "dep.cmd"), "@node dep\n")
    writeFileSync(join(modules, ".cache", "tool", "x"), "cache\n")
    writeFileSync(join(modules, ".package-lock.json"), JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "node_modules/dep": { version: "1.2.3" }, "node_modules/m": { resolved: "packages/m", link: true } } }))
    symlinkSync(join(dev, "packages", "m"), join(modules, "m"), process.platform === "win32" ? "junction" : "dir")
    const lane = join(top, "lane")
    git(dev, "worktree", "add", "-q", lane, "-b", "lane/x")
    return { top, dev, lane, lanes }
}

const ports = (given: Layout, scripts: string[] = []): Parameters<typeof sharedInstall>[1] => ({ lanes: given.lanes, say: () => undefined, runScript: (script) => { scripts.push(script); return Promise.resolve(true) } })

void test("a lane with the dev checkout's lockfiles gets its node_modules by hard links from a copied cache entry", async () => {
    const given = layout()
    const scripts: string[] = []
    const done = await sharedInstall(given.lane, { ...ports(given, scripts), mode: "link" })
    assert.equal(done.status, "linked", JSON.stringify(done))
    const dep = join(given.lane, "node_modules", "dep", "index.js")
    assert.equal(readFileSync(dep, "utf8"), "module.exports = 1\n")
    // The lane's file is a name of the cached file, and the dev checkout's own file is a different one: the dev checkout is never a link source.
    const entryFile = join(repoCacheDir(given.lanes, given.lane), readdirOnly(repoCacheDir(given.lanes, given.lane)), "tree", "node_modules", "dep", "index.js")
    assert.equal(statSync(dep).ino, statSync(entryFile).ino)
    assert.notEqual(statSync(dep).ino, statSync(join(given.dev, "node_modules", "dep", "index.js")).ino)
    assert.ok(statSync(dep).nlink >= 2)
    // npm rewrites these in place, so they are copies; a tool's own cache is not shared.
    assert.notEqual(statSync(join(given.lane, "node_modules", ".package-lock.json")).ino, statSync(join(given.dev, "node_modules", ".package-lock.json")).ino)
    assert.equal(statSync(join(given.lane, "node_modules", ".bin", "dep.cmd")).nlink, 1)
    assert.equal(existsSync(join(given.lane, "node_modules", ".cache")), false)
    // The workspace link points at the LANE's own member, not the dev checkout's.
    const member = join(given.lane, "node_modules", "m")
    assert.equal(lstatSync(member).isSymbolicLink(), true)
    assert.equal(readFileSync(join(member, "package.json"), "utf8").includes("\"m\""), true)
    assert.equal(statSync(join(member, "package.json")).ino, statSync(join(given.lane, "packages", "m", "package.json")).ino)
    assert.equal(installSatisfies(given.lane), true)
    rmSync(given.top, { recursive: true, force: true })
})

const readdirOnly = (dir: string): string => {
    const names = execFileSync(process.execPath, ["-e", "console.log(require('fs').readdirSync(process.argv[1]).filter((n) => !n.includes('.tmp-')).join('\\n'))", dir]).toString().trim().split("\n")
    assert.equal(names.length, 1)
    return names[0] ?? ""
}

void test("a later npm ci in the dev checkout, or a write to the lane's npm record, leaves the lane and the cache whole", async () => {
    const given = layout()
    assert.equal((await sharedInstall(given.lane, ports(given))).status, "linked")
    // npm ci removes the dev checkout's install: the junction first (as every removal of a worktree does), then the files.
    rmSync(join(given.dev, "node_modules", "m"), { recursive: true, force: false })
    rmSync(join(given.dev, "node_modules"), { recursive: true, force: true })
    assert.equal(readFileSync(join(given.lane, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 1\n")
    assert.equal(existsSync(join(given.dev, "packages", "m", "package.json")), true)
    // An in-place write of npm's record in the lane does not reach the cache.
    writeFileSync(join(given.lane, "node_modules", ".package-lock.json"), "{}")
    const second = join(given.top, "lane2")
    git(given.dev, "worktree", "add", "-q", second, "-b", "lane/y")
    const again = await sharedInstall(second, ports(given))
    assert.equal(again.status, "linked", JSON.stringify(again))
    assert.equal(installSatisfies(second), true)
    rmSync(given.top, { recursive: true, force: true })
})

void test("a lane whose lockfile differs from every install, or that already holds a node_modules, runs npm ci", async () => {
    const given = layout()
    writeFileSync(join(given.lane, "package-lock.json"), JSON.stringify({ ...LOCK, packages: { ...LOCK.packages, "node_modules/other": { version: "9.0.0" } } }))
    const differs = await sharedInstall(given.lane, ports(given))
    assert.equal(differs.status, "miss")
    assert.equal(existsSync(join(given.lane, "node_modules")), false, "a miss leaves nothing behind")
    const second = join(given.top, "lane2")
    git(given.dev, "worktree", "add", "-q", second, "-b", "lane/y")
    mkdirSync(join(second, "node_modules"))
    const there = await sharedInstall(second, ports(given))
    assert.equal(there.status, "miss")
    assert.match(reasonOf(there), /already there/)
    rmSync(given.top, { recursive: true, force: true })
})

void test("a dev checkout whose install is unfinished is no source, and a lane misses instead of reading it", async () => {
    const given = layout()
    rmSync(join(given.dev, "node_modules", ".package-lock.json"))
    const done = await sharedInstall(given.lane, ports(given))
    assert.equal(done.status, "miss")
    assert.equal(existsSync(join(given.lane, "node_modules")), false)
    rmSync(given.top, { recursive: true, force: true })
})

void test("the root lifecycle scripts npm ci runs are found, and a workspace member's install script makes the install unshareable", () => {
    const given = layout()
    assert.deepEqual(lifecycleOf(given.dev).root, [])
    writeFileSync(join(given.dev, "package.json"), JSON.stringify({ name: "app", workspaces: ["packages/*"], scripts: { prepare: "husky", build: "x" } }))
    assert.deepEqual(lifecycleOf(given.dev).root, ["prepare"])
    writeFileSync(join(given.dev, "packages", "m", "package.json"), JSON.stringify({ name: "m", version: "1.0.0", scripts: { postinstall: "x" } }))
    assert.equal(lifecycleOf(given.dev).member, "packages/m")
    rmSync(given.top, { recursive: true, force: true })
})

void test("a lane follows the base when no manifest, lockfile or .npmrc differs from it", () => {
    const given = layout()
    git(given.dev, "branch", "base")
    assert.equal(followsBase(given.lane, "base"), true)
    writeFileSync(join(given.lane, "README.md"), "x\n")
    git(given.lane, "add", ".")
    git(given.lane, "commit", "-q", "-m", "docs")
    assert.equal(followsBase(given.lane, "base"), true)
    writeFileSync(join(given.lane, "packages", "m", "package.json"), JSON.stringify({ name: "m", version: "1.0.1" }))
    git(given.lane, "commit", "-q", "-am", "bump")
    assert.equal(followsBase(given.lane, "base"), false)
    rmSync(given.top, { recursive: true, force: true })
})

void test("a big install is placed over worker threads and every file is a link or a copy of the cached one", async () => {
    const given = layout()
    const big = join(given.dev, "node_modules", "big")
    mkdirSync(join(big, "d"), { recursive: true })
    for (let index = 0; index < 4200; index += 1) writeFileSync(join(big, "d", `f${String(index)}.js`), `${String(index)}\n`)
    const done = await sharedInstall(given.lane, ports(given))
    assert.equal(done.status, "linked", JSON.stringify(done))
    assert.ok(filesOf(done) >= 4200)
    for (const index of [0, 2099, 4199]) assert.equal(readFileSync(join(given.lane, "node_modules", "big", "d", `f${String(index)}.js`), "utf8"), `${String(index)}\n`)
    assert.ok(statSync(join(given.lane, "node_modules", "big", "d", "f7.js")).nlink >= 2)
    rmSync(given.top, { recursive: true, force: true })
})

// The build-first half of `dev sync`: the staging worktree of a checkout at the new commit, the outputs its build produced, and the swap that moves them
// into the checkout, re-points the workspace links npm made into the staging tree, and puts every move back when one fails. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { OLD, outermost, realSwapFs, stageTree, stagedOutputs, stagedTrackedChanges, stagingPath, swapStaged } from "./stage.js"

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

const scratch = (t: { after: (fn: () => void) => void }): { readonly base: string; readonly checkout: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-stage-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const checkout = join(base, "app")
    mkdirSync(join(checkout, "packages", "ui"), { recursive: true })
    gitIn(base, "init", "-q", "-b", "dev", checkout)
    writeFileSync(join(checkout, ".gitignore"), "node_modules/\ndist/\n.env\n")
    writeFileSync(join(checkout, "package.json"), '{"name":"app","workspaces":["packages/*"]}\n')
    writeFileSync(join(checkout, "packages", "ui", "package.json"), '{"name":"@app/ui","main":"dist/index.js"}\n')
    gitIn(checkout, "add", ".")
    gitIn(checkout, "commit", "-q", "-m", "start")
    return { base, checkout }
}

void test("the staging worktree sits beside the checkout at the new commit, and is reset clean on the next sync", async (t) => {
    const { base, checkout } = scratch(t)
    const head = gitIn(checkout, "rev-parse", "HEAD")
    const staging = await stageTree(checkout, head)
    assert.equal(resolve(staging), resolve(join(base, ".app.starci-next")))
    assert.equal(staging, stagingPath(checkout))
    assert.equal(gitIn(staging, "rev-parse", "HEAD"), head)
    mkdirSync(join(staging, "node_modules"))
    writeFileSync(join(staging, "node_modules", "left"), "")
    writeFileSync(join(checkout, "packages", "ui", "index.ts"), "export const a = 1\n")
    gitIn(checkout, "add", ".")
    gitIn(checkout, "commit", "-q", "-m", "next")
    const next = gitIn(checkout, "rev-parse", "HEAD")
    assert.equal(await stageTree(checkout, next), staging)
    assert.equal(gitIn(staging, "rev-parse", "HEAD"), next)
    assert.equal(existsSync(join(staging, "node_modules")), false, "what a previous sync left is cleaned")
})

void test("the swap moves the staged build in, re-points the workspace links into the checkout, copies the changed pins and removes what it replaced", async (t) => {
    const { checkout } = scratch(t)
    const staging = await stageTree(checkout, gitIn(checkout, "rev-parse", "HEAD"))
    // The staged install and build: a root node_modules with a workspace link into the staging tree, and the package's dist.
    mkdirSync(join(staging, "node_modules", "@app"), { recursive: true })
    writeFileSync(join(staging, "node_modules", "dep.js"), "new\n")
    symlinkSync(join(staging, "packages", "ui"), join(staging, "node_modules", "@app", "ui"), process.platform === "win32" ? "junction" : "dir")
    mkdirSync(join(staging, "packages", "ui", "dist"), { recursive: true })
    writeFileSync(join(staging, "packages", "ui", "dist", "index.js"), "built\n")
    writeFileSync(join(staging, "package.json"), '{"name":"app","workspaces":["packages/*"],"dependencies":{"@starci/grammar":"0.57.1-dev.3"}}\n')
    // The running checkout's old install and a file the staging never has (its env).
    mkdirSync(join(checkout, "node_modules"))
    writeFileSync(join(checkout, "node_modules", "dep.js"), "old\n")
    writeFileSync(join(checkout, ".env"), "KEEP=1\n")
    const outputs = await stagedOutputs(staging)
    assert.deepEqual(outputs.toSorted((left, right) => left.localeCompare(right)), ["node_modules", "packages/ui/dist"])
    const tracked = await stagedTrackedChanges(staging)
    assert.deepEqual(tracked, ["package.json"])
    const swapped = await swapStaged(staging, checkout, outputs, tracked)
    assert.equal(readFileSync(join(checkout, "node_modules", "dep.js"), "utf8"), "new\n")
    assert.equal(readFileSync(join(checkout, "packages", "ui", "dist", "index.js"), "utf8"), "built\n")
    const link = join(checkout, "node_modules", "@app", "ui")
    assert.ok(lstatSync(link).isSymbolicLink())
    assert.equal(resolve(readlinkSync(link)).toLowerCase().replace(/[\\/]+$/u, ""), resolve(join(checkout, "packages", "ui")).toLowerCase())
    assert.equal(swapped.relinked, 1)
    assert.match(readFileSync(join(checkout, "package.json"), "utf8"), /0\.57\.1-dev\.3/u)
    assert.equal(readFileSync(join(checkout, ".env"), "utf8"), "KEEP=1\n", "what the staging never built stays")
    assert.equal(existsSync(join(checkout, `node_modules${OLD}`)), false)
    assert.deepEqual(swapped.leftover, [])
})

void test("a move that fails puts every earlier move back and refuses DEV_SYNC_SWAP: the checkout keeps its running install", async (t) => {
    const { checkout } = scratch(t)
    const staging = await stageTree(checkout, gitIn(checkout, "rev-parse", "HEAD"))
    mkdirSync(join(staging, "node_modules"))
    writeFileSync(join(staging, "node_modules", "dep.js"), "new\n")
    mkdirSync(join(staging, "packages", "ui", "dist"), { recursive: true })
    mkdirSync(join(checkout, "node_modules"))
    writeFileSync(join(checkout, "node_modules", "dep.js"), "old\n")
    const held = { ...realSwapFs, rename: (from: string, to: string): void => {
        if (from.endsWith("dist") && from.startsWith(staging)) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
        renameSync(from, to)
    } }
    await assert.rejects(swapStaged(staging, checkout, ["node_modules", "packages/ui/dist"], [], held, () => Promise.resolve()), (error: { code?: string }) => error.code === "DEV_SYNC_SWAP")
    assert.equal(readFileSync(join(checkout, "node_modules", "dep.js"), "utf8"), "old\n")
    assert.equal(readFileSync(join(staging, "node_modules", "dep.js"), "utf8"), "new\n")
    assert.equal(existsSync(join(checkout, `node_modules${OLD}`)), false)
})

void test("husky's generated .husky/_ (a .gitignore of `*` inside) is staged as ONE folder, and the swap moves it whole instead of failing on the files inside (DEV_SYNC_SWAP of 2026-11-24)", async (t) => {
    const { checkout } = scratch(t)
    mkdirSync(join(checkout, ".husky"), { recursive: true })
    writeFileSync(join(checkout, ".husky", "pre-push"), "npx starci\n")
    gitIn(checkout, "add", ".")
    gitIn(checkout, "commit", "-q", "-m", "husky")
    const staging = await stageTree(checkout, gitIn(checkout, "rev-parse", "HEAD"))
    mkdirSync(join(staging, ".husky", "_"), { recursive: true })
    writeFileSync(join(staging, ".husky", "_", ".gitignore"), "*")
    writeFileSync(join(staging, ".husky", "_", "h"), "new\n")
    mkdirSync(join(staging, "node_modules"))
    const outputs = await stagedOutputs(staging)
    assert.deepEqual(outputs.filter((entry) => entry.startsWith(".husky")), [".husky/_"], "git lists the folder and each file in it; only the folder is an output")
    mkdirSync(join(checkout, ".husky", "_"), { recursive: true })
    writeFileSync(join(checkout, ".husky", "_", "h"), "old\n")
    const swapped = await swapStaged(staging, checkout, [...outputs, ".husky/_/.gitignore", ".husky/_/h"], [], realSwapFs, () => Promise.resolve())
    assert.deepEqual(swapped.moved.filter((entry) => entry.startsWith(".husky")), [".husky/_"])
    assert.equal(readFileSync(join(checkout, ".husky", "_", "h"), "utf8"), "new\n")
    assert.equal(readFileSync(join(checkout, ".husky", "_", ".gitignore"), "utf8"), "*")
    assert.equal(existsSync(join(checkout, ".husky", `_${OLD}`)), false)
})

void test("outermost keeps an entry only when no other listed entry contains it", () => {
    assert.deepEqual(outermost(["node_modules", "a/b/dist", "a/b/dist/x.js", ".husky/_", ".husky/_/h", "ab", "a/bc"]), ["node_modules", "a/b/dist", ".husky/_", "ab", "a/bc"])
})

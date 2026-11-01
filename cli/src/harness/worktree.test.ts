// A worktree of a product that declares husky gets husky installed, so its pre-commit gate fires: the install comes from the main
// checkout's own copy when the worktree has no node_modules, and a worktree that still lacks it is refused. Real git, a fixture husky
// whose bin writes the folder and sets core.hooksPath the way husky 9 does; built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { assertWorktreeHooks, declaresHusky, materialiseHooks, requiredHooksPath } from "./worktree.js"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim()

const HUSKY_BIN = [
    'const fs = require("node:fs")',
    'const { execFileSync } = require("node:child_process")',
    'fs.mkdirSync(".husky/_", { recursive: true })',
    'fs.writeFileSync(".husky/_/h", "#!/usr/bin/env sh")',
    'fs.writeFileSync(".husky/_/pre-commit", "#!/usr/bin/env sh")',
    'execFileSync("git", ["config", "core.hooksPath", ".husky/_"])',
].join("\n")

/** A product repository that tracks .husky/pre-commit and has husky installed in its main checkout, plus a linked worktree of it. */
const product = (t: { after: (fn: () => void) => void }, installed: boolean): { readonly root: string; readonly worktree: string } => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-husky-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    const root = join(base, "app")
    mkdirSync(join(root, ".husky"), { recursive: true })
    git(base, "init", "-q", "-b", "main", root)
    writeFileSync(join(root, ".husky", "pre-commit"), "#!/bin/sh\nexit 0\n")
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { husky: "9.1.7" } }))
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "init")
    if (installed) {
        mkdirSync(join(root, "node_modules", "husky"), { recursive: true })
        writeFileSync(join(root, "node_modules", "husky", "package.json"), JSON.stringify({ name: "husky", version: "9.1.7", bin: "bin.js" }))
        writeFileSync(join(root, "node_modules", "husky", "bin.js"), HUSKY_BIN)
    }
    const worktree = join(base, "wt")
    git(root, "worktree", "add", "-q", "-b", "work", worktree)
    return { root, worktree }
}

void test("a tracked husky folder counts as husky declared and names .husky/_ even with core.hooksPath unset", async (t) => {
    const { root } = product(t, false)
    assert.equal(declaresHusky(root), true)
    assert.equal(await requiredHooksPath(root), ".husky/_")
})

void test("a worktree without node_modules gets husky from the main checkout, and its gate is judged ready", async (t) => {
    const { root, worktree } = product(t, true)
    await assert.rejects(assertWorktreeHooks(worktree), { code: "WORKTREE_HOOKS_MISSING" })
    assert.equal(await materialiseHooks(root, worktree), ".husky/_")
    assert.equal(existsSync(join(worktree, ".husky", "_", "h")), true)
    assert.equal(git(worktree, "config", "--get", "core.hooksPath"), ".husky/_")
    await assert.doesNotReject(assertWorktreeHooks(worktree))
})

void test("husky declared but installed nowhere is refused, never passed as a gate", async (t) => {
    const { root, worktree } = product(t, false)
    await materialiseHooks(root, worktree)
    await assert.rejects(assertWorktreeHooks(worktree), (error: unknown) => error instanceof Error && error.message.includes("core.hooksPath is not set"))
})

void test("a product that declares no husky and no hooks path is left alone", async (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-nohusky-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    git(base, "init", "-q", "-b", "main", join(base, "app"))
    assert.equal(await materialiseHooks(join(base, "app"), join(base, "app")), undefined)
    await assert.doesNotReject(assertWorktreeHooks(join(base, "app")))
})

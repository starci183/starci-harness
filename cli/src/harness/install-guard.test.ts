// The install guard (contexts/harness/host.md "Dependencies through a link") on real folders: junctions or symlinks, and real git worktrees.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { installRefusals, installTarget, shellCommands, shellWords } from "./install-guard.js"

const link = (target: string, path: string): void => {
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}
const git = (cwd: string, ...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" })
}

/** A repository with a real install in its main checkout and a second worktree whose node_modules is a junction to it: tonight's layout. */
const sharedLayout = (): { root: string; main: string; lane: string; shared: string } => {
    const root = mkdtempSync(join(tmpdir(), "starci-guard-"))
    const main = join(root, "main")
    mkdirSync(main)
    git(main, "init", "-q", "-b", "main")
    writeFileSync(join(main, "package.json"), "{\"name\":\"x\",\"private\":true}\n")
    writeFileSync(join(main, ".gitignore"), "node_modules\n")
    git(main, "add", ".")
    git(main, "commit", "-q", "-m", "first")
    const shared = join(main, "node_modules")
    mkdirSync(join(shared, "dep"), { recursive: true })
    writeFileSync(join(shared, "dep", "index.js"), "module.exports = 1\n")
    const lane = join(root, "lane")
    git(main, "worktree", "add", "-q", lane, "-b", "lane")
    link(shared, join(lane, "node_modules"))
    return { root, main, lane, shared }
}

void test("a command line splits at every chain and background operator and keeps quoted text whole", () => {
    assert.deepEqual(shellCommands("cd a && npm ci; echo 'x && y' | cat & npm i"), ["cd a", "npm ci", "echo 'x && y'", "cat", "npm i"])
    assert.deepEqual(shellWords("npm --prefix \"a b\" ci"), ["npm", "--prefix", "a b", "ci"])
})

void test("every writing subcommand of npm, pnpm and yarn is a target, and a read-only or global one is not", () => {
    for (const words of [["npm", "ci"], ["npm", "i"], ["npm", "uninstall", "x"], ["npm", "update"], ["npm", "prune"], ["npm", "dedupe"], ["npm", "rebuild"], ["npm", "link"], ["pnpm", "install"], ["pnpm", "add", "x"], ["yarn"], ["yarn", "add", "x"], ["npm.cmd", "install"]]) {
        assert.notEqual(installTarget(words, "/w"), undefined, words.join(" "))
    }
    for (const words of [["npm", "run", "build"], ["npm", "test"], ["npm", "i", "-g", "x"], ["npx", "tsc"], ["yarn", "global", "add", "x"], ["pnpm", "exec", "x"]]) {
        assert.equal(installTarget(words, "/w"), undefined, words.join(" "))
    }
    assert.equal(installTarget(["npm", "--prefix", "sub", "ci"], "/w")?.dir, resolve("/w", "sub"))
})

void test("tonight's scenario: npm ci in a lane whose node_modules is a junction to the main install is refused, chained or in the background, and the shared install survives", () => {
    const { root, main, lane, shared } = sharedLayout()
    try {
        for (const line of ["npm ci", "npm install", "cd . && npm ci --no-audit", "echo go; npm ci", "start /b npm ci", "npm ci &", "cmd /c \"npm ci\"", "sh -c 'npm uninstall dep'", "pnpm install", "yarn"]) {
            const refusals = installRefusals(line, lane)
            assert.equal(refusals.length, 1, line)
            assert.equal(refusals[0]?.reason, "linked", line)
        }
        assert.equal(installRefusals(`cd ${lane} && npm ci`, root)[0]?.reason, "linked", "a cd into the lane is followed")
        assert.equal(installRefusals(`npm --prefix ${lane} ci`, root)[0]?.reason, "linked", "--prefix names the target")
        assert.deepEqual(readdirSync(shared), ["dep"], "the guard only reads; the shared install is untouched")
        // The other side of the junction: the main checkout's real install is the one the lane links to.
        const fromMain = installRefusals("npm ci", main)
        assert.deepEqual(fromMain.map((refusal) => refusal.reason), ["shared"])
        assert.match(fromMain.map((refusal) => refusal.holder).join(""), /lane/u)
    } finally {
        rmSync(join(lane, "node_modules"))
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a private install, a read-only command and an install with no node_modules yet are allowed", () => {
    const { root, main, lane } = sharedLayout()
    try {
        rmSync(join(lane, "node_modules"))
        assert.deepEqual(installRefusals("npm ci", lane), [], "no node_modules yet: the lane installs its own")
        assert.deepEqual(installRefusals("npm ci", main), [], "no worktree links to the main install any more")
        assert.deepEqual(installRefusals("npm run build && npm test", main), [], "nothing writes node_modules")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { BEGIN_MARKER, END_MARKER } from "../core/contexts/anatomy-render.js"
import { GENERATED_COMMIT_MESSAGE, commitGenerated } from "./lane-generated.js"

const put = (root: string, path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
}

const git = (root: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: root, encoding: "utf8" }).trim()

/** A harness worktree with a stale generated block, committed. */
const lane = (): string => {
    const root = mkdtempSync(join(tmpdir(), "lane-generated-"))
    put(root, "ops/checks.yaml", "checks: []\n")
    put(root, "contexts/hfs/slots.yaml", "slots: []\n")
    put(root, "contexts/hfs/rules.yaml", "enforcerKinds:\n  hfs: a check of the hfs CLI\nrules: []\n")
    mkdirSync(join(root, "contexts/code/be"), { recursive: true })
    put(root, "contexts/code/be/.gitkeep", "")
    put(root, "contexts/code/fe/.gitkeep", "")
    put(root, "contexts/project/anatomy.md", `# Anatomy\n\n${BEGIN_MARKER}\nstale\n${END_MARKER}\n`)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root
}

void test("a lane's gate regenerates the stale generated files and commits only them with the lane", async () => {
    const root = lane()
    try {
        put(root, "contexts/harness/extra.md", "# Extra\n\nA page the lane added.\n")
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "lane: a docs change")
        put(root, "notes.txt", "not generated, not committed")
        const done = await commitGenerated(root)
        assert.ok(done.files.includes("contexts/project/index.md"), "the stale index is regenerated")
        assert.ok(done.files.includes("contexts/project/anatomy.md"))
        assert.ok(!done.files.includes("notes.txt"))
        assert.equal(git(root, "log", "-1", "--format=%s"), GENERATED_COMMIT_MESSAGE)
        assert.equal(git(root, "log", "-1", "--format=%H"), done.sha)
        const committed = git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort((left, right) => left.localeCompare(right))
        assert.deepEqual(committed, [...done.files].sort((left, right) => left.localeCompare(right)))
        assert.equal(git(root, "status", "--porcelain"), "?? notes.txt", "only the unrelated file stays outside the commit")
        assert.ok(git(root, "show", "HEAD:contexts/project/index.md").includes("harness/extra.md"), "the committed index lists the new page")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a lane whose generated files are current commits nothing", async () => {
    const root = lane()
    try {
        await commitGenerated(root)
        const head = git(root, "rev-parse", "HEAD")
        const again = await commitGenerated(root)
        assert.deepEqual(again, { files: [] })
        assert.equal(git(root, "rev-parse", "HEAD"), head)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a tree that is no harness is left alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "lane-generated-app-"))
    try {
        assert.deepEqual(await commitGenerated(root), { files: [] })
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// A lander batch merges lanes with `git merge`; two lanes each appending a bullet under "## Unreleased" of a changelog must merge with both bullets kept
// (root .gitattributes: CHANGELOG.md and packages/*/CHANGELOG.md use the union merge).
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" })

void test("two branches appending different bullets under Unreleased merge cleanly with both bullets kept", () => {
    const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim()
    const dir = mkdtempSync(join(tmpdir(), "changelog-union-"))
    try {
        git(dir, "init", "-q", "-b", "base")
        copyFileSync(join(root, ".gitattributes"), join(dir, ".gitattributes"))
        const files = ["CHANGELOG.md", "packages/grammar/CHANGELOG.md"]
        mkdirSync(join(dir, "packages/grammar"), { recursive: true })
        for (const file of files) writeFileSync(join(dir, file), "# Changelog\n\n## Unreleased\n\n- base bullet\n")
        git(dir, "add", "-A")
        git(dir, "commit", "-qm", "base")
        for (const name of ["a", "b"]) {
            git(dir, "checkout", "-q", "-b", name, "base")
            for (const file of files) writeFileSync(join(dir, file), `# Changelog\n\n## Unreleased\n\n- base bullet\n- bullet ${name}\n`)
            git(dir, "commit", "-qam", name)
        }
        git(dir, "checkout", "-q", "a")
        git(dir, "merge", "--no-ff", "--no-edit", "b")
        for (const file of files) {
            const text = readFileSync(join(dir, file), "utf8")
            for (const bullet of ["- base bullet", "- bullet a", "- bullet b"]) assert.ok(text.includes(bullet), `${file} keeps ${bullet}`)
        }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

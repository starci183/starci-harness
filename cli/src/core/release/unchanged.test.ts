// A raised version whose content equals the version npm serves is skipped, never published (decision release-only-what-changed): only bookkeeping
// (the CHANGELOG, the lockfile, the version field of package.json) moved; any shipped file or any other package.json field is a change.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { shipsTheSame } from "./publish.js"

const repoWith = () => {
    const root = mkdtempSync(join(tmpdir(), "starci-unchanged-"))
    const git = (...args: string[]) => {
        const run = captureGitSync(["-c", "user.name=spec", "-c", "user.email=spec@example.invalid", "-c", "commit.gpgsign=false", ...args], root)
        assert.equal(run.exitCode, 0, run.stderr)
        return run.stdout.trim()
    }
    const write = (file: string, text: string) => {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        writeFileSync(join(root, file), text)
    }
    git("init", "-q")
    write("packages/canon/package.json", JSON.stringify({ name: "@starci/canon", version: "1.0.0", peerDependencies: { "@starci/hfs": "~5.13.0" } }))
    write("packages/canon/CHANGELOG.md", "# Changelog\n")
    write("packages/canon/src/index.ts", "export const rule = 1\n")
    write("packages/canon/src/index.spec.ts", "// spec\n")
    git("add", "-A")
    git("commit", "-qm", "served")
    const served = git("rev-parse", "HEAD")
    const commit = (files: Readonly<Record<string, string>>) => {
        for (const [file, text] of Object.entries(files)) write(file, text)
        git("add", "-A")
        git("commit", "-qm", "next")
    }
    return { root, served, commit, cleanup: () => { rmSync(root, { recursive: true, force: true }) } }
}

void test("a raise that only moves the version, the CHANGELOG and a spec ships the same; a source or requirement change does not", async () => {
    const repo = repoWith()
    try {
        repo.commit({
            "packages/canon/package.json": JSON.stringify({ name: "@starci/canon", version: "1.0.1", peerDependencies: { "@starci/hfs": "~5.13.0" } }),
            "packages/canon/CHANGELOG.md": "# Changelog\n\n## 1.0.1\n",
            "packages/canon/src/index.spec.ts": "// spec, more\n",
        })
        assert.equal(await shipsTheSame(repo.root, repo.served, "packages/canon"), true, "nothing it ships moved: skipped")
        repo.commit({ "packages/canon/package.json": JSON.stringify({ name: "@starci/canon", version: "1.0.1", peerDependencies: { "@starci/hfs": "~5.14.0" } }) })
        assert.equal(await shipsTheSame(repo.root, repo.served, "packages/canon"), false, "a requirement moved: published")
    } finally { repo.cleanup() }
    const source = repoWith()
    try {
        source.commit({ "packages/canon/src/index.ts": "export const rule = 2\n" })
        assert.equal(await shipsTheSame(source.root, source.served, "packages/canon"), false, "a shipped source moved: published")
    } finally { source.cleanup() }
})

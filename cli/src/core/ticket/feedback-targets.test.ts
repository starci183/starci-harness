import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { addFeedback } from "../../harness/feedback.js"
import { closeFeedbackItem } from "./feedback.js"
import { resolveTarget } from "./feedback-targets.js"

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim()

/** A scratch git repository with one commit; the ledger lives in a scratch STARCI_LOCAL_ROOT. */
const withScratch = (work: (repo: string, sha: string) => void): void => {
    const base = mkdtempSync(join(tmpdir(), "starci-feedback-"))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    try {
        const repo = join(base, "app")
        mkdirSync(repo)
        git(repo, "init", "-q")
        writeFileSync(join(repo, "a.txt"), "a")
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "fix the cause")
        work(repo, git(repo, "rev-parse", "HEAD"))
    } finally {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    }
}

void test("root-fix resolves a commit of another repository by path and sha, verified with git in that path", () => {
    withScratch((repo, sha) => {
        const resolved = resolveTarget("root-fix", `${repo}@${sha.slice(0, 9)}`)
        assert.equal(resolved.target, `${repo}@${sha}`)
        assert.match(resolved.evidence, /"fix the cause"/)
        assert.throws(() => resolveTarget("root-fix", `${repo}@${"0".repeat(40)}`), /no commit/)
        assert.throws(() => resolveTarget("root-fix", `${join(repo, "missing")}@${sha}`), /not a directory/)
        assert.throws(() => resolveTarget("root-fix", `${tmpdir()}@${sha}`), /not a git work tree|no commit/)
        assert.throws(() => resolveTarget("root-fix", `${repo}@not-a-sha`), /sha of 7 to 40 hex digits/)
    })
})

void test("a feedback closes as root-fix and as declined; declined needs a reason and no target", () => {
    withScratch((repo, sha) => {
        const first = addFeedback("one", "2026-01-01", "fb-a").item
        const second = addFeedback("two", "2026-01-01", "fb-b").item
        assert.throws(() => closeFeedbackItem(second.id, "declined", undefined, undefined), /needs --reason/)
        assert.throws(() => closeFeedbackItem(second.id, "declined", undefined, "   "), /needs --reason/)
        assert.throws(() => closeFeedbackItem(second.id, "declined", sha, "no"), /no --target/)
        assert.throws(() => closeFeedbackItem(first.id, "root-fix", `${repo}@${sha}`, "why"), /only with --target-kind declined/)
        const fixed = closeFeedbackItem(first.id, "root-fix", `${repo}@${sha}`, undefined)
        assert.match(fixed.message, /closed on root-fix/)
        const declined = closeFeedbackItem(second.id, "declined", undefined, "not a bug class")
        assert.deepEqual((declined.data as { item: { status: string; targetKind: string; target: null; evidence: string } }).item, { ...(declined.data as { item: object }).item, status: "closed", targetKind: "declined", target: null, evidence: "not a bug class" })
        assert.match(closeFeedbackItem(second.id, "declined", undefined, "other").message, /already closed/)
    })
})

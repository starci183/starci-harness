// `starci app push`: the check runs first, the records it writes are committed as their own commit, and git push runs once (core/app/push.ts).
import assert from "node:assert/strict"
import test from "node:test"
import { porcelainPath, warmAndPush, type PushPorts, type PushRun } from "./push.js"

interface Script {
    /** What each check run prints and whether it leaves cache files dirty, in order. */
    readonly checks: readonly { readonly exitCode: number; readonly findings: readonly object[]; readonly writes?: boolean }[]
    readonly outside?: readonly string[]
    readonly pushExit?: number
    readonly commitExit?: number
}

const CACHE_LINE = "?? .starcistacks/cache/check/hfs/a.jsonl"

const harness = (script: Script): { ports: PushPorts; log: string[] } => {
    const log: string[] = []
    let cacheDirty = false
    let run = 0
    let head = 0
    const ports: PushPorts = {
        git: (args): PushRun => {
            if (args[0] === "status") {
                const outside = args.includes("--") ? [] : (script.outside ?? []).map((file) => ` M ${file}`)
                return { exitCode: 0, stdout: [...outside, ...(cacheDirty ? [CACHE_LINE] : [])].join("\n") }
            }
            if (args[0] === "rev-parse") return { exitCode: 0, stdout: `sha${String(head)}\n` }
            if (args[0] === "add") {
                log.push("add")
                return { exitCode: 0, stdout: "" }
            }
            if (args[0] === "commit") {
                log.push(`commit ${args[2] ?? ""}`)
                if ((script.commitExit ?? 0) !== 0) return { exitCode: script.commitExit ?? 1, stdout: "hook said no" }
                cacheDirty = false
                head += 1
                return { exitCode: 0, stdout: "" }
            }
            return { exitCode: 0, stdout: "" }
        },
        check: (): PushRun => {
            const step = script.checks[Math.min(run, script.checks.length - 1)]
            run += 1
            log.push("check")
            if (step?.writes === true) cacheDirty = true
            return { exitCode: step?.exitCode ?? 0, stdout: JSON.stringify({ ok: step?.exitCode === 0, data: { output: { findings: step?.findings ?? [] } } }) }
        },
        push: (args): number => {
            log.push(`push ${args.join(" ")}`)
            return script.pushExit ?? 0
        },
        say: () => undefined,
    }
    return { ports, log }
}

/** What a run that wrote records its commit lacks reports: info, the run stays green (hfs cache/freshness.mts). */
const UNWARMED = { code: "HFS_CHECK_CACHE_UNWARMED", level: "info", path: ".starcistacks/cache" }

void test("a cold cache: check writes it, one commit carries it, the proving check writes nothing, then one push", () => {
    const { ports, log } = harness({ checks: [{ exitCode: 0, findings: [UNWARMED], writes: true }, { exitCode: 0, findings: [] }] })
    const outcome = warmAndPush(ports, ["origin", "dev"])
    assert.deepEqual(log, ["check", "add", "commit chore(cache): warm the check cache for sha0", "check", "push origin dev"])
    assert.equal(outcome.pushed, true)
    assert.equal(outcome.exitCode, 0)
    assert.equal(outcome.commits.length, 1)
})

void test("a warm cache pushes without a commit", () => {
    const { ports, log } = harness({ checks: [{ exitCode: 0, findings: [] }] })
    const outcome = warmAndPush(ports, [])
    assert.deepEqual(log, ["check", "push "])
    assert.equal(outcome.commits.length, 0)
})

void test("a record the commit itself moves is settled by a second commit, never an amend, and a third run is the limit", () => {
    const twice = harness({ checks: [{ exitCode: 0, findings: [UNWARMED], writes: true }, { exitCode: 0, findings: [UNWARMED], writes: true }, { exitCode: 0, findings: [] }] })
    const settled = warmAndPush(twice.ports, [])
    assert.equal(settled.pushed, true)
    assert.equal(settled.commits.length, 2)
    assert.equal(twice.log.filter((line) => line.startsWith("commit")).length, 2)
    const never = harness({ checks: [{ exitCode: 0, findings: [UNWARMED], writes: true }] })
    const stuck = warmAndPush(never.ports, [])
    assert.equal(stuck.pushed, false)
    assert.equal(stuck.exitCode, 1)
    assert.equal(stuck.runs, 3)
    assert.equal(never.log.some((line) => line.startsWith("push")), false)
})

void test("a red check stops before any commit or push", () => {
    const { ports, log } = harness({ checks: [{ exitCode: 1, findings: [UNWARMED, { code: "LINT_X", level: "error", path: "fe/a.ts" }], writes: true }] })
    const outcome = warmAndPush(ports, [])
    assert.equal(outcome.pushed, false)
    assert.equal(outcome.exitCode, 1)
    assert.match(outcome.refusal ?? "", /LINT_X fe\/a\.ts/u)
    assert.deepEqual(log, ["check"])
})

void test("a report-only finding does not block, and an unreadable report refuses", () => {
    const reported = harness({ checks: [{ exitCode: 0, findings: [{ code: "LINT_Y", level: "error", report: true }] }] })
    assert.equal(warmAndPush(reported.ports, []).pushed, true)
    const broken = harness({ checks: [{ exitCode: 1, findings: [] }] })
    assert.equal(warmAndPush(broken.ports, []).pushed, false)
})

void test("uncommitted work outside the cache is refused before any check", () => {
    const { ports, log } = harness({ checks: [{ exitCode: 0, findings: [] }], outside: ["fe/src/a.ts"] })
    const outcome = warmAndPush(ports, [])
    assert.equal(outcome.exitCode, 2)
    assert.match(outcome.refusal ?? "", /HFS_PUSH_DIRTY_TREE/u)
    assert.deepEqual(log, [])
})

void test("a refused cache commit (its hook) and a refused push are reported, never forced", () => {
    const commit = harness({ checks: [{ exitCode: 0, findings: [UNWARMED], writes: true }], commitExit: 1 })
    const refused = warmAndPush(commit.ports, [])
    assert.equal(refused.pushed, false)
    assert.match(refused.refusal ?? "", /cache commit failed/u)
    const push = harness({ checks: [{ exitCode: 0, findings: [] }], pushExit: 1 })
    const rejected = warmAndPush(push.ports, [])
    assert.equal(rejected.pushed, false)
    assert.equal(rejected.exitCode, 1)
})

void test("porcelainPath keeps the leading dot when the port trimmed the first line's leading space", () => {
    assert.equal(porcelainPath("M .starcistacks/cache/x.jsonl"), ".starcistacks/cache/x.jsonl")
    assert.equal(porcelainPath(" M .starcistacks/cache/x.jsonl"), ".starcistacks/cache/x.jsonl")
    assert.equal(porcelainPath("?? .github/a.yml"), ".github/a.yml")
    assert.equal(porcelainPath("M  src/a.ts"), "src/a.ts")
    assert.equal(porcelainPath(""), "")
})

void test("a dirty first line that lost its leading space is reported with its full path", () => {
    const { ports } = harness({ checks: [{ exitCode: 0, findings: [] }] })
    const status = (stdout: string): PushPorts => ({ ...ports, git: (args) => (args[0] === "status" ? { exitCode: 0, stdout } : ports.git(args)) })
    assert.match(warmAndPush(status("M .github/a.yml"), []).refusal ?? "", /\(\.github\/a\.yml\)/)
})

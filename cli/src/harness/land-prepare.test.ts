// The batch lander and a tree that fails to prepare (npm ci, codegen, build:modules) before the gate: the batch tries each lane alone on dev and
// rejects the lane that breaks the build with its output, so the same failing batch never forms again; a dev that fails by itself blames nobody.
// A real batch over a scratch origin, its prepare step replaced by one that fails on a marker file.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../shared/git.js"
import { judgePrepare, runBatch } from "./land-batch.js"
import type { BatchOptions, PrepareVerdict } from "./land-batch.js"
import { readStatuses, readyEntries, writeReady } from "./land-queue.js"
import type { LaneFinding, ReadyEntry } from "./land-queue.js"
import type { LandProfile } from "./land-profile.js"
import type { PrepareFailure } from "./prepare-tree.js"

const entry = (lane: string, sha = lane.padEnd(40, "0")): ReadyEntry => ({ lane, branch: `lane/${lane}`, sha, at: "2026-11-22T00:00:00Z" })
const BUILD_RED: PrepareFailure = { command: "npm run build:modules", exitCode: 1, output: "Module not found: Can't resolve '@starci/nivo-icons'" }

/** The blamed lanes of a verdict that blames, failing the spec on any other verdict. */
const blamedOf = (verdict: PrepareVerdict): ReadonlyMap<string, readonly LaneFinding[]> => {
    if (verdict.kind !== "blame") assert.fail(`expected a blame, got ${verdict.kind}`)
    return verdict.blamed
}

void test("a lane that fails to build alone is blamed with its own output; the lanes that build alone are not", async () => {
    const tried: string[] = []
    const verdict = await judgePrepare([entry("chat-card-v2"), entry("agent-hub")], BUILD_RED, (lane) => {
        tried.push(lane.lane)
        return Promise.resolve(lane.lane === "agent-hub" ? { ...BUILD_RED, output: "agent-hub: error TS2307" } : undefined)
    }, () => Promise.reject(new Error("dev is prepared only when every lane fails alone")))
    assert.deepEqual(tried, ["chat-card-v2", "agent-hub"])
    const blamed = blamedOf(verdict)
    assert.deepEqual([...blamed.keys()], ["agent-hub"])
    const finding = blamed.get("agent-hub")?.[0]
    assert.equal(finding?.code, "LANE_LAND_PREPARE")
    assert.match(finding.message, /npm run build:modules exited 1 with only your lane merged onto dev:\nagent-hub: error TS2307/u)
})

void test("lanes that build alone but not together are all rejected; a batch whose dev fails by itself blames nobody", async () => {
    const together = await judgePrepare([entry("a"), entry("bb")], BUILD_RED, () => Promise.resolve(undefined), () => Promise.resolve(undefined))
    assert.deepEqual([...blamedOf(together).keys()], ["a", "bb"])
    assert.match(together.kind === "blame" ? together.why : "", /^nothing landed: npm run build:modules fails on the batch \(a, bb\) though each lane passes it alone/u)
    const dev = await judgePrepare([entry("a"), entry("bb")], BUILD_RED, () => Promise.resolve(BUILD_RED), () => Promise.resolve(BUILD_RED))
    assert.deepEqual(dev, { kind: "dev", failure: BUILD_RED })
    // One lane: its batch is the lane alone, so only dev is prepared to tell the lane's fault from dev's.
    let alone = 0
    const one = await judgePrepare([entry("a")], BUILD_RED, () => Promise.resolve(BUILD_RED).finally(() => (alone += 1)), () => Promise.resolve(undefined))
    assert.equal(alone, 0)
    assert.deepEqual([...blamedOf(one).keys()], ["a"])
})

const gitIn = (cwd: string, ...args: string[]): string => {
    const run = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], cwd)
    assert.equal(run.exitCode, 0, `git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
}

/** A bare origin with dev, the app's main checkout of it, and a lanes folder; `lane` pushes a branch adding `file` and registers it ready. */
const scratch = (t: { after: (fn: () => void) => void }) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-land-prepare-")))
    const before = process.env.STARCI_LOCAL_ROOT
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    t.after(() => {
        if (before === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = before
        rmSync(base, { recursive: true, force: true })
    })
    const origin = join(base, "origin.git")
    gitIn(base, "init", "-q", "--bare", "-b", "dev", origin)
    const repo = join(base, "app")
    gitIn(base, "clone", "-q", origin, repo)
    gitIn(repo, "switch", "-q", "-c", "dev")
    gitIn(repo, "config", "user.name", "t")
    gitIn(repo, "config", "user.email", "t@example.invalid")
    gitIn(repo, "config", "commit.gpgsign", "false")
    writeFileSync(join(repo, "README.md"), "app\n")
    gitIn(repo, "add", ".")
    gitIn(repo, "commit", "-q", "-m", "start")
    gitIn(repo, "push", "-q", "origin", "dev")
    const dir = join(base, "lanes")
    const lane = (name: string, file: string): ReadyEntry => {
        gitIn(repo, "switch", "-q", "-c", `lane/${name}`, "origin/dev")
        writeFileSync(join(repo, file), `${name}\n`)
        gitIn(repo, "add", ".")
        gitIn(repo, "commit", "-q", "-m", name)
        gitIn(repo, "push", "-q", "origin", `lane/${name}`)
        const ready = { lane: name, branch: `lane/${name}`, sha: gitIn(repo, "rev-parse", "HEAD"), at: new Date().toISOString() }
        gitIn(repo, "switch", "-q", "dev")
        writeReady(dir, ready)
        return ready
    }
    return { base, origin, repo, dir, lane }
}

/** An app profile whose gate is green and whose push is a plain git push: the batch's judgement of its prepare step is what the spec drives. */
const PROFILE: LandProfile = {
    name: "app",
    prepares: true,
    gate: () => ({ file: process.execPath, args: ["-e", "console.log(JSON.stringify({ findings: [] }))"] }),
    push: (_wt, ref) => ({ file: "git", args: ["push", "-q", "origin", `HEAD:${ref}`] }),
    gateLabel: "green",
}

const options = (dir: string, repo: string, prepare: NonNullable<BatchOptions["prepare"]>, lines: string[]): BatchOptions => ({
    dir, repo, worktree: join(dir, "_batch-lander"), migrations: "db/migrations/", gateSlots: 1, npmSlots: 1, dryRun: false, say: (line) => lines.push(line), profile: PROFILE, prepare,
})

/** The prepare step: build:modules fails while the tree holds `marker`, else passes; every tree it saw is counted. */
const failsOn = (marker: string, seen: string[]): NonNullable<BatchOptions["prepare"]> => (batch) => {
    const red = existsSync(join(batch.worktree, marker))
    seen.push(red ? "red" : "green")
    return Promise.resolve(red ? { ...BUILD_RED, output: `${marker}: Module not found: Can't resolve '@starci/nivo-icons'` } : undefined)
}

void test("a batch that fails build:modules rejects the lane that breaks it with the build output and lands the rest; the failing batch never forms again", async (t) => {
    const { dir, repo, lane, origin } = scratch(t)
    lane("chat-card-v2", "chat.txt")
    const breaking = lane("agent-hub", "breaks-build")
    const seen: string[] = []
    const lines: string[] = []
    const record = await runBatch(options(dir, repo, failsOn("breaks-build", seen), lines))
    assert.ok(record)
    assert.deepEqual(record.rejected, ["agent-hub"])
    assert.deepEqual(record.landedLanes, ["chat-card-v2"])
    assert.equal(record.failed, undefined)
    // the batch red, chat-card-v2 alone green, agent-hub alone red, then the batch without agent-hub green
    assert.deepEqual(seen, ["red", "green", "red", "green"])
    const status = readStatuses(dir).find((one) => one.lane === "agent-hub")
    assert.equal(status?.state, "rejected")
    assert.equal(status.laneSha, breaking.sha)
    assert.match(status.findings?.[0]?.message ?? "", /npm run build:modules exited 1 with only your lane merged onto dev:\nbreaks-build: Module not found/u)
    assert.equal(readStatuses(dir).find((one) => one.lane === "chat-card-v2")?.state, "landed")
    assert.equal(captureGitSync(["cat-file", "-e", "dev:chat.txt"], origin).exitCode, 0, "dev holds the lane that builds")
    assert.equal(captureGitSync(["cat-file", "-e", "dev:breaks-build"], origin).exitCode !== 0, true, "and never the one that breaks it")
    assert.deepEqual(readyEntries(dir), [])
    assert.equal(await runBatch(options(dir, repo, failsOn("breaks-build", seen), lines)), undefined, "nothing is ready: no batch forms again")
})

void test("a dev that fails build:modules by itself blames no lane: the lanes stay ready and the record says the batch failed", async (t) => {
    const { dir, repo, lane } = scratch(t)
    lane("chat-card-v2", "chat.txt")
    const seen: string[] = []
    const record = await runBatch(options(dir, repo, failsOn("README.md", seen), []))
    assert.ok(record)
    assert.equal(record.failed, true)
    assert.deepEqual(record.rejected, [])
    assert.match(record.outcome, /^dev itself fails npm run build:modules \(exit 1\); no lane is blamed/u)
    assert.deepEqual(seen, ["red", "red"])
    assert.deepEqual(readyEntries(dir).map((one) => one.lane), ["chat-card-v2"])
})

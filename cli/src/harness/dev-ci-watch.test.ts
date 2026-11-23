// The watch of a landed dev sha's GitHub CI: the verdict of its push runs, the loop up to its limit, the verdict in the lanes' status files, and a red
// one said loudly and sent to the coordinator session without ever touching dev. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { devCiFile, devCiVerdict, startDevCiWatch, watchDevCi } from "./dev-ci-watch.js"
import type { CiWatchDeps, DevCiRun } from "./dev-ci-watch.js"
import { landPaths, writeStatus } from "./land-queue.js"
import type { LaneStatus } from "./land-queue.js"

const SHA = "0115d663e9a1b2c3d4e5f60718293a4b5c6d7e8f"
const run = (id: number, status: string, conclusion: string, event = "push", workflowName = "ci"): DevCiRun => ({ databaseId: id, workflowName, event, status, conclusion, url: `https://github.example/runs/${String(id)}` })

void test("the verdict of a sha reads only its push runs: none, pending, red over pending, superseded for a cancelled run, else green", () => {
    assert.equal(devCiVerdict(SHA, []).state, "none")
    assert.equal(devCiVerdict(SHA, [run(1, "completed", "failure", "pull_request")]).state, "none", "a pull request run of the sha is another question")
    assert.equal(devCiVerdict(SHA, [run(1, "in_progress", "")]).state, "pending")
    const red = devCiVerdict(SHA, [run(1, "completed", "failure"), run(2, "queued", "", "push", "stack")])
    assert.equal(red.state, "red", "a red run is red though another still runs")
    assert.match(red.reason, /ci 1: failure/u)
    assert.equal(devCiVerdict(SHA, [run(1, "completed", "cancelled"), run(2, "completed", "success", "push", "publish")]).state, "superseded")
    assert.equal(devCiVerdict(SHA, [run(1, "completed", "success"), run(2, "completed", "skipped", "push", "publish")]).state, "green")
})

const scratch = (t: { after: (fn: () => void) => void }): string => {
    const dir = mkdtempSync(join(tmpdir(), "starci-ci-watch-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    return dir
}

const fake = (answers: readonly (readonly DevCiRun[] | Error)[], notified: string[]): CiWatchDeps => {
    let clock = 0
    let asked = 0
    return {
        listRuns: () => {
            const answer = answers[Math.min(asked, answers.length - 1)] ?? []
            asked += 1
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
        },
        pause: (ms) => {
            clock += ms
            return Promise.resolve()
        },
        now: () => clock,
        notify: (session, message) => {
            notified.push(`${session}: ${message}`)
            return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
        },
    }
}

const status = (dir: string, lane: string): LaneStatus => JSON.parse(readFileSync(join(landPaths(dir).status, `${lane}.json`), "utf8")) as LaneStatus

void test("a red dev is written into the landed lanes' status and the sha's file, said loudly and sent to the coordinator session; a lane landed since keeps its own", async (t) => {
    const dir = scratch(t)
    writeStatus(dir, { lane: "fix", state: "landed", sha: SHA, laneSha: "a".repeat(40), branch: "lane/fix" })
    writeStatus(dir, { lane: "moved", state: "queued", sha: "b".repeat(40), laneSha: "b".repeat(40), branch: "lane/moved" })
    const notified: string[] = []
    const said: string[] = []
    const verdict = await watchDevCi({ root: dir, dir, sha: SHA, lanes: ["fix", "moved"], limitMs: 600_000, pollMs: 30_000, notifySession: "coordinator", say: (line) => said.push(line) }, fake([[], [run(7, "in_progress", "")], [run(7, "completed", "failure")]], notified))
    assert.equal(verdict.state, "red")
    assert.equal(status(dir, "fix").ci?.state, "red")
    assert.equal(status(dir, "fix").state, "landed", "the landing stands: nothing is reverted")
    assert.equal(status(dir, "moved").ci, undefined, "a lane whose status no longer says it landed as this sha is left alone")
    assert.equal((JSON.parse(readFileSync(devCiFile(dir, SHA), "utf8")) as { state: string; lanes: string[] }).lanes.join(), "fix,moved")
    assert.ok(said.some((line) => line.includes("DEV CI IS RED")), "said loudly")
    assert.equal(notified.length, 1)
    assert.match(notified[0] ?? "", /^coordinator: .*RED at 0115d663e/u)
})

void test("without a notify session a red verdict is only logged; a run that outlasts the limit is pending and an unreadable gh says why, and neither notifies", async (t) => {
    const dir = scratch(t)
    const notified: string[] = []
    const said: string[] = []
    const red = await watchDevCi({ root: dir, dir, sha: SHA, lanes: [], limitMs: 60_000, say: (line) => said.push(line) }, fake([[run(1, "completed", "failure")]], notified))
    assert.equal(red.state, "red")
    assert.ok(said.some((line) => line.includes("no lander.notifySession")))
    const pending = await watchDevCi({ root: dir, dir, sha: SHA, lanes: [], limitMs: 90_000, pollMs: 30_000, notifySession: "coordinator", say: () => undefined }, fake([[run(1, "in_progress", "")]], notified))
    assert.equal(pending.state, "pending")
    assert.match(pending.reason, /still running after 2 min/u)
    const unreadable = await watchDevCi({ root: dir, dir, sha: SHA, lanes: [], limitMs: 30_000, pollMs: 30_000, notifySession: "coordinator", say: () => undefined }, fake([new Error("gh: not logged in")], notified))
    assert.equal(unreadable.state, "unreadable")
    assert.match(unreadable.reason, /not logged in/u)
    assert.deepEqual(notified, [])
})

void test("a landing starts the watch detached with the sha and its lanes, and a watcher that cannot start is said, never thrown", async (t) => {
    const dir = scratch(t)
    const started: string[][] = []
    const said: string[] = []
    await startDevCiWatch(dir, dir, SHA, ["a", "b"], (line) => said.push(line), (argv) => {
        started.push([...argv])
        return Promise.resolve(4242)
    })
    assert.deepEqual(started[0]?.slice(2), ["lane", "ci-watch", SHA, "--dir", dir, "--lanes", "a,b"])
    assert.match(said[0] ?? "", /watched in the background \(pid 4242/u)
    await startDevCiWatch(dir, dir, SHA, ["a"], (line) => said.push(line), () => Promise.reject(new Error("relay down")))
    assert.match(said[1] ?? "", /did not start \(relay down\)/u)
})

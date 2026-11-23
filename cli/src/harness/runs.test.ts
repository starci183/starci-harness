// The orphan reaper on recorded runs only: a run whose own process is gone is finished; a run whose launcher lives is live; a run whose launcher
// is gone (or whose launcher pid now runs another process) is an orphan, stamped the first time it is seen and stopped, tree and recorded children,
// once the stamp is graceMinutes old; a dry run changes nothing; the reaper and its ancestors are never stopped; nothing unrecorded is touched.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { judgeRun, launchersOf, readRuns, reapRuns, type ProcessId, type ReapProbe, type RunRecord } from "./runs.js"

const MIN = 60_000
const NOW = Date.parse("2026-11-23T10:00:00Z")

const record = (pid: number, launchers: readonly ProcessId[], extra: Partial<RunRecord> = {}): RunRecord => ({ pid, startMs: 1000, label: `run ${String(pid)}`, cwd: "D:/lanes/x", at: "2026-11-23T09:00:00Z", launchers, children: [], ...extra })

/** A probe over a fixed table of live processes (pid -> start), the reaper's own lineage spared. */
const probe = (live: Readonly<Record<number, number>>, spared: readonly number[] = []): ReapProbe => ({
    nowMs: NOW,
    same: (id) => live[id.pid] !== undefined && (id.startMs === null || live[id.pid] === id.startMs),
    spared: new Set(spared),
})

void test("the launchers are the parent and its parent, each with its start", () => {
    const table = new Map([
        [10, { pid: 10, ppid: 9, startedMs: 3 }],
        [9, { pid: 9, ppid: 8, startedMs: 2 }],
        [8, { pid: 8, ppid: 1, startedMs: 1 }],
    ])
    assert.deepEqual(launchersOf(table, 10), [{ pid: 9, startMs: 2 }, { pid: 8, startMs: 1 }])
    assert.deepEqual(launchersOf(table, 8), [], "a launcher under the system's own pids is none")
})

void test("finished, live and orphan runs are told apart on evidence", () => {
    const launcher = { pid: 20, startMs: 500 }
    const shell = { pid: 21, startMs: 400 }
    assert.equal(judgeRun(record(10, [launcher, shell]), probe({ 20: 500, 21: 400 }), 10).state, "finished", "its own pid is gone")
    assert.equal(judgeRun(record(10, [launcher, shell]), probe({ 10: 1000, 20: 500, 21: 400 }), 10).state, "live")
    const orphan = judgeRun(record(10, [launcher, shell]), probe({ 10: 1000, 21: 400 }), 10)
    assert.equal(orphan.state, "orphan")
    assert.equal(orphan.due, false, "first seen now: inside its grace")
    assert.match(orphan.evidence, /launcher pid 20 is gone/u)
    const reused = judgeRun(record(10, [launcher, shell]), probe({ 10: 1000, 20: 999, 21: 400 }), 10)
    assert.equal(reused.state, "orphan", "a launcher pid that runs another process is gone")
    const upper = judgeRun(record(10, [launcher, shell]), probe({ 10: 1000, 20: 500 }), 10)
    assert.equal(upper.state, "orphan", "the shell's own launcher gone (the agent died, its shell lingers) is an orphan too")
    const stamped = judgeRun(record(10, [launcher], { launcherGoneAt: new Date(NOW - 11 * MIN).toISOString() }), probe({ 10: 1000 }), 10)
    assert.equal(stamped.due, true, "past its grace")
    const spared = judgeRun(record(10, [launcher], { launcherGoneAt: new Date(NOW - 11 * MIN).toISOString() }), probe({ 10: 1000 }, [10]), 10)
    assert.equal(spared.due, false, "the reaper's own lineage is never stopped")
})

void test("a reap drops finished records, stamps a new orphan, and stops an orphan past its grace with its children, logging it", (t) => {
    const root = mkdtempSync(join(tmpdir(), "starci-runs-"))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    mkdirSync(join(root, "_runs"))
    const write = (one: RunRecord): void => {
        writeFileSync(join(root, "_runs", `${String(one.pid)}.json`), JSON.stringify(one))
    }
    write(record(11, [{ pid: 20, startMs: 500 }]))
    write(record(12, [{ pid: 21, startMs: 500 }]))
    write(record(13, [{ pid: 22, startMs: 500 }], { launcherGoneAt: new Date(NOW - 30 * MIN).toISOString(), children: [{ pid: 14, startMs: null }] }))
    write(record(15, [{ pid: 23, startMs: 500 }]))
    const live = probe({ 12: 1000, 13: 1000, 15: 1000, 23: 500 })
    const stopped: number[] = []
    const dry = reapRuns(root, live, 10, false, (pid) => stopped.push(pid) > 0)
    assert.equal(stopped.length, 0, "a dry run stops nothing")
    assert.equal(readdirSync(join(root, "_runs")).length, 4, "and changes no record")
    assert.equal(dry.verdicts.find((verdict) => verdict.record.pid === 13)?.due, true)
    const report = reapRuns(root, live, 10, true, (pid) => stopped.push(pid) > 0)
    assert.deepEqual(stopped, [13], "only the orphan past its grace; its recorded child 14 is not alive, so it is not stopped")
    assert.deepEqual(report.stopped.map((one) => one.pid), [13])
    const left: number[] = readRuns(root).map((one) => one.pid).sort((first, second) => first - second)
    assert.deepEqual(left, [12, 15], "the finished run 11 and the stopped 13 are gone; 12 is stamped, 15 is live")
    assert.ok(readRuns(root).find((one) => one.pid === 12)?.launcherGoneAt !== undefined, "the new orphan is stamped")
    assert.match(readFileSync(join(root, "_reap.log"), "utf8"), /stopped run pid 13 "run 13"/u)
})

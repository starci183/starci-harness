// Lock liveness: the dev-push lock holds `pid=N`; a lock whose pid is not alive on this machine is stale and taken
// over at once with one line naming the dead pid, while a live pid keeps it held. Real files in a temp lanes folder.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { landPaths, takeDevLock } from "./lane-state.js"
import { takeLiveLock } from "./slots.js"

const lanes = (t: { after: (fn: () => void) => void }): string => {
    const dir = mkdtempSync(join(tmpdir(), "lock-liveness-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    return dir
}

/** A pid that ran on this machine and has exited. */
const deadPid = (): number => {
    const run = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" })
    return Number(run.stdout)
}

void test("a lock whose pid is not alive is taken over with one line naming the pid; a live pid keeps it", (t) => {
    const file = join(lanes(t), "_dev-push-harness.lock")
    writeFileSync(file, "dev-lock 2026-11-22T01:00:00.000Z pid=4242")
    const lines: string[] = []
    assert.equal(takeLiveLock(file, "dev-lock now pid=1", (line) => lines.push(line), () => true), false)
    assert.equal(lines.length, 0)
    assert.match(readFileSync(file, "utf8"), /pid=4242/)
    assert.equal(takeLiveLock(file, "dev-lock now pid=1", (line) => lines.push(line), () => false), true)
    assert.equal(lines.length, 1)
    assert.match(lines[0] ?? "", /pid 4242 is not alive/)
    assert.equal(readFileSync(file, "utf8"), "dev-lock now pid=1")
})

void test("a lock with no pid, or written on another host, is never taken over", (t) => {
    const dir = lanes(t)
    const bare = join(dir, "_dev-push.lock")
    writeFileSync(bare, "dev-lock 2026-11-22T01:00:00.000Z")
    assert.equal(takeLiveLock(bare, "x", () => undefined, () => false), false)
    const elsewhere = join(dir, "_dev-push-other.lock")
    writeFileSync(elsewhere, "dev-lock 2026-11-22T01:00:00.000Z pid=4242 host=another-machine-0")
    assert.equal(takeLiveLock(elsewhere, "x", () => undefined, () => false), false)
})

void test("a landing waits for nothing when the dev lock it finds belongs to a killed landing", async (t) => {
    const dir = lanes(t)
    const lock = landPaths(dir, "harness").devLock
    const pid = deadPid()
    writeFileSync(lock, `dev-lock 2026-11-22T01:00:00.000Z pid=${String(pid)}`)
    const lines: string[] = []
    await takeDevLock(dir, (line) => lines.push(line), "harness", 10)
    assert.equal(lines.filter((line) => line.startsWith("waiting for")).length, 0)
    assert.ok(lines.some((line) => line.includes(`pid ${String(pid)}`)), lines.join("\n"))
    assert.match(readFileSync(lock, "utf8"), new RegExp(`pid=${String(process.pid)}`))
})

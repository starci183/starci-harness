// The heavy-command governor is a count: one slot per heavy.gbPerSlot GB of the host's RAM, at least one; each heavy command holds one slot while it
// runs; a command past the cap waits first come, first served and starts when one frees; the disk floor holds every start, a lone one too; a dead
// holder is dropped; a command a held command starts is admitted on its own, its ancestors left out; a CI runner never queues; a test run takes no
// more workers than its caller can use; the heap caps are passed as process limits; an out-of-memory run names the cause; the wait line says why.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { governorStorePath } from "./ledger.js"
import { HEAVY_PARENTS_ENV, HOST_HELD, admission, governed, heavyRoomMb, heavySlots, loadHeavyRules, oomNote, slotCap, testRunSizing, testWorkerArgs, waitLine, withHeavyBound, type Governed, type Held, type HeavyKind, type HeavyRules } from "./heavy.js"
import { withMachine } from "./machine.js"

const state = mkdtempSync(join(tmpdir(), "starci-governor-"))
process.env.STARCI_LOCAL_ROOT = state
Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
delete process.env.CI

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), pollSeconds: 0.05, testWorkers: "50%" }
const GB = 1024
/** A host of 32 GB: two slots at 16 GB a slot. */
const host: Governed = { rules: { ...rules, gbPerSlot: 16 }, freeMb: () => 20 * GB, totalMb: 32 * GB }

test.after(() => {
    rmSync(state, { recursive: true, force: true })
})

/** A promise opened from outside, to hold a running command where it is. */
const gate = (): { readonly wait: Promise<void>; readonly open: () => void } => {
    let open = (): void => undefined
    const wait = new Promise<void>((resolve) => {
        open = resolve
    })
    return { wait, open }
}

const must = <T>(value: T | null | undefined): T => {
    assert.ok(value !== null && value !== undefined)
    return value
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The text written to stderr while `work` runs. */
const stderrOf = async (work: () => Promise<void>): Promise<string> => {
    const write = process.stderr.write.bind(process.stderr)
    let text = ""
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
        text += String(chunk)
        return true
    }
    try {
        await work()
    } finally {
        process.stderr.write = write
    }
    return text
}

/** Runs `kind` on `on`; `order` records its start, `hold` keeps it running. */
const run = (on: Governed, kind: HeavyKind, name: string, order: string[], hold?: Promise<void>, seen?: (held: Held) => void): Promise<void> =>
    governed(on, kind, name, state, {}, async (held) => {
        order.push(name)
        seen?.(held)
        await hold
    })

void test("the cap is one slot per gbPerSlot GB of RAM, at least one", () => {
    assert.equal(slotCap({ ...rules, gbPerSlot: 16 }, 64 * GB), 4)
    assert.equal(slotCap({ ...rules, gbPerSlot: 16 }, 63 * GB), 3)
    assert.equal(slotCap({ ...rules, gbPerSlot: 16 }, 8 * GB), 1)
    assert.equal(admission({ ...rules, gbPerSlot: 16 }, 3, [], 0, 64 * GB).admits, true)
    assert.equal(admission({ ...rules, gbPerSlot: 16 }, 4, [], 0, 64 * GB).admits, false)
    assert.match(admission({ ...rules, gbPerSlot: 16 }, 4, [], 0, 64 * GB).reason, /4 heavy command\(s\) run, at the cap of 4/u)
    const floored = admission({ ...rules, gbPerSlot: 16 }, 0, ["free disk 4 GB on the drive of D: is under heavy.diskFloorMb 15 GB"], 0, 64 * GB)
    assert.equal(floored.admits, false, "a floor holds a lone command too")
    assert.match(floored.reason, /under heavy\.diskFloorMb/u)
})

void test("a free slot starts a command at once, under its heap cap", async () => {
    const order: string[] = []
    const seen: Held[] = []
    const text = await stderrOf(() => run(host, "tsc", "tsc-a", order, undefined, (held) => seen.push(held)))
    assert.deepEqual(order, ["tsc-a"])
    assert.equal(text, "", "nothing waited, nothing was printed")
    assert.equal(must(seen[0]).heapMb, rules.caps.tsc.capMb)
    assert.match(must(seen[0]).options.env?.NODE_OPTIONS ?? "", new RegExp(`--max-old-space-size=${String(rules.caps.tsc.capMb)}`, "u"))
})

void test("a test run takes its fixed workers, with the heap caps and the idle limit passed", async () => {
    const seen: Held[] = []
    await run(host, "test", "jest-wide", [], undefined, (held) => seen.push(held))
    const held = must(seen[0])
    const expected = testRunSizing(rules).workers
    assert.equal(held.test?.workers, expected)
    assert.deepEqual(testWorkerArgs(["node", "jest", "--coverage"], held), ["node", "jest", "--coverage", `--maxWorkers=${String(expected)}`, `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.match(held.options.env?.NODE_OPTIONS ?? "", new RegExp(`--max-old-space-size=${String(rules.testRun.parentMb)} --require=.*starci-jest-worker-heap`, "u"), "the parent's heap is its cap")
    assert.equal(held.options.env?.STARCI_WORKER_HEAP_MB, String(rules.testRun.workerMb), "the workers' heap cap")
})

void test("past the cap a command waits first come, first served, and starts when a slot frees", async () => {
    const order: string[] = []
    const holder = gate()
    const text = await stderrOf(async () => {
        const first = run(host, "tsc", "A", order, holder.wait)
        const second = run(host, "build", "B", order, holder.wait)
        await pause(300)
        const third = run(host, "eslint", "C", order)
        await pause(300)
        const fourth = run(host, "install", "D", order)
        await pause(400)
        assert.deepEqual(order, ["A", "B"], "two slots on a 32 GB host: C and D wait")
        holder.open()
        await Promise.all([first, second, third, fourth])
    })
    assert.deepEqual(order, ["A", "B", "C", "D"], "served in the order they came")
    assert.match(text, /C waits for a heavy-command slot \(2 on this host\): first in the queue; 2 heavy command\(s\) run, at the cap of 2/u)
    assert.match(text, /D waits for a heavy-command slot \(2 on this host\): 1 ahead of it/u)
    assert.equal(heavySlots().length, 0, "every row is released")
})

void test("a command that ended frees its slot at once, though the next shares its process", async () => {
    await run(host, "tsc", "finished-step", [])
    assert.deepEqual(withMachine((db) => db.prepare("SELECT id FROM heavy_slots").all(), governorStorePath()), [], "the row went with the command, not with its process")
})

void test("the disk floor holds a start: a verify's bound ends the wait as HOST_HELD, no verdict", async () => {
    const floored: Governed = { ...host, floors: () => ["free disk 4 GB on the drive of D: is under heavy.diskFloorMb 15 GB (ops/liveness.yaml)"] }
    const order: string[] = []
    const text = await stderrOf(async () => {
        await assert.rejects(withHeavyBound(300, undefined, () => run(floored, "install", "npm-ci", order)), (error: { code?: string }) => error.code === HOST_HELD)
    })
    assert.deepEqual(order, [])
    assert.match(text, /npm-ci waits for a heavy-command slot .*under heavy\.diskFloorMb/u)
    assert.equal(heavySlots().length, 0)
})

void test("a row of a process that is gone is dropped at admission, so nothing waits for a dead holder", async () => {
    heavySlots()
    const dead = spawnSync(process.execPath, ["-e", ""]).pid
    const one: Governed = { ...host, totalMb: 16 * GB }
    withMachine((db) => db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at) VALUES ('ghost', ?, 'tsc', 'ghost', ?, 'running', ?)").run(dead, state, new Date().toISOString()), governorStorePath())
    const order: string[] = []
    const text = await stderrOf(() => run(one, "tsc", "after-ghost", order))
    assert.deepEqual(order, ["after-ghost"])
    assert.equal(text, "")
    assert.equal(heavySlots().length, 0)
})

void test("a heavy command a held command starts is admitted on its own, and its ancestors never count against it", async () => {
    const one: Governed = { ...host, totalMb: 16 * GB }
    const order: string[] = []
    const holder = gate()
    const parents: Held[] = []
    const parent = run(one, "tsc", "parent", order, holder.wait, (held) => parents.push(held))
    await pause(300)
    const inherited = must(must(parents[0]).options.env?.[HEAVY_PARENTS_ENV])
    process.env[HEAVY_PARENTS_ENV] = inherited
    try {
        const seen: Held[] = []
        await run(one, "test", "child", order, undefined, (held) => {
            seen.push(held)
            assert.equal(heavySlots().length, 2, "the child holds a row of its own")
        })
        assert.deepEqual(order, ["parent", "child"], "the child started on a one-slot host while the parent runs: the parent's row does not count")
        assert.equal(heavyRoomMb(one), rules.caps.eslint.capMb, "the room this process reads leaves its ancestors out: one free slot")
        assert.match(must(seen[0]).options.env?.[HEAVY_PARENTS_ENV] ?? "", new RegExp(`^${inherited},[0-9]+-[0-9a-f]+$`, "u"), "its own children inherit both ids")
    } finally {
        Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
        holder.open()
        await parent
    }
    assert.equal(heavySlots().length, 0)
})

void test("a test run never plans more workers than its caller can use", async () => {
    assert.equal(testRunSizing(rules, 28, 3).workers, 3)
    assert.equal(testRunSizing(rules, 2, 0).workers, 1, "one worker is the floor")
    const seen: Held[] = []
    await governed(host, "test", "capped", state, { workers: 2 }, (held) => {
        seen.push(held)
        return Promise.resolve()
    })
    assert.equal(must(seen[0]).test?.workers, 2)
})

void test("a CI runner keeps no queue: its command runs at once and takes no row", async () => {
    const one: Governed = { ...host, totalMb: 16 * GB }
    const order: string[] = []
    const holder = gate()
    const parent = run(one, "tsc", "busy", order, holder.wait)
    await pause(300)
    process.env.CI = "true"
    try {
        const seen: Held[] = []
        await run(one, "tsc", "ci-job", order, undefined, (held) => seen.push(held))
        assert.deepEqual(order, ["busy", "ci-job"])
        assert.equal(must(seen[0]).heapMb, rules.caps.tsc.capMb)
        assert.equal(heavySlots().length, 1, "no row was taken")
    } finally {
        delete process.env.CI
        holder.open()
        await parent
    }
})

void test("a command that runs out of memory names the heap cap it hit and the RAM free at its admission", () => {
    const held = { heapMb: 8192, freeMb: 20_000, test: undefined }
    assert.match(oomNote("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", held), /heap cap 8192 MB reached; free RAM was 20000 MB at admission/u)
    assert.equal(oomNote("Tests: 3 failed", held), "")
    assert.match(oomNote("ERR_WORKER_OUT_OF_MEMORY", { ...held, test: testRunSizing(rules, 28) }), /workers 1536 MB each/u)
})

void test("a waiting command prints its place, why it waits and who runs", () => {
    const line = waitLine("tsc -p be", 2, { cap: 4, reason: "4 heavy command(s) run, at the cap of 4" }, ["jest (pid 7, since 2026-11-23T01:00:00Z)"])
    assert.match(line, /tsc -p be waits for a heavy-command slot \(4 on this host\): 2 ahead of it; 4 heavy command\(s\) run, at the cap of 4; running: jest \(pid 7/u)
})

// The heavy-command governor, greedy on live RAM: a command sizes itself to the room it finds (free RAM less the reserve and the plan of the commands
// admitted in the last minute); RAM free starts it at once; RAM short waits first come, first served and starts on release; nothing running starts anyway;
// two that start together never take the same room; a dead holder is dropped; a command a held command starts is admitted on its own, its ancestors left
// out of its room; a CI runner never queues; a test run plans no more workers than its caller can use; the heap caps are passed; a command that runs out of memory names the cause; the wait line names the place, the need and who runs.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { governorStorePath } from "./ledger.js"
import { HEAVY_PARENTS_ENV, governed, heavyRoomMb, heavySlots, loadHeavyRules, oomNote, testRunSizing, testWorkerArgs, testWorkerCap, waitLine, type Held, type HeavyKind, type HeavyRules } from "./heavy.js"
import { withMachine } from "./machine.js"

const state = mkdtempSync(join(tmpdir(), "starci-governor-"))
process.env.STARCI_LOCAL_ROOT = state
Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
delete process.env.CI

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), pollSeconds: 0.05, maxCpuPercent: 100, cpuStarveMinutes: 100_000, testWorkers: "50%" }
const GB = 1024
// Concurrent commands need two slots (floor(cores / 2)); a smaller host judges the single-command cases only.
const wide = availableParallelism() >= 4

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

/** The value, asserted present. */
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

/** Runs `kind` on a host with `freeMb` free; `order` records its start, `hold` keeps it running. */
const run = (freeMb: number, kind: HeavyKind, name: string, order: string[], hold?: Promise<void>, seen?: (held: Held) => void): Promise<void> =>
    governed({ rules, freeMb: () => freeMb }, kind, name, state, {}, async (held) => {
        order.push(name)
        seen?.(held)
        await hold
    })

/** Ages every running row's admission by `ms`, as if that long had passed. */
const age = (ms: number): void => {
    withMachine((db) => db.prepare("UPDATE heavy_slots SET admitted_ms = admitted_ms - ? WHERE state = 'running'").run(ms), governorStorePath())
}

void test("RAM free starts a command at once, greedily: a tsc under its cap", async () => {
    const order: string[] = []
    const seen: Held[] = []
    const text = await stderrOf(() => run(30 * GB, "tsc", "tsc-a", order, undefined, (held) => seen.push(held)))
    assert.deepEqual(order, ["tsc-a"])
    assert.equal(text, "", "nothing waited, nothing was printed")
    assert.equal(must(seen[0]).roomMb, 30 * GB - rules.reserveMb)
    assert.equal(must(seen[0]).heapMb, rules.caps.tsc.capMb)
    assert.match(must(seen[0]).options.env?.NODE_OPTIONS ?? "", new RegExp(`--max-old-space-size=${String(rules.caps.tsc.capMb)}`, "u"))
})

void test("a test run on 22 GB free takes the workers its caps divide the room into, with the heap caps and the idle limit passed", async () => {
    const seen: Held[] = []
    await run(22 * GB, "test", "jest-wide", [], undefined, (held) => seen.push(held))
    const held = must(seen[0])
    const expected = Math.min(7, testWorkerCap(rules))
    assert.equal(held.test?.workers, expected)
    assert.deepEqual(testWorkerArgs(["node", "jest", "--coverage"], held), ["node", "jest", "--coverage", `--maxWorkers=${String(expected)}`, `--workerIdleMemoryLimit=${String(rules.testRun.workerMb)}MB`])
    assert.match(held.options.env?.NODE_OPTIONS ?? "", new RegExp(`--max-old-space-size=${String(rules.testRun.parentMb)} --require=.*starci-jest-worker-heap`, "u"), "the parent's heap is its cap")
    assert.equal(held.options.env?.STARCI_WORKER_HEAP_MB, String(rules.testRun.workerMb), "the workers' heap cap")
})

void test("nothing running starts a command anyway: a test run on 7 GB free takes one worker, and the shortfall is named", async () => {
    const seen: Held[] = []
    const text = await stderrOf(() => run(7 * GB, "test", "jest-low", [], undefined, (held) => seen.push(held)))
    assert.equal(must(seen[0]).test?.workers, 1)
    assert.match(text, /jest-low is admitted alone with \d+ MB of room/u)
    const tiny: Held[] = []
    await stderrOf(() => run(1000, "tsc", "tsc-low", [], undefined, (held) => tiny.push(held)))
    assert.equal(must(tiny[0]).heapMb, rules.caps.tsc.minMb, "on almost no room a tsc runs under its minimum")
})

void test("a second task 5 s after the first sees the room less the first's plan, and after a minute the live free RAM", { skip: !wide }, async () => {
    const order: string[] = []
    const holder = gate()
    const free = 12 * GB
    assert.equal(free - rules.reserveMb, rules.caps.tsc.capMb, "the first tsc plans the whole room")
    const second: Held[] = []
    const both = stderrOf(async () => {
        const first = run(free, "tsc", "first", order, holder.wait)
        await pause(300)
        const next = run(free, "tsc", "second", order, undefined, (held) => second.push(held))
        await pause(800)
        assert.deepEqual(order, ["first"], "the room less the first's plan is under a tsc's minimum, so the second waits")
        age(61_000)
        await next
        assert.deepEqual(order, ["first", "second"], "a minute later the first counts as the free RAM shows it, and the second starts")
        assert.equal(must(second[0]).roomMb, free - rules.reserveMb)
        holder.open()
        await first
    })
    const text = await both
    assert.match(text, /second waits for a heavy-command slot: first in the queue, needs 8192 MB, room 0 MB/u)
    assert.match(text, /first \(pid \d+\) planned 8192 MB, admitted \d+ s ago/u)
})

void test("first come, first served: a command that fits waits behind one that does not, and both start when the holder releases", { skip: !wide }, async () => {
    const order: string[] = []
    const holder = gate()
    const free = 18 * GB
    const text = await stderrOf(async () => {
        const first = run(free, "tsc", "A", order, holder.wait)
        await pause(300)
        const second = run(free, "tsc", "B", order)
        await pause(300)
        const third = run(free, "build", "C", order)
        await pause(600)
        assert.deepEqual(order, ["A"], "B waits for RAM and C, which would fit, waits behind B")
        holder.open()
        await Promise.all([first, second, third])
    })
    assert.deepEqual(order, ["A", "B", "C"], "served in the order they came")
    assert.match(text, /C waits for a heavy-command slot: 1 ahead of it, needs 4096 MB/u)
    assert.equal(heavySlots().length, 0, "every row is released")
})

void test("two commands that start together never take the same room", { skip: !wide }, async () => {
    const order: string[] = []
    const holder = gate()
    const free = 14 * GB
    await stderrOf(async () => {
        const pair = Promise.all([run(free, "tsc", "X", order, holder.wait), run(free, "tsc", "Y", order, holder.wait)])
        await pause(800)
        assert.equal(order.length, 1, "the first one's plan is in the room the second finds, so the second waits")
        holder.open()
        await pair
    })
    assert.equal(order.length, 2)
})

void test("a row of a process that is gone is dropped at admission, so nothing waits for a dead holder", async () => {
    heavySlots()
    const dead = spawnSync(process.execPath, ["-e", ""]).pid
    withMachine((db) => db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at, mb, admitted_ms) VALUES ('ghost', ?, 'tsc', 'ghost', ?, 'running', ?, ?, ?)").run(dead, state, new Date().toISOString(), 30 * GB, Date.now()), governorStorePath())
    const order: string[] = []
    const text = await stderrOf(() => run(12 * GB, "tsc", "after-ghost", order))
    assert.deepEqual(order, ["after-ghost"])
    assert.equal(text, "")
    assert.equal(heavySlots().length, 0)
})

void test("a heavy command a held command starts is admitted on its own, and its ancestors never count against it", { skip: !wide }, async () => {
    const order: string[] = []
    const holder = gate()
    const free = 9 * GB
    const parents: Held[] = []
    const parent = run(free, "tsc", "parent", order, holder.wait, (held) => parents.push(held))
    await pause(300)
    const inherited = must(must(parents[0]).options.env?.[HEAVY_PARENTS_ENV])
    process.env[HEAVY_PARENTS_ENV] = inherited
    try {
        const seen: Held[] = []
        await run(free, "test", "child", order, undefined, (held) => {
            seen.push(held)
            assert.equal(heavySlots().length, 2, "the child holds a row of its own")
        })
        assert.deepEqual(order, ["parent", "child"], "the child started while the parent runs: the parent's row and plan are not in its room")
        assert.equal(must(seen[0]).roomMb, free - rules.reserveMb)
        assert.equal(heavyRoomMb({ rules, freeMb: () => free }), free - rules.reserveMb, "the room this process reads leaves its ancestors out")
        assert.match(must(seen[0]).options.env?.[HEAVY_PARENTS_ENV] ?? "", new RegExp(`^${inherited},[0-9]+-[0-9a-f]+$`, "u"), "its own children inherit both ids")
    } finally {
        Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
        holder.open()
        await parent
    }
    assert.equal(heavySlots().length, 0)
})

void test("a test run never plans more workers than its caller can use, and the room reading counts the recent plans", async () => {
    assert.equal(testRunSizing(rules, 60 * GB, 28, 3).workers, 3)
    assert.equal(testRunSizing(rules, 0, 28, 3).workers, 1, "one worker is the floor")
    const seen: Held[] = []
    await governed({ rules, freeMb: () => 60 * GB }, "test", "capped", state, { workers: 2 }, (held) => {
        seen.push(held)
        assert.equal(heavyRoomMb({ rules, freeMb: () => 60 * GB }), 60 * GB - rules.reserveMb - must(held.test).holdMb, "a command admitted just now counts with its plan")
        return Promise.resolve()
    })
    assert.equal(must(seen[0]).test?.workers, 2)
})

void test("a CI runner keeps no queue and no lock: its command is sized from the runner's own free RAM", { skip: !wide }, async () => {
    const order: string[] = []
    const holder = gate()
    const parent = run(12 * GB, "tsc", "busy", order, holder.wait)
    await pause(300)
    process.env.CI = "true"
    try {
        const seen: Held[] = []
        await run(12 * GB, "tsc", "ci-job", order, undefined, (held) => seen.push(held))
        assert.deepEqual(order, ["busy", "ci-job"])
        assert.equal(must(seen[0]).roomMb, null)
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
    assert.match(oomNote("ERR_WORKER_OUT_OF_MEMORY", { ...held, test: testRunSizing(rules, 18 * GB, 28) }), /workers 1536 MB each/u)
})

void test("a waiting command prints its place, the MB it needs against the room, and who runs", () => {
    const line = waitLine("tsc -p be", 2, 4096, { freeMb: 12_000, reserveMb: 4096, committedMb: 6000, roomMb: 1904, reason: "r" }, ["jest (pid 7) planned 9000 MB, admitted 12 s ago"])
    assert.match(line, /2 ahead of it, needs 4096 MB, room 1904 MB \(free 12000 MB - reserve 4096 MB - 6000 MB planned by recent admissions\)/u)
    assert.match(line, /jest \(pid 7\) planned 9000 MB, admitted 12 s ago/u)
})

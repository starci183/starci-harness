// The heavy-command governor is a sum: one slot unit per heavy.gbPerSlot GB of the host's RAM, at least one; each heavy command holds its weight (its
// kind's planned MB in units, 1 to 3) while it runs; a command starts when it heads the first come, first served queue and its weight fits, so a heavy
// one is never starved by light ones behind it; the disk floor holds every start, a lone one too; a dead holder is dropped; a command a held command
// starts is admitted on its own, its ancestors left out; a CI runner never queues; a test run takes no more workers than its caller can use; the heap
// caps are passed as process limits; an out-of-memory run names the cause; the wait line says why.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { governorStorePath } from "./ledger.js"
import { readHostSettings } from "./host-settings.js"
import { HEAVY_PARENTS_ENV, HOST_HELD, MAX_WEIGHT, admission, currentHeavyRules, diskFloorOf, governed, heavyRoomMb, heavySlots, heavyWeight, kindWeights, loadHeavyRules, oomNote, slotCap, testRunSizing, testWorkerArgs, waitLine, withHeavyBound, type Governed, type Held, type HeavyKind, type HeavyRules } from "./heavy.js"
import { withMachine } from "./machine.js"

const state = mkdtempSync(join(tmpdir(), "starci-governor-"))
process.env.STARCI_LOCAL_ROOT = state
Reflect.deleteProperty(process.env, HEAVY_PARENTS_ENV)
delete process.env.CI

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ops")
const rules: HeavyRules = { ...loadHeavyRules(opsDir), pollSeconds: 0.05, testWorkers: "50%" }
const GB = 1024
/** A host of 16 GB: four units at 4 GB a unit. */
const host: Governed = { rules: { ...rules, gbPerSlot: 4 }, freeMb: () => 20 * GB, totalMb: 16 * GB }
/** A host of 8 GB: two units. */
const small: Governed = { ...host, totalMb: 8 * GB }

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

void test("the units are one per gbPerSlot GB of RAM, at least one", () => {
    assert.equal(rules.gbPerSlot, 4, "ops/liveness.yaml: 4 GB a unit")
    assert.equal(slotCap(rules, 64 * GB), 16)
    assert.equal(slotCap(rules, 65_380), 16, "64 GB installed, reported as 63.8 GB, is 16 units")
    assert.equal(slotCap(rules, 62 * GB), 15)
    assert.equal(slotCap(rules, 2 * GB), 1)
})

void test("a command's weight is its kind's planned MB in units, rounded up, from 1 to 3, read from the caps alone", () => {
    assert.deepEqual(
        Object.fromEntries(kindWeights(rules, 28).map((one) => [one.kind, one.weight])),
        { tsc: 2, eslint: 2, test: 3, build: 1, appBuild: 3, install: 1, uat: 1 },
        "npm ci, codegen and package builds 1; tsc and an ESLint chunk 2; an app build and a full test run 3",
    )
    assert.equal(heavyWeight(rules, "test", 28, 1), 1, "a test run sized to one worker (the jest discovery) plans the parent and one worker")
    assert.equal(heavyWeight(rules, "test", 2), 1, "a two-core runner plans one worker")
    assert.equal(heavyWeight(rules, "codegen-of-another-copy", 28), 1, "a kind this CLI does not know weighs 1")
    assert.equal(heavyWeight({ ...rules, caps: { ...rules.caps, tsc: { capMb: 4096 } } }, "tsc"), 1, "a measured cap that drops moves the weight with it")
    assert.equal(heavyWeight({ ...rules, caps: { ...rules.caps, tsc: { capMb: 40_000 } } }, "tsc"), MAX_WEIGHT, "never above 3")
})

void test("admission is used + weight <= the units; a floor holds even a lone command; a weight above the units counts as all of them", () => {
    assert.equal(admission(rules, { used: 13, weight: 3, totalMb: 64 * GB }).admits, true)
    const full = admission(rules, { used: 14, running: 6, weight: 3, what: "next build", totalMb: 64 * GB })
    assert.equal(full.admits, false)
    assert.equal(full.reason, "14 of 16 slot units in use; next build needs 3")
    assert.equal(full.running, 6)
    assert.equal(full.free, 2)
    assert.equal(admission(rules, { used: 7, totalMb: 64 * GB }).reason, "7 of 16 slot units in use")
    const alone = admission(rules, { used: 0, weight: 3, totalMb: 8 * GB })
    assert.equal(alone.admits, true, "a weight-3 command on a two-unit host runs alone")
    assert.equal(alone.need, 2)
    const floored = admission(rules, { used: 0, floors: ["free disk 4 GB on the drive of D: is under heavy.diskFloorMb 15 GB"], totalMb: 64 * GB })
    assert.equal(floored.admits, false, "a floor holds a lone command too")
    assert.equal(floored.free, 0)
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

void test("light commands share the units: four of weight 1 run at once on four units, the fifth waits", async () => {
    const order: string[] = []
    const holder = gate()
    await stderrOf(async () => {
        const held = ["I1", "I2", "I3", "I4"].map((name) => run(host, "install", name, order, holder.wait))
        await pause(300)
        const fifth = run(host, "build", "I5", order)
        await pause(300)
        assert.deepEqual(order, ["I1", "I2", "I3", "I4"])
        holder.open()
        await Promise.all([...held, fifth])
    })
    assert.deepEqual(order, ["I1", "I2", "I3", "I4", "I5"])
    assert.equal(heavySlots().length, 0, "every row is released")
})

void test("a heavy command that does not fit heads the queue, and a light one behind it never jumps it, so the heavy one is never starved", async () => {
    const order: string[] = []
    const holder = gate()
    const text = await stderrOf(async () => {
        const first = run(host, "tsc", "A", order, holder.wait)
        await pause(300)
        const heavy = run(host, "appBuild", "next build", order)
        await pause(300)
        const light = run(host, "install", "npm ci", order)
        await pause(400)
        assert.deepEqual(order, ["A"], "2 of 4 units in use: next build needs 3 and waits; npm ci would fit but waits behind it")
        assert.equal(must(heavySlots().find((slot) => slot.label === "next build")).weight, 3)
        holder.open()
        await Promise.all([first, heavy, light])
    })
    assert.deepEqual(order, ["A", "next build", "npm ci"], "served in the order they came")
    assert.match(text, /next build waits for a heavy-command slot \(3 of the 4 slot units on this host\): first in the queue; 2 of 4 slot units in use; next build needs 3/u)
    assert.match(text, /npm ci waits for a heavy-command slot \(1 of the 4 slot units on this host\): 1 ahead of it/u)
    assert.match(text, /running: A \(2 units, pid/u)
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

void test("the disk floor is the host's config.yaml host.diskFloorMb when set, else the ops/liveness.yaml default, and a waiting command reads it again at every attempt", async () => {
    assert.deepEqual(diskFloorOf({ diskFloorMb: 15_360 }, { source: "config.yaml" }), { diskFloorMb: 15_360, source: "heavy.diskFloorMb (ops/liveness.yaml)" })
    assert.deepEqual(diskFloorOf({ diskFloorMb: 15_360 }, { diskFloorMb: 8192, source: "D:/.claude/.runtime/config.yaml" }), { diskFloorMb: 8192, source: "host.diskFloorMb (D:/.claude/.runtime/config.yaml)" })
    const machines = (host: object | undefined) => () => ({ file: "C:/state/config.yaml", exists: true, doc: { schema: "starci/machines@1" as const, ...(host === undefined ? {} : { host }), machines: {} } })
    assert.equal(readHostSettings(machines({ diskFloorMb: 4096 })).diskFloorMb, 4096)
    assert.equal(readHostSettings(machines(undefined)).diskFloorMb, undefined)
    // A host whose floor the owner lowers while a command waits: the next attempt reads the new floor and admits it, no restart of the waiting process.
    let floorMb = 999_999
    let reads = 0
    const changing: Governed = {
        ...host,
        reread: (last) => {
            reads += 1
            if (reads === 3) floorMb = 0
            return currentHeavyRules(last, () => last, () => ({ diskFloorMb: floorMb, source: "config.yaml" }))
        },
        floors: (_cwd, now) => (now.diskFloorMb > 0 ? [`free disk 1 GB is under host.diskFloorMb ${String(now.diskFloorMb)}`] : []),
    }
    const order: string[] = []
    const text = await stderrOf(() => run(changing, "install", "waits-for-floor", order))
    assert.deepEqual(order, ["waits-for-floor"])
    assert.ok(reads >= 3, "the rules were read again at each attempt")
    assert.match(text, /under host\.diskFloorMb 999999/u)
    assert.equal(heavySlots().length, 0)
})

void test("a row of a process that is gone is dropped at admission, so nothing waits for a dead holder", async () => {
    heavySlots()
    const dead = spawnSync(process.execPath, ["-e", ""]).pid
    withMachine((db) => db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at) VALUES ('ghost', ?, 'tsc', 'ghost', ?, 'running', ?)").run(dead, state, new Date().toISOString()), governorStorePath())
    const order: string[] = []
    const text = await stderrOf(() => run(small, "tsc", "after-ghost", order))
    assert.deepEqual(order, ["after-ghost"])
    assert.equal(text, "")
    assert.equal(heavySlots().length, 0)
})

void test("a row written without a weight (by a CLI copy that has none) holds its kind's weight", () => {
    heavySlots()
    withMachine((db) => db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at) VALUES ('unweighted', ?, 'eslint', 'unweighted', ?, 'running', ?)").run(process.pid, state, new Date().toISOString()), governorStorePath())
    try {
        assert.equal(must(heavySlots().find((slot) => slot.id === "unweighted")).weight, 2)
    } finally {
        withMachine((db) => db.prepare("DELETE FROM heavy_slots WHERE id = 'unweighted'").run(), governorStorePath())
    }
})

void test("a heavy command a held command starts is admitted on its own, and its ancestors never count against it", async () => {
    const one = small
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
        assert.deepEqual(order, ["parent", "child"], "the child started on a two-unit host the parent's tsc fills: the parent's row does not count")
        assert.equal(heavyRoomMb(one), rules.caps.eslint.capMb, "the room this process reads leaves its ancestors out: two free units, one eslint child")
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
    const one = small
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
    const line = waitLine("next build", 2, { cap: 16, need: 3, reason: "14 of 16 slot units in use; next build needs 3" }, ["jest (3 units, pid 7, since 2026-11-23T01:00:00Z)"])
    assert.match(line, /next build waits for a heavy-command slot \(3 of the 16 slot units on this host\): 2 ahead of it; 14 of 16 slot units in use; next build needs 3; running: jest \(3 units, pid 7/u)
})

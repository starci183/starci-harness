// Slot hygiene on a scratch host store (STARCI_LOCAL_ROOT/machine.sqlite) and a scratch lanes folder, never the host's: one slot per lane and kind, a
// killed process reclaimed, the lane's slots released by a removal, the row naming its process and child, a foreign lock file honoured, a kill proven.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { RECLAIMABLE, judgeHolder, killSlot, listSlots, liveProbe, proveLaneGone, readHolder, reclaimStale, releaseLaneSlots, slotLine, slotsOfLane, takeSlot, withSlot } from "./slots.js"
import type { HostProbe, LaneFacts, SlotRules } from "./slots.js"
import { recentEvents } from "./slot-store.js"

const rules: SlotRules = {
    schema: "starci/slots@1",
    root: null,
    kinds: {
        gate: { count: 3, file: "_gate-slot-{n}.lock", warnMinutes: 120, pollSeconds: 1 },
        npm: { count: 2, file: "_npm-slot-{n}.lock", warnMinutes: 30, pollSeconds: 1 },
    },
}

// A lanes folder from the caller's environment would add the host's own foreign lock files to every take.
Reflect.deleteProperty(process.env, "STARCI_LANES_DIR")

const slotsModule = pathToFileURL(join(import.meta.dirname, "slots.js")).href
/** A scratch lanes folder that is also the store's state base: each spec has a host store of its own. */
const scratch = (): string => {
    const root = mkdtempSync(join(tmpdir(), "starci-slots-"))
    process.env.STARCI_LOCAL_ROOT = root
    return root
}
/** A lock that records no pid and no boot: `<lane> <iso>`. */
const bareLock = (root: string, file: string, lane: string): void => {
    writeFileSync(join(root, file), `${lane} ${new Date().toISOString()}`)
}
const held = (root: string, kind: string): string[] => listSlots(root, rules, [kind]).filter((slot) => slot.state !== "free").map((slot) => `${String(slot.n)}:${String(slot.holder)}`)
/** Runs a script as a separate module-mode node process that imports the slots module. */
const child = (script: string, stdio: "ignore" | "pipe") =>
    spawn(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(slotsModule)}); ${script}`], { stdio: ["ignore", stdio, "inherit"] })

void test("retried gates of one lane take one slot, never a second", async () => {
    const root = scratch()
    try {
        const numbers: number[] = []
        for (let attempt = 0; attempt < 4; attempt += 1) await withSlot(root, rules, "gate", "adopt-x", {}, (taken) => { numbers.push(taken.n); return Promise.resolve() })
        assert.deepEqual(numbers, [1, 1, 1, 1])
        assert.deepEqual(held(root, "gate"), [], "released after every attempt")
        const first = await takeSlot(root, rules, "gate", "adopt-x", { pid: process.pid })
        const second = await takeSlot(root, rules, "gate", "adopt-x", { pid: process.pid })
        assert.equal(second.n, first.n)
        assert.equal(second.already, true)
        assert.deepEqual(held(root, "gate"), ["1:adopt-x"])
        // a failing run still releases
        await assert.rejects(withSlot(root, rules, "npm", "adopt-x", {}, () => Promise.reject(new Error("boom"))), /boom/)
        assert.deepEqual(held(root, "npm"), [])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a killed process leaves a slot the next take reclaims", async () => {
    const root = scratch()
    try {
        const run = child(`await m.takeSlot(${JSON.stringify(root)}, ${JSON.stringify(rules)}, "gate", "crash-lane", { pid: process.pid }); console.log("held"); setInterval(() => {}, 1000)`, "pipe")
        await new Promise<void>((settle) => run.stdout?.once("data", () => {
            settle()
        }))
        assert.deepEqual(held(root, "gate"), ["1:crash-lane"])
        const exited = new Promise((settle) => run.once("exit", settle))
        run.kill("SIGKILL")
        await exited
        const view = listSlots(root, rules, ["gate"]).at(0)
        assert.ok(view)
        assert.equal(view.state, "dead")
        assert.equal(view.alive, "no")
        assert.equal(view.reclaimable, true)
        const taken = await takeSlot(root, rules, "gate", "other-lane", { pid: process.pid })
        assert.equal(taken.n, 1)
        assert.equal(taken.reclaimed.length, 1)
        assert.match(taken.reclaimed[0] ?? "", /dead: pid \d+ is not alive/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a process that exits or is signalled inside withSlot releases its slot", async () => {
    const root = scratch()
    try {
        for (const ending of ["process.exit(3)", "process.emit('SIGINT')"]) {
            const run = child(`await m.withSlot(${JSON.stringify(root)}, ${JSON.stringify(rules)}, "gate", "exit-lane", {}, async () => { ${ending}; await new Promise(() => {}) })`, "ignore")
            await new Promise((settle) => run.once("exit", settle))
            assert.deepEqual(held(root, "gate"), [], ending)
        }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a removal releases every slot of the lane, of any kind, and no one else's", async () => {
    const root = scratch()
    try {
        await takeSlot(root, rules, "gate", "lane-a", { pid: process.pid })
        await takeSlot(root, rules, "npm", "lane-a", { pid: process.pid })
        bareLock(root, "_gate-slot-2.lock", "lane-a")
        await takeSlot(root, rules, "npm", "lane-b", { pid: process.pid })
        assert.equal(slotsOfLane(root, rules, "lane-a").length, 3)
        const freed = releaseLaneSlots(root, rules, "lane-a", "lane remove")
        assert.equal(freed.released.length, 3)
        assert.deepEqual(held(root, "gate"), [])
        assert.deepEqual(held(root, "npm"), ["2:lane-b"])
        assert.ok(recentEvents(20).some((event) => event.action === "released" && event.holder === "lane-a" && event.by === "lane remove"), "each release is logged in slot_events")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

/** A host probe whose clock, boot, pids and lane proof are given, so each judgement is exact. */
const probeOf = (over: Partial<HostProbe> & { readonly alive?: (pid: number) => boolean }): HostProbe => ({
    nowMs: Date.parse("2026-11-26T12:00:00Z"),
    bootMs: Date.parse("2026-11-25T06:00:00Z"),
    hostname: "box",
    alive: () => false,
    startMs: () => null,
    ...over,
})
const npmKind = rules.kinds.npm
const legacy = (name: string, at = "2026-11-25T16:00:00.000Z") => {
    const root = scratch()
    writeFileSync(join(root, "_npm-slot-1.lock"), `${name} ${at}`)
    const read = readHolder(join(root, "_npm-slot-1.lock"))
    rmSync(root, { recursive: true, force: true })
    assert.ok(read && npmKind)
    return { read, kind: npmKind }
}
const laneFacts = (over: Partial<LaneFacts>): LaneFacts => ({ worktrees: [], processes: [], finished: () => false, self: process.pid, ...over })

void test("a take without a pid, or a pid the OS does not report a start for, writes no lock", async () => {
    const root = scratch()
    try {
        await assert.rejects(takeSlot(root, rules, "npm", "lane-x", {}), /records the ONE process/)
        await assert.rejects(takeSlot(root, rules, "npm", "lane-x", { pid: 2_147_000_001 }), /does not report its start|not running/)
        assert.deepEqual(held(root, "npm"), [])
        const line = slotLine("lane-x", process.pid)
        assert.match(line, /^lane-x \S+ pid=\d+ start=\S+ boot=\S+ host=\S+$/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a legacy pid-less lock whose lane is gone is reclaimable, with its evidence", async () => {
    const { read, kind } = legacy("flower-shop-workbench-2340")
    const judged = judgeHolder(kind, read, probeOf({ laneGone: (holder) => proveLaneGone("D:/lanes", holder, laneFacts({})) }))
    assert.equal(judged.state, "gone")
    assert.match(judged.evidence, /no pid recorded; lane flower-shop-workbench-2340 has no worktree and no live process names it/)
    // on real files: `slot release --stale` reclaims it and logs the evidence
    const root = scratch()
    try {
        mkdirSync(join(root, "_land-status"))
        writeFileSync(join(root, "_land-status", "old-lane.json"), JSON.stringify({ state: "landed" }))
        bareLock(root, "_npm-slot-1.lock", "old-lane")
        const view = listSlots(root, rules, ["npm"]).at(0)
        assert.equal(view?.state, "held", "without lane evidence the list only says why")
        assert.match(view.why ?? "", /nothing was read about its lane/)
        const done = await reclaimStale(root, rules, ["npm"], "spec")
        assert.equal(done.released.length, 1)
        assert.match(done.released[0] ?? "", /gone: no pid recorded; lane old-lane has no worktree/)
        assert.deepEqual(held(root, "npm"), [])
        assert.ok(recentEvents(20).some((event) => event.action === "reclaimed" && event.holder === "old-lane" && event.evidence.startsWith("gone: ")), "the reclaim is logged with its evidence")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a pid-less lock with a live holder is not reclaimable, and says why", () => {
    const { read, kind } = legacy("flower-shop-workbench-2660", "2026-11-26T11:00:00.000Z")
    // the pid its name ends in is alive and started before the lock: the script that wrote it is still installing
    const named = judgeHolder(kind, read, probeOf({ alive: (pid) => pid === 2660, startMs: () => Date.parse("2026-11-26T10:59:50Z"), laneGone: () => ({ gone: true, evidence: "x" }) }))
    assert.ok(["held", "old"].includes(named.state), named.state)
    assert.match(named.evidence, /name ends in pid 2660, which is alive/)
    // a process works in the lane's worktree, or names the holder in its command line
    const worktree = { path: "D:/starci-lanes/some-lane", branch: "lane/some-lane" }
    mkdirSync(worktree.path, { recursive: true })
    try {
        const inside = proveLaneGone("D:/starci-lanes", "some-lane", laneFacts({ worktrees: [worktree], processes: [{ pid: 7, ppid: 1, name: "npm.exe", workingSetMb: 1, commandLine: "npm ci", cpuMs: null, startedMs: null, cwd: "D:/starci-lanes/some-lane/cli" }] }))
        assert.equal(inside.gone, false)
        assert.match(inside.evidence, /pid 7 npm.exe works in the worktree/)
        const idle = proveLaneGone("D:/starci-lanes", "some-lane", laneFacts({ worktrees: [worktree] }))
        assert.equal(idle.gone, true, "a worktree nobody works in does not keep a pid-less lock")
    } finally {
        rmSync(worktree.path, { recursive: true, force: true })
    }
    const named2 = proveLaneGone("D:/lanes", "lane-q", laneFacts({ processes: [{ pid: 9, ppid: 1, name: "node.exe", workingSetMb: 1, commandLine: "node run.mjs --lane lane-q", cpuMs: null, startedMs: null, cwd: null }] }))
    assert.equal(named2.gone, false)
    // an unreadable process table proves nothing
    assert.equal(proveLaneGone("D:/lanes", "lane-q", laneFacts({ processes: "denied" })).gone, false)
    // a lane named like `h-x-390` is not judged dead by its suffix: only the lane proof can reclaim it
    const suffixed = legacy("h-train-390")
    assert.ok(!RECLAIMABLE.has(judgeHolder(suffixed.kind, suffixed.read, probeOf({ laneGone: () => ({ gone: false, evidence: "pid 5 node works in the worktree" }) })).state))
})

void test("a reused pid is reclaimable: the recorded start differs from the process now running", () => {
    const kind = npmKind
    assert.ok(kind)
    const root = scratch()
    try {
        writeFileSync(join(root, "_npm-slot-1.lock"), "lane-r 2026-11-26T09:00:00.000Z pid=4242 start=2026-11-26T08:59:00.000Z boot=2026-11-25T06:00:00.000Z host=box")
        const read = readHolder(join(root, "_npm-slot-1.lock"))
        assert.ok(read)
        const reused = judgeHolder(kind, read, probeOf({ alive: () => true, startMs: () => Date.parse("2026-11-26T11:30:00Z") }))
        assert.equal(reused.state, "reused")
        assert.match(reused.evidence, /pid 4242 now runs a process started 2026-11-26T11:30:00.000Z, not the holder started 2026-11-26T08:59:00.000Z/)
        const same = judgeHolder(kind, read, probeOf({ alive: () => true, startMs: () => Date.parse("2026-11-26T08:59:01Z") }))
        assert.ok(!RECLAIMABLE.has(same.state), same.state)
        assert.equal(judgeHolder(kind, read, probeOf({ alive: () => false })).state, "dead")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

/** A sleeping node process this spec starts (and kills): a holder whose tree a kill can take. */
const sleeper = () => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })

void test("a slot is a row naming its process, its start and its child, and goes the moment the work ends", async () => {
    const root = scratch()
    try {
        const seen = await withSlot(root, rules, "npm", "row-lane", { command: "npm ci" }, (taken) => {
            taken.spawned(4242)
            const view = listSlots(root, rules, ["npm"]).find((slot) => slot.n === taken.n)
            return Promise.resolve(view)
        })
        assert.equal(seen?.source, "store")
        assert.equal(seen.pid, process.pid, "the row names the process that holds it")
        assert.equal(seen.childPid, 4242, "and the child doing the work")
        assert.equal(seen.command, "npm ci")
        assert.equal(seen.state, "held")
        assert.deepEqual(held(root, "npm"), [], "released as the work ended")
        const actions = recentEvents(10).filter((event) => event.holder === "row-lane").map((event) => event.action)
        assert.deepEqual(actions, ["taken", "released"])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a foreign lock file of an older copy holds its number for every taker, and is never written", async () => {
    const root = scratch()
    try {
        const start = new Date(Date.now() - process.uptime() * 1000).toISOString()
        writeFileSync(join(root, "_npm-slot-1.lock"), `old-copy-lane ${new Date().toISOString()} pid=${String(process.pid)} start=${start} boot=${new Date(Date.now() - 3_600_000).toISOString()} host=elsewhere`)
        const taken = await takeSlot(root, rules, "npm", "new-lane", { pid: process.pid })
        assert.equal(taken.n, 2, "number 1 is the foreign holder's")
        const views = listSlots(root, rules, ["npm"])
        assert.equal(views.find((slot) => slot.n === 1)?.source, "foreign")
        assert.equal(views.find((slot) => slot.n === 2)?.source, "store")
        await assert.rejects(takeSlot(root, rules, "npm", "third-lane", { pid: process.pid, waitSeconds: 0 }), /every npm slot is held/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("another live process of the lane holding the kind keeps a take waiting: one slot per lane and kind, one process per slot", async () => {
    const root = scratch()
    const other = sleeper()
    try {
        assert.ok(other.pid)
        await takeSlot(root, rules, "gate", "one-lane", { pid: other.pid })
        await assert.rejects(takeSlot(root, rules, "gate", "one-lane", { pid: process.pid, waitSeconds: 0 }), /one-lane holds gate slot 1 under pid/)
    } finally {
        other.kill("SIGKILL")
        rmSync(root, { recursive: true, force: true })
    }
})

void test("slot kill kills the holder's process tree only when its start proves it, frees the slot and logs it", async () => {
    const root = scratch()
    const holder = sleeper()
    try {
        assert.ok(holder.pid)
        const pid = holder.pid
        const started = Date.now() - 1000
        await takeSlot(root, rules, "gate", "kill-lane", { pid, startOf: () => started })
        const base = liveProbe()
        // the pid now runs a process started at another time: refused, nothing killed
        assert.throws(() => killSlot(root, rules, "gate", 1, { execute: true, by: "spec", probe: { ...base, startMs: () => started + 600_000 }, kill: () => assert.fail("a reused pid is never killed") }), /SLOT_KILL_REUSED|not the slot's holder/)
        // its start cannot be read: unproven, nothing killed
        assert.throws(() => killSlot(root, rules, "gate", 1, { execute: true, by: "spec", probe: { ...base, startMs: () => null }, kill: () => assert.fail("an unproven pid is never killed") }), /cannot be matched/)
        // proven: a dry run names it, --execute kills its tree and frees the slot
        const probe = { ...base, startMs: (at: number) => (at === pid ? started : null) }
        const dry = killSlot(root, rules, "gate", 1, { execute: false, by: "spec", probe, kill: () => assert.fail("a dry run kills nothing") })
        assert.equal(dry.killed, false)
        assert.equal(dry.target, pid)
        const killed: number[] = []
        const done = killSlot(root, rules, "gate", 1, { execute: true, by: "spec", probe, kill: (target) => {
            killed.push(target)
            holder.kill("SIGKILL")
            return true
        } })
        assert.equal(done.killed, true)
        assert.deepEqual(killed, [pid])
        assert.deepEqual(held(root, "gate"), [])
        assert.ok(recentEvents(10).some((event) => event.action === "killed" && event.pid === pid && event.by === "spec"))
        assert.throws(() => killSlot(root, rules, "gate", 1, { execute: true, by: "spec", probe }), /SLOT_KILL_FREE|is free/)
    } finally {
        holder.kill("SIGKILL")
        rmSync(root, { recursive: true, force: true })
    }
})

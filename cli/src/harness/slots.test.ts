// Slot hygiene on real files in a scratch slot root, never the lanes folder: one slot per lane and kind, a killed process reclaimed,
// the old helper's locks of a removed lane reclaimed, the lane's slots released by a removal and by landing.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { releaseLaneSlotsOf } from "./land-batch.js"
import { listSlots, releaseLaneSlots, slotsOfLane, takeSlot, withSlot } from "./slots.js"
import type { SlotRules } from "./slots.js"

const rules: SlotRules = {
    schema: "starci/slots@1",
    root: null,
    kinds: {
        gate: { count: 3, file: "_gate-slot-{n}.lock", warnMinutes: 120, pollSeconds: 1 },
        npm: { count: 2, file: "_npm-slot-{n}.lock", warnMinutes: 30, pollSeconds: 1 },
    },
}

const slotsModule = pathToFileURL(join(import.meta.dirname, "slots.js")).href
const scratch = (): string => mkdtempSync(join(tmpdir(), "starci-slots-"))
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" })
/** A lock as the old helper wrote it: `<lane> <iso>`, no pid, no boot. */
const oldLock = (root: string, file: string, lane: string): void => {
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

void test("a take for a lane whose slot is in the old format returns that slot and frees its leaked duplicates", async () => {
    const root = scratch()
    try {
        for (const n of [1, 2, 3]) oldLock(root, `_gate-slot-${String(n)}.lock`, "adopt-185")
        const taken = await takeSlot(root, rules, "gate", "adopt-185", { pid: process.pid })
        assert.equal(taken.already, true)
        assert.equal(taken.n, 1)
        assert.equal(taken.pid, process.pid, "stamped with the pid now holding it")
        assert.equal(taken.reclaimed.length, 2)
        assert.deepEqual(held(root, "gate"), ["1:adopt-185"])
        assert.match(readFileSync(join(root, "_slots.log"), "utf8"), /second slot of the same lane and kind written by the old helper/)
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

void test("old-format locks of a lane whose worktree is gone are reclaimed; a lane with a worktree keeps them", async () => {
    const root = scratch()
    try {
        const main = join(root, "main")
        mkdirSync(main)
        git(main, "init", "-q", "-b", "main")
        writeFileSync(join(main, "a.txt"), "a")
        git(main, "add", ".")
        git(main, "commit", "-q", "-m", "init")
        git(main, "worktree", "add", "-q", "-b", "lane/adopt-x", join(root, "adopt-x"))
        git(main, "worktree", "add", "-q", "-b", "lane/live-y", join(root, "live-y"))
        oldLock(root, "_gate-slot-1.lock", "adopt-x")
        oldLock(root, "_gate-slot-2.lock", "live-y")
        oldLock(root, "_npm-slot-1.lock", "adopt-x")
        const before = listSlots(root, rules)
        assert.deepEqual(before.filter((slot) => slot.state !== "free").map((slot) => [slot.holder, slot.state, slot.alive, slot.reclaimable]), [["adopt-x", "held", "unknown", false], ["live-y", "held", "unknown", false], ["adopt-x", "held", "unknown", false]])
        git(main, "worktree", "remove", "--force", join(root, "adopt-x"))
        const after = listSlots(root, rules)
        assert.deepEqual(after.filter((slot) => slot.state !== "free").map((slot) => [slot.holder, slot.state, slot.reclaimable]), [["adopt-x", "gone", true], ["live-y", "held", false], ["adopt-x", "gone", true]])
        assert.match(after[0]?.evidence ?? "", /no worktree of the 1 repository under .* ends in \/adopt-x/)
        const taken = await takeSlot(root, rules, "gate", "someone-else", { pid: process.pid })
        assert.equal(taken.n, 1, "the gone lane's slot is reclaimed, the live lane's kept")
        assert.equal(taken.reclaimed.length, 1)
        assert.match(readFileSync(join(root, "_slots.log"), "utf8"), /reclaimed .*_gate-slot-1\.lock from "adopt-x .*gone: .*old helper/)
        assert.deepEqual(held(root, "gate"), ["1:someone-else", "2:live-y"])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("without a repository under the root, a landed or rejected lane's status stands in for its worktree", () => {
    const root = scratch()
    try {
        mkdirSync(join(root, "_land-status"))
        writeFileSync(join(root, "_land-status", "done-lane.json"), JSON.stringify({ lane: "done-lane", state: "landed" }))
        writeFileSync(join(root, "_land-status", "busy-lane.json"), JSON.stringify({ lane: "busy-lane", state: "queued" }))
        oldLock(root, "_gate-slot-1.lock", "done-lane")
        oldLock(root, "_gate-slot-2.lock", "busy-lane")
        oldLock(root, "_gate-slot-3.lock", "unknown-lane")
        assert.deepEqual(listSlots(root, rules, ["gate"]).map((slot) => slot.state), ["gone", "held", "held"])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("a removal and a landing release every slot of the lane, of any kind, and no one else's", async () => {
    const root = scratch()
    try {
        await takeSlot(root, rules, "gate", "lane-a", { pid: process.pid })
        await takeSlot(root, rules, "npm", "lane-a", { pid: process.pid })
        oldLock(root, "_gate-slot-2.lock", "lane-a")
        await takeSlot(root, rules, "npm", "lane-b", { pid: process.pid })
        assert.equal(slotsOfLane(root, rules, "lane-a").length, 3)
        const freed = releaseLaneSlots(root, rules, "lane-a", "lane remove")
        assert.equal(freed.released.length, 3)
        assert.deepEqual(held(root, "gate"), [])
        assert.deepEqual(held(root, "npm"), ["2:lane-b"])
        await takeSlot(root, rules, "gate", "lane-c", { pid: process.pid })
        await takeSlot(root, rules, "gate", "lane-d", { pid: process.pid })
        const said: string[] = []
        releaseLaneSlotsOf(root, "lane-c", "landed", (line) => said.push(line))
        releaseLaneSlotsOf(root, "lane-d", "rejected", (line) => said.push(line))
        assert.deepEqual(held(root, "gate"), [])
        assert.equal(said.length, 2)
        assert.equal(existsSync(join(root, "_slots.log")), true)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

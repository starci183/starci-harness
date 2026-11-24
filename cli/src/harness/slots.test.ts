// Slot hygiene on real files in a scratch slot root, never the lanes folder: one slot per lane and kind, a killed process reclaimed,
// the lane's slots released by a removal.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
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
        assert.equal(existsSync(join(root, "_slots.log")), true)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

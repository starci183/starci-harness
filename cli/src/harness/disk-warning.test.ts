import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DEFAULT_DISK_WARN_MB, diskWarningLines } from "./disk-warning.js"
import type { DiskWarningDeps } from "./disk-warning.js"
import type { SlotRules } from "./slots.js"

const rules: SlotRules = { schema: "starci/slots@1", root: null, kinds: { gate: { count: 2, file: "_gate-slot-{n}.lock", warnMinutes: 120, pollSeconds: 1 } }, janitor: { idleHours: 6, touchedMinutes: 60, dirs: ["node_modules"] } } as unknown as SlotRules

/** A lanes folder with three landed lane folders (a, b, c), one of them (b) with a process working inside, and a lane (d) that has not landed. */
const world = (t: { after: (fn: () => void) => void }, over: Partial<DiskWarningDeps> = {}): { dir: string; deps: DiskWarningDeps; paths: Record<string, string> } => {
    const dir = mkdtempSync(join(tmpdir(), "disk-warning-"))
    t.after(() => {
        rmSync(dir, { recursive: true, force: true })
    })
    const paths: Record<string, string> = {}
    for (const lane of ["a", "b", "c", "d", "mine"]) {
        paths[lane] = join(dir, `h-${lane}`)
        mkdirSync(join(dir, `h-${lane}`))
    }
    const deps: DiskWarningDeps = {
        freeMb: () => 30_000,
        heavy: () => ({ diskFloorMb: 15_360 }),
        settings: () => ({ source: "none" }),
        trees: () => Object.entries(paths).map(([lane, path]) => ({ path, lane, branch: `lane/${lane}` })),
        landed: () => ["a", "b", "c", "mine"].map((lane) => ({ lane, laneSha: "" })),
        live: () => Promise.resolve({ root: dir, rules, processes: [{ pid: 4242, ppid: 1, name: "bash.exe", workingSetMb: 0, cpuMs: 0, startedMs: 0, cwd: join(dir, "h-b"), commandLine: "bash" }], spared: new Set<number>() }),
        rules: () => rules,
        ...over,
    }
    return { dir, deps, paths }
}

void test("under the early threshold the gate warns and lists the landed worktrees that can go, not the one in use, not unlanded, not its own", async (t) => {
    const w = world(t)
    const lines = await diskWarningLines(w.dir, "mine", w.deps)
    assert.match(lines[0] ?? "", /^WARNING: 29\.3 GB free on the drive of .+ under the early warning of 50 GB \(heavy\.diskWarnMb of ops\/liveness\.yaml\); under 15 GB nothing heavy starts/)
    assert.match(lines[1] ?? "", /^ {2}2 landed lane worktree\(s\) can be removed .*this gate removes none/)
    const listed = lines.filter((line) => line.startsWith("    "))
    assert.deepEqual(listed, [`    a: ${join(w.dir, "h-a")}`, `    c: ${join(w.dir, "h-c")}`])
    assert.match(lines.at(-1) ?? "", /^ {2}1 more landed worktree\(s\) are in use/)
})

void test("with room, or an unreadable drive, there is no warning and nothing is read of the lanes", async (t) => {
    const w = world(t, { freeMb: () => DEFAULT_DISK_WARN_MB })
    assert.deepEqual(await diskWarningLines(w.dir, "mine", w.deps), [])
    const blind = world(t, { freeMb: () => null })
    assert.deepEqual(await diskWarningLines(blind.dir, "mine", blind.deps), [])
})

void test("the threshold is configurable, host over liveness, and never under the heavy floor", async (t) => {
    const lowHost = world(t, { freeMb: () => 20_000, settings: () => ({ diskWarnMb: 10_000, source: "x" }) })
    // 10 GB is under the 15 GB floor: the floor is the threshold, and 20 GB free is above it.
    assert.deepEqual(await diskWarningLines(lowHost.dir, "mine", lowHost.deps), [])
    const host = world(t, { freeMb: () => 70_000, settings: () => ({ diskWarnMb: 81_920, source: "x" }) })
    assert.match((await diskWarningLines(host.dir, "mine", host.deps))[0] ?? "", /under the early warning of 80 GB \(host\.diskWarnMb\)/)
    const liveness = world(t, { freeMb: () => 70_000, heavy: () => ({ diskFloorMb: 15_360, diskWarnMb: 71_680 }) })
    assert.match((await diskWarningLines(liveness.dir, "mine", liveness.deps))[0] ?? "", /under the early warning of 70 GB/)
})

void test("a drive with no landed worktree left says so; nothing is deleted by the warning", async (t) => {
    const w = world(t, { landed: () => [] })
    const lines = await diskWarningLines(w.dir, "mine", w.deps)
    assert.match(lines[1] ?? "", /no landed lane worktree is left to remove/)
    for (const path of Object.values(w.paths)) assert.ok(rmSafe(path), `${path} still exists`)
})

/** True when the folder still exists. */
const rmSafe = (path: string): boolean => {
    try {
        mkdirSync(path)
        return false
    } catch {
        return true
    }
}

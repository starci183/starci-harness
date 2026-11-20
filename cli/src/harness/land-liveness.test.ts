// The lander's liveness as `lane status` reads it: a lock whose pid is gone is "dead", a running pid whose lock has not been touched for
// LANDER_HEARTBEAT_MS is "stuck", and a running pid with a fresh heartbeat is "alive". No lock is "none".
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LANDER_HEARTBEAT_MS, landerLiveness, touchLander } from "./land-queue.js"

const withLock = (body: (file: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "lander-liveness-"))
    try {
        const file = join(dir, "_batch-lander.lock")
        writeFileSync(file, "batch-lander 2026-11-20T07:47:17.045Z pid=4242")
        body(file)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

void test("no lock reads as none", () => {
    assert.deepEqual(landerLiveness(join(tmpdir(), "no-such-lander.lock")), { state: "none" })
})

void test("a lock whose pid no longer runs is dead", () => {
    withLock((file) => {
        const liveness = landerLiveness(file, Date.now(), () => false)
        assert.equal(liveness.state, "dead")
        assert.equal("pid" in liveness ? liveness.pid : 0, 4242)
    })
})

void test("a running pid with a fresh heartbeat is alive, a stale one is stuck", () => {
    withLock((file) => {
        const touched = statSync(file).mtimeMs
        assert.equal(landerLiveness(file, touched + 1000, () => true).state, "alive")
        assert.equal(landerLiveness(file, touched + LANDER_HEARTBEAT_MS + 1000, () => true).state, "stuck")
    })
})

void test("touchLander moves the heartbeat, and a missing lock is left alone", () => {
    withLock((file) => {
        const old = new Date(Date.now() - 2 * LANDER_HEARTBEAT_MS)
        utimesSync(file, old, old)
        assert.equal(landerLiveness(file, Date.now(), () => true).state, "stuck")
        touchLander(file)
        assert.equal(landerLiveness(file, Date.now(), () => true).state, "alive")
        touchLander(`${file}.missing`)
    })
})

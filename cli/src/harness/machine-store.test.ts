// The host store is ONE file per host: every checkout, worktree and installed CLI copy, whatever folder it runs in, resolves the same machine.sqlite
// (ledger.ts machineStoreOf), so the lane slots and the heavy governor in it bound the whole machine. A spec's STARCI_LOCAL_ROOT, or `node --test`, never
// reaches the host's live store.
import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import test from "node:test"
import { machineStoreOf } from "./ledger.js"
import type { MachineFacts } from "./ledger.js"

const host: MachineFacts = {
    localRoot: undefined,
    testing: false,
    stateBase: "D:/starci-lanes/_cli-abc/.runtime",
    pointed: undefined,
    pointedExists: false,
    checkout: "D:/.claude",
    userState: "C:/Users/u/AppData/Local/starci",
}

void test("the harness checkout and every worktree of it resolve the main checkout's store and record it in the pointer", () => {
    const fromWorktree = machineStoreOf({ ...host, stateBase: "D:/starci-lanes/h-lane/.runtime" })
    const fromCliCopy = machineStoreOf({ ...host, stateBase: "D:/starci-lanes/_cli-abc/.runtime" })
    assert.equal(fromWorktree.store, join("D:/.claude", ".runtime", "machine.sqlite"))
    assert.equal(fromCliCopy.store, fromWorktree.store, "a worktree's own state base never splits the store")
    assert.equal(fromWorktree.writePointer, true)
})

void test("a CLI installed in an app's node_modules reaches the same store through the host pointer, from any folder", () => {
    const pointed = join("D:/.claude", ".runtime", "machine.sqlite")
    const installed = machineStoreOf({ ...host, checkout: undefined, stateBase: "D:/Repositories/app/node_modules/starci-harness/.runtime", pointed, pointedExists: true })
    assert.deepEqual(installed, { store: pointed, writePointer: false })
    // the pointer wins over a checkout too, so a second clone of the harness never opens a second store
    assert.equal(machineStoreOf({ ...host, checkout: "E:/other-clone", pointed, pointedExists: true }).store, pointed)
    // a pointer to a file that is gone is ignored; with no checkout the per-user store stands in
    assert.equal(machineStoreOf({ ...host, checkout: undefined, pointed, pointedExists: false }).store, join("C:/Users/u/AppData/Local/starci", "harness", "machine.sqlite"))
})

void test("a spec's STARCI_LOCAL_ROOT, or node --test without it, never reaches the live store", () => {
    assert.equal(machineStoreOf({ ...host, localRoot: "T:/scratch" }).store, join(resolve("T:/scratch"), "machine.sqlite"))
    assert.deepEqual(machineStoreOf({ ...host, testing: true, pointed: "D:/.claude/.runtime/machine.sqlite", pointedExists: true }), { store: join(host.stateBase, "machine.sqlite"), writePointer: false })
})

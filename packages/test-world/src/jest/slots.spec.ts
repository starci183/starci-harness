import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { AnyTestWorldConfig } from "../config/types"
import { TestWorldErrorCode, worldError } from "../errors"
import { LIBRARY, SLOT_ENV, STATE_FILE_ENV, STATE_VERSION, readRunContext, removeRunState, writeRunState } from "./context"
import type { RunContext } from "./context"
import { MAX_SLOTS, readTestWorkers } from "../config/stack-file"
import { isSlotsExhausted, provisionSlots, requestedWorkers, selectedKinds, slotCountOf, WORKERS_ENV, withRealmUserIds, workersOfRun } from "./setup"

const slotContext = (slot: number): RunContext => ({
    slot,
    runId: `run-w${slot}`,
    namespace: { snake: `shop_a1b2c3_w${slot}`, kebab: `shop-a1b2c3-w${slot}`, root: "/repo" },
    secretSeed: "seed",
    infra: { toxiproxyApi: "http://127.0.0.1:1" },
    fakes: { controlUrl: `http://127.0.0.1:${4000 + slot}`, entries: {} },
    services: {},
    directories: { run: join(tmpdir(), `tw-slot-${slot}`) },
    keepTables: {},
    root: "/repo",
})

const code = (cause: unknown): unknown => (cause as { code?: unknown }).code

test.afterEach(() => {
    removeRunState()
    delete process.env[SLOT_ENV]
})

test("the state file carries every slot, and a process reads the slot the runner bound it to", () => {
    writeRunState("run", [slotContext(1), slotContext(2)])
    process.env[SLOT_ENV] = "2"
    const context = readRunContext()
    assert.equal(context.slot, 2)
    assert.equal(context.namespace.snake, "shop_a1b2c3_w2")
    assert.equal(context.fakes.controlUrl, "http://127.0.0.1:4002")
    assert.match(LIBRARY, /^@starci\/test-world@\d+\.\d+\.\d+/)
    assert.equal(STATE_VERSION, 2)
})

test("a process with no slot, or a slot the run does not have, is a PairMismatch: never a silently shared slot", () => {
    writeRunState("run", [slotContext(1), slotContext(2)])
    assert.throws(() => readRunContext(), (cause: unknown) => code(cause) === TestWorldErrorCode.PairMismatch && /STARCI_TEST_WORLD_SLOT=undefined/.test(String(cause)))
    process.env[SLOT_ENV] = "3"
    assert.throws(() => readRunContext(), (cause: unknown) => code(cause) === TestWorldErrorCode.PairMismatch && /none of the run's 2 slot/.test(String(cause)))
})

test("a state file of another protocol (test-world before 1.1.0) is a PairMismatch naming both sides", () => {
    const path = join(tmpdir(), `tw-v1-${process.pid}.json`)
    writeFileSync(path, JSON.stringify({ version: 1, runId: "x" }))
    process.env[STATE_FILE_ENV] = path
    process.env[SLOT_ENV] = "1"
    try {
        assert.throws(
            () => readRunContext(),
            (cause: unknown) => code(cause) === TestWorldErrorCode.PairMismatch && String(cause).includes("protocol 1") && String(cause).includes(LIBRARY),
        )
    } finally {
        rmSync(path, { force: true })
    }
})

test("a run has one slot per worker, capped by the declaration's workers when it names one and by 8 always, never fewer than one", () => {
    const config = (workers?: number): AnyTestWorldConfig => ({ workers }) as unknown as AnyTestWorldConfig
    assert.equal(MAX_SLOTS, 8)
    assert.equal(slotCountOf(config(), 7), 7)
    assert.equal(slotCountOf(config(), 12), 8)
    assert.equal(slotCountOf(config(), 1), 1)
    assert.equal(slotCountOf(config(), undefined), 1)
    assert.equal(slotCountOf(config(3), 7), 3)
    assert.equal(slotCountOf(config(3), 2), 2)
    assert.equal(requestedWorkers({}), undefined, "a run asks for none explicitly")
    assert.equal(requestedWorkers({ [WORKERS_ENV]: "3" }), 3)
    for (const wrong of ["0", "-1", "1.5", "many", ""]) assert.equal(requestedWorkers({ [WORKERS_ENV]: wrong }), undefined, `"${wrong}" is no worker count`)
})

/** An app root whose application-stacks.yaml holds `text`. */
const appWith = (text: string | undefined): string => {
    const root = mkdtempSync(join(tmpdir(), "stacks-tests-"))
    mkdirSync(join(root, ".starcistacks"), { recursive: true })
    if (text !== undefined) writeFileSync(join(root, ".starcistacks", "application-stacks.yaml"), text)
    return root
}

test("tests.<kind>.workers of the stacks file sizes each kind, one when absent, and a wrong shape is TEST_WORLD_CONFIG_INVALID", () => {
    const read = (text: string | undefined) => {
        const root = appWith(text)
        try {
            return readTestWorkers(root)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
    assert.deepEqual(read(undefined), { integration: 1, e2e: 1 })
    assert.deepEqual(read("components: {}\n"), { integration: 1, e2e: 1 })
    assert.deepEqual(read("tests:\n  integration: { workers: 3 }\n"), { integration: 3, e2e: 1 })
    assert.deepEqual(read("tests:\n  integration:\n    workers: 3\n  e2e:\n    workers: 8\n"), { integration: 3, e2e: 8 })
    for (const wrong of ["tests: 3\n", "tests:\n  unit: { workers: 2 }\n", "tests:\n  e2e: 2\n", "tests:\n  e2e: { workers: 0 }\n", "tests:\n  e2e: { workers: 9 }\n", "tests:\n  e2e: { workers: 1.5 }\n", 'tests:\n  e2e: { workers: "2" }\n', "tests:\n  e2e: { workers: 2, extra: 1 }\n"]) {
        assert.throws(() => read(wrong), { code: TestWorldErrorCode.ConfigInvalid }, wrong)
    }
})

test("the workers of a run are the explicit request or the declared ones, for the kinds the command line selects", () => {
    const declared = { integration: 3, e2e: 2 }
    assert.deepEqual(workersOfRun(declared, {}), { integration: 3, e2e: 2 })
    assert.deepEqual(workersOfRun(declared, { kinds: ["e2e"] }), { e2e: 2 })
    assert.deepEqual(workersOfRun(declared, { explicit: 4, kinds: ["integration"] }), { integration: 4 })
    assert.deepEqual(selectedKinds(["jest", "--selectProjects", "e2e"]), ["e2e"])
    assert.deepEqual(selectedKinds(["jest", "--selectProjects=integration", "--ci"]), ["integration"])
    assert.deepEqual(selectedKinds(["jest", "--selectProjects", "integration", "e2e", "--ci"]), ["integration", "e2e"])
    assert.deepEqual(selectedKinds(["jest", "--selectProjects", "unit"]), ["integration", "e2e"], "no world kind selected: both are sized")
    assert.deepEqual(selectedKinds(["jest"]), ["integration", "e2e"])
})

test("a slot's seeds name the realm users by the ids the slot's realm stores them under", () => {
    const pinned = "4f1c2b7e-8a3d-4e5f-9b6a-0c1d2e3f4a5b"
    const context = { infra: { toxiproxyApi: "x", keycloak: { userIds: { [pinned]: "stored-id" } } } } as unknown as RunContext
    assert.equal(withRealmUserIds(`INSERT INTO persons (id) VALUES ('${pinned}'); -- ${pinned}`, context), "INSERT INTO persons (id) VALUES ('stored-id'); -- stored-id")
    assert.equal(withRealmUserIds("SELECT 1", { infra: { toxiproxyApi: "x" } } as unknown as RunContext), "SELECT 1")
})

test("a run whose later slot finds no free Redis database goes on with the slots it made", async () => {
    const warned: string[] = []
    const made = await provisionSlots(3, async (slot) => {
        if (slot === 3) throw worldError(TestWorldErrorCode.SlotsExhausted, "all 16 redis databases are leased by live runs")
        return slot
    }, (message) => warned.push(message))
    assert.deepEqual(made, [1, 2])
    assert.match(warned[0] ?? "", /2 of 3 slot\(s\)/)
})

test("the first slot, and any other failure, still fails the run", async () => {
    await assert.rejects(provisionSlots(2, async () => { throw worldError(TestWorldErrorCode.SlotsExhausted, "none free") }, () => undefined), { code: TestWorldErrorCode.SlotsExhausted })
    await assert.rejects(provisionSlots(2, async (slot) => { if (slot === 2) throw worldError(TestWorldErrorCode.InfrastructureFailed, "docker"); return slot }, () => undefined), { code: TestWorldErrorCode.InfrastructureFailed })
    assert.equal(isSlotsExhausted({ cause: { code: TestWorldErrorCode.SlotsExhausted } }), true)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, eachInOrder } from "./index.ts"

class SequenceError extends DomainError<"STEP_FAILED"> {}

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test("a step starts only after the one before it settled, in item order", async () => {
    const events: string[] = []
    await eachInOrder(new Set(["a", "b", "c"]), async (item, index) => {
        events.push(`start ${item} ${String(index)}`)
        await pause()
        events.push(`end ${item}`)
    })
    assert.deepEqual(events, ["start a 0", "end a", "start b 1", "end b", "start c 2", "end c"])
})

test("an empty list answers nothing", async () => {
    await assert.doesNotReject(eachInOrder([], () => Promise.resolve()))
})

test("the first failure rejects the answer and the items after it never start", async () => {
    const started: number[] = []
    const run = eachInOrder([1, 2, 3], async (item) => {
        started.push(item)
        await pause()
        if (item === 2) throw new SequenceError({ code: "STEP_FAILED" })
    })
    await assert.rejects(run, /STEP_FAILED/)
    assert.deepEqual(started, [1, 2])
})

test("a step that throws before it returns a promise rejects the answer", async () => {
    const run = eachInOrder([1], (): Promise<void> => {
        throw new SequenceError({ code: "STEP_FAILED" })
    })
    await assert.rejects(run, /STEP_FAILED/)
})

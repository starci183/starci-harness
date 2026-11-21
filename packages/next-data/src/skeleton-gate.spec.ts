import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import useSWR, { SWRConfig } from "swr"
import type { Cache } from "swr"
import { createSkeletonGate, skeletonGate, useSkeletonGate } from "./skeleton-gate.ts"
import type { SkeletonGatedResponse } from "./skeleton-gate.ts"

/** A clock and timer queue that move only on `advance`, recording each show and hide with its time. */
const fakeClock = () => {
    let time = 0
    let nextId = 0
    const timers = new Map<number, { readonly at: number; readonly callback: () => void }>()
    const changes: (readonly [number, boolean])[] = []
    const advanceTo = (target: number): void => {
        for (;;) {
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
            if (due === undefined) break
            timers.delete(due[0])
            time = due[1].at
            due[1].callback()
        }
        time = target
    }
    return {
        changes,
        pending: () => timers.size,
        at: advanceTo,
        options: {
            now: () => time,
            setTimer: (callback: () => void, ms: number): unknown => {
                nextId += 1
                timers.set(nextId, { at: time + ms, callback })
                return nextId
            },
            clearTimer: (handle: unknown): void => {
                timers.delete(handle as number)
            },
            onChange: (visible: boolean): void => {
                changes.push([time, visible])
            },
        },
    }
}

/** Runs a load from 0 to `endMs` on the default timing (250 delay, 500 hold) and returns the shows and hides. */
const load = (endMs: number): readonly (readonly [number, boolean])[] => {
    const clock = fakeClock()
    const gate = createSkeletonGate(clock.options)
    gate.update(true)
    clock.at(endMs)
    gate.update(false)
    clock.at(endMs + 5000)
    assert.equal(gate.visible(), false)
    assert.equal(clock.pending(), 0)
    return clock.changes
}

describe("createSkeletonGate", () => {
    it("never shows a load of 100ms", () => {
        assert.deepEqual(load(100), [])
    })

    it("shows a load of 300ms at 250 and holds it to 750", () => {
        assert.deepEqual(load(300), [[250, true], [750, false]])
    })

    it("shows a load of 2000ms at 250 and hides it at 2000", () => {
        assert.deepEqual(load(2000), [[250, true], [2000, false]])
    })

    it("does not flicker when loading starts again while the skeleton is held", () => {
        const clock = fakeClock()
        const gate = createSkeletonGate(clock.options)
        gate.update(true)
        clock.at(300)
        gate.update(false)
        clock.at(500)
        gate.update(true)
        clock.at(900)
        assert.equal(gate.visible(), true, "the hold ended at 750, but the new load keeps it up")
        gate.update(false)
        clock.at(5000)
        assert.deepEqual(clock.changes, [[250, true], [900, false]])
    })

    it("ignores a repeated flag, takes its own timing, and dispose clears a waiting timer", () => {
        const clock = fakeClock()
        const gate = createSkeletonGate({ ...clock.options, delayMs: 10, minMs: 20 })
        gate.update(false)
        gate.update(true)
        gate.update(true)
        assert.equal(clock.pending(), 1)
        clock.at(15)
        assert.equal(gate.visible(), true)
        gate.update(false)
        clock.at(40)
        assert.deepEqual(clock.changes, [[10, true], [30, false]])
        gate.update(true)
        gate.dispose()
        gate.dispose()
        assert.equal(clock.pending(), 0)
    })

    it("runs on the real clock by default", async () => {
        const seen: boolean[] = []
        const gate = createSkeletonGate({ delayMs: 5, minMs: 5, onChange: (visible) => { seen.push(visible) } })
        gate.update(true)
        await new Promise((resolve) => setTimeout(resolve, 20))
        gate.update(false)
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.deepEqual(seen, [true, false])
        gate.update(true)
        gate.dispose()
        assert.equal(createSkeletonGate().visible(), false)
    })
})

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = (ms: number): Promise<void> => act(() => wait(ms))

const dom = new JSDOM("<!doctype html><div id=\"root\"></div>")
const globals = globalThis as unknown as Record<string, unknown>
const previous: Record<string, unknown> = {}
const borrowed = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]

before(() => {
    for (const name of borrowed) previous[name] = globals[name]
    const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
    for (const name of borrowed) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true })
})

after(() => {
    for (const name of borrowed) {
        if (previous[name] === undefined) Reflect.deleteProperty(globalThis, name)
        else Object.defineProperty(globalThis, name, { value: previous[name], configurable: true })
    }
    dom.window.close()
})

/** Renders `element` into a fresh root, inside `act`. */
const render = async (root: Root, element: Parameters<Root["render"]>[0]): Promise<void> => {
    await act(() => {
        root.render(element)
        return Promise.resolve()
    })
}

describe("useSkeletonGate", () => {
    it("gates the flag of a component: a long load shows after the delay and holds", async () => {
        let shown = false
        const Probe = (props: { readonly loading: boolean; readonly delayMs: number }): null => {
            shown = useSkeletonGate(props.loading, props.delayMs, 80)
            return null
        }
        const root = createRoot(dom.window.document.createElement("div"))
        await render(root, createElement(Probe, { loading: true, delayMs: 30 }))
        assert.equal(shown, false)
        await settle(50)
        assert.equal(shown, true, "shown once the load passed the delay")
        await render(root, createElement(Probe, { loading: false, delayMs: 30 }))
        assert.equal(shown, true, "held for its minimum")
        await settle(100)
        assert.equal(shown, false)
        await render(root, createElement(Probe, { loading: true, delayMs: 30 }))
        await render(root, createElement(Probe, { loading: true, delayMs: 40 }))
        assert.equal(shown, false, "a new timing starts a new gate")
        await settle(60)
        assert.equal(shown, true)
        await act(() => {
            root.unmount()
            return Promise.resolve()
        })
    })

    it("keeps the defaults of 250 and 500", async () => {
        let shown = true
        const Probe = (): null => {
            shown = useSkeletonGate(true)
            return null
        }
        const root = createRoot(dom.window.document.createElement("div"))
        await render(root, createElement(Probe))
        await settle(100)
        assert.equal(shown, false)
        await act(() => {
            root.unmount()
            return Promise.resolve()
        })
    })
})

describe("skeletonGate", () => {
    /** Mounts a read whose fetch takes `fetchMs` under `skeletonGate`, recording each `showSkeleton` it renders. */
    const mount = async (key: string, fetchMs: number): Promise<{ readonly seen: boolean[]; readonly data: () => unknown; readonly unmount: () => Promise<void> }> => {
        const seen: boolean[] = []
        let data: unknown
        const Probe = (): null => {
            const read = useSWR(key, () => wait(fetchMs).then(() => key)) as SkeletonGatedResponse<string>
            if (seen.at(-1) !== read.showSkeleton) seen.push(read.showSkeleton)
            data = read.data
            return null
        }
        const root = createRoot(dom.window.document.createElement("div"))
        const value = { use: [skeletonGate({ delayMs: 30, minMs: 80 })], provider: (): Cache => new Map() }
        await render(root, createElement(SWRConfig, { value }, createElement(Probe)))
        return {
            seen,
            data: () => data,
            unmount: () => act(() => {
                root.unmount()
                return Promise.resolve()
            }),
        }
    }

    it("never shows the skeleton of a quick read", async () => {
        const run = await mount("quick", 5)
        await settle(150)
        assert.equal(run.data(), "quick")
        assert.deepEqual(run.seen, [false])
        await run.unmount()
    })

    it("shows the skeleton of a slow read, then hides it once loaded and held", async () => {
        const run = await mount("slow", 120)
        await settle(60)
        assert.deepEqual(run.seen, [false, true])
        await settle(200)
        assert.equal(run.data(), "slow")
        assert.deepEqual(run.seen, [false, true, false])
        await run.unmount()
    })

    it("works with no timing given", () => {
        assert.equal(typeof skeletonGate(), "function")
    })
})

import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import useSWR, { SWRConfig } from "swr"
import type { Cache } from "swr"
import { pollingRestart, shouldRestartPolling } from "./polling.ts"

/** What the probe component reads: how many fetches ran and the data it shows. */
interface Run {
    readonly fetches: () => number
    readonly data: () => number | undefined
    readonly refresh: () => Promise<unknown>
    readonly unmount: () => Promise<void>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Lets pending timers and effects settle for `ms`, inside `act`. */
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

/**
 * Mounts a read whose data is a counter that `answers` maps to a refresh interval. With `middleware` the app's `SWRConfig` lists
 * `pollingRestart`; without it the read runs on plain SWR.
 */
const mount = async (options: {
    readonly interval: number | ((data: unknown) => number) | undefined
    readonly middleware: boolean
    readonly keyed?: string
}): Promise<Run> => {
    let fetches = 0
    let shown: number | undefined
    let refresh: () => Promise<unknown> = () => Promise.resolve(undefined)
    const Probe = (): null => {
        const read = useSWR(
            options.keyed ?? "polling-probe",
            () => {
                fetches += 1
                return Promise.resolve(fetches)
            },
            { ...(options.interval === undefined ? {} : { refreshInterval: options.interval }), dedupingInterval: 0, revalidateOnFocus: false },
        )
        shown = read.data
        refresh = () => read.mutate()
        return null
    }
    const host = dom.window.document.createElement("div")
    const root: Root = createRoot(host)
    const value = { use: options.middleware ? [pollingRestart] : [], provider: (): Cache => new Map() }
    await act(() => {
        root.render(createElement(SWRConfig, { value }, createElement(Probe)))
        return Promise.resolve()
    })
    return {
        fetches: () => fetches,
        data: () => shown,
        refresh: () => act(() => refresh()),
        unmount: () => act(() => {
            root.unmount()
            return Promise.resolve()
        }),
    }
}

describe("shouldRestartPolling", () => {
    it("restarts only a stopped chain that now answers above zero", () => {
        assert.equal(shouldRestartPolling(true, 4000), true)
        assert.equal(shouldRestartPolling(true, 0), false)
        assert.equal(shouldRestartPolling(false, 4000), false)
        assert.equal(shouldRestartPolling(false, 0), false)
    })
})

describe("pollingRestart", () => {
    it("polls again after the interval function answered 0 and newer data makes it answer above 0", async () => {
        // Idle on the first read (stop), busy from the second on: only a restart can reach the second read by itself.
        const busyAfterRefresh = (data: unknown): number => (typeof data === "number" && data >= 2 ? 20 : 0)

        const plain = await mount({ interval: busyAfterRefresh, middleware: false, keyed: "plain" })
        await settle(120)
        assert.equal(plain.fetches(), 1, "plain SWR never wakes a chain that stopped")
        await plain.refresh()
        await settle(150)
        assert.equal(plain.fetches() > 2, false, "plain SWR schedules nothing after a manual refresh either")
        await plain.unmount()

        const restarted = await mount({ interval: busyAfterRefresh, middleware: true, keyed: "restarted" })
        await settle(80)
        assert.equal(restarted.fetches(), 1, "the idle read does not poll")
        await restarted.refresh()
        await settle(200)
        assert.ok(restarted.fetches() >= 4, `the read polls again once its data turns busy (ran ${String(restarted.fetches())})`)
        await restarted.unmount()
    })

    it("stops again when the interval function answers 0 for newer data", async () => {
        const busyUntilThree = (data: unknown): number => (typeof data === "number" && data < 3 ? 20 : 0)
        const run = await mount({ interval: busyUntilThree, middleware: true, keyed: "settles" })
        await settle(300)
        const settled = run.fetches()
        assert.equal(settled, 3)
        await settle(150)
        assert.equal(run.fetches(), settled, "a settled read stays quiet")
        await run.unmount()
    })

    it("passes a numeric or absent interval through untouched", async () => {
        const numeric = await mount({ interval: 25, middleware: true, keyed: "numeric" })
        await settle(160)
        assert.ok(numeric.fetches() >= 3)
        await numeric.unmount()

        const absent = await mount({ interval: undefined, middleware: true, keyed: "absent" })
        await settle(120)
        assert.equal(absent.fetches(), 1)
        assert.equal(absent.data(), 1)
        await absent.unmount()
    })
})

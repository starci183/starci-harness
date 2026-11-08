import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { EffectOnMount } from "./react.ts"

const dom = new JSDOM("<!doctype html><div id=\"root\"></div>")
const globals = globalThis as unknown as Record<string, unknown>
const borrowed = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

before(() => {
    let frame = 0
    Object.assign(dom.window, {
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: () => (frame += 1),
        cancelAnimationFrame: () => undefined,
    })
    const noop = (): undefined => undefined
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", { value: () => ({ setTransform: noop, clearRect: noop }) })
    const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
    for (const name of borrowed) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true })
})

after(() => {
    for (const name of borrowed) Reflect.deleteProperty(globals, name)
    dom.window.close()
})

const canvas = (): Element | null => dom.window.document.querySelector("canvas[data-starci-visual-effect=confetti]")

describe("EffectOnMount", () => {
    it("fires once after its delay, draws nothing in the tree, and clears the canvas on unmount", async () => {
        const container = dom.window.document.getElementById("root")
        assert.ok(container !== null)
        const root = createRoot(container)
        await act(async () => {
            root.render(createElement(EffectOnMount, { effect: "confetti", delayMs: 5 }))
            await wait(0)
        })
        assert.equal(container.innerHTML, "")
        assert.equal(canvas(), null)
        await act(() => wait(20))
        assert.notEqual(canvas(), null)
        await act(async () => {
            root.unmount()
            await wait(0)
        })
        assert.equal(canvas(), null)
    })

    it("clears a shot that has not fired yet", async () => {
        const container = dom.window.document.getElementById("root")
        assert.ok(container !== null)
        const root = createRoot(container)
        await act(async () => {
            root.render(createElement(EffectOnMount, { effect: "confetti", preset: "burst" }))
            await wait(0)
        })
        await act(async () => {
            root.unmount()
            await wait(300)
        })
        assert.equal(canvas(), null)
    })
})

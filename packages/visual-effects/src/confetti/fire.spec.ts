import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { pageHost } from "../core/overlay.ts"
import type { EffectHost } from "../core/overlay.ts"
import { FALLBACK_COLORS, themeColors } from "../core/palette.ts"
import { fireConfetti } from "./fire.ts"
import { seeded } from "./physics.spec.ts"

/** The drawing calls a spec counts. */
interface Calls {
    rects: number
    arcs: number
    fills: string[]
}

/** A 2D context that records what it is asked to draw. */
const recordingContext = (calls: Calls): CanvasRenderingContext2D => {
    let fillStyle = ""
    const context = {
        save: () => undefined,
        restore: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        beginPath: () => undefined,
        fill: () => undefined,
        arc: () => {
            calls.arcs += 1
        },
        fillRect: () => {
            calls.rects += 1
            calls.fills.push(fillStyle)
        },
        globalAlpha: 1,
        get fillStyle() {
            return fillStyle
        },
        set fillStyle(value: string) {
            fillStyle = value
        },
    }
    return context as unknown as CanvasRenderingContext2D
}

/** A page with a manual frame clock: `tick` runs the queued frame at `now`. */
interface Stage {
    readonly host: EffectHost
    readonly document: Document
    readonly calls: Calls
    readonly tick: (now: number) => boolean
}

const stage = (options: { reducedMotion?: boolean; noContext?: boolean; css?: string } = {}): Stage => {
    const dom = new JSDOM(`<!doctype html><html><head><style>${options.css ?? ""}</style></head><body></body></html>`)
    const document = dom.window.document
    const calls: Calls = { rects: 0, arcs: 0, fills: [] }
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: () => (options.noContext === true ? null : recordingContext(calls)),
    })
    let queued: ((now: number) => void) | null = null
    const host: EffectHost = {
        document,
        viewport: () => ({ width: 1000, height: 800 }),
        pixelRatio: () => 2,
        prefersReducedMotion: () => options.reducedMotion === true,
        requestFrame: (step) => {
            queued = step
            return 1
        },
        cancelFrame: () => {
            queued = null
        },
        random: seeded(7),
    }
    const tick = (now: number): boolean => {
        const step = queued
        if (step === null) return false
        queued = null
        step(now)
        return true
    }
    return { host, document, calls, tick }
}

const canvasOf = (document: Document): Element | null => document.querySelector("canvas[data-starci-visual-effect=confetti]")

describe("fireConfetti", () => {
    it("draws on a hidden canvas over the page and removes it when the last piece is gone", async () => {
        const { host, document, calls, tick } = stage()
        const handle = fireConfetti({ preset: "burst", colors: ["#111111"] }, host)
        const canvas = canvasOf(document)
        assert.ok(canvas !== null)
        assert.equal(canvas.getAttribute("aria-hidden"), "true")
        assert.match(canvas.getAttribute("style") ?? "", /pointer-events:none/)
        let now = 0
        let frames = 0
        while (tick(now)) {
            now += 1000 / 60
            frames += 1
        }
        await handle.done
        assert.ok(frames > 60, "it flies for more than a second")
        assert.ok(calls.rects > 0 && calls.arcs > 0)
        assert.ok(calls.fills.every((fill) => fill === "#111111"))
        assert.equal(canvasOf(document), null)
    })

    it("stops at once and takes the canvas away", async () => {
        const { host, document, tick } = stage()
        const handle = fireConfetti({}, host)
        tick(0)
        handle.stop()
        await handle.done
        assert.equal(canvasOf(document), null)
        assert.equal(tick(16), false)
    })

    it("fires the caller's own bursts in the theme's colours", () => {
        const { host, calls, tick } = stage({ css: ":root { --accent: #e11d48; --success: #16a34a; }" })
        fireConfetti({ bursts: [{ origin: { x: 0.5, y: 0.5 }, angle: 90, spread: 30, count: 30, velocity: 600 }] }, host)
        tick(0)
        assert.ok(calls.fills.length > 0)
        assert.ok(calls.fills.every((fill) => fill === "#e11d48" || fill === "#16a34a"))
    })

    it("draws nothing for a reader who asked for reduced motion, unless told to ignore it", async () => {
        const quiet = stage({ reducedMotion: true })
        await fireConfetti({}, quiet.host).done
        assert.equal(canvasOf(quiet.document), null)
        const loud = stage({ reducedMotion: true })
        fireConfetti({ ignoreReducedMotion: true }, loud.host)
        assert.notEqual(canvasOf(loud.document), null)
    })

    it("does nothing without a page or a 2D context", async () => {
        await fireConfetti({}, null).done
        const blind = stage({ noContext: true })
        fireConfetti({}, blind.host).stop()
        assert.equal(canvasOf(blind.document), null)
    })
})

describe("pageHost", () => {
    it("has no host on the server", () => {
        assert.equal(pageHost(), null)
    })

    it("reads the window when there is one", () => {
        const dom = new JSDOM("<!doctype html><body></body>")
        const globals = globalThis as unknown as Record<string, unknown>
        const frames: number[] = []
        Object.assign(dom.window, {
            matchMedia: () => ({ matches: true }),
            requestAnimationFrame: () => 9,
            cancelAnimationFrame: (handle: number) => frames.push(handle),
            devicePixelRatio: 3,
        })
        globals.window = dom.window
        globals.document = dom.window.document
        try {
            const host = pageHost()
            assert.ok(host !== null)
            assert.equal(host.pixelRatio(), 2)
            assert.equal(host.prefersReducedMotion(), true)
            assert.equal(host.requestFrame(() => undefined), 9)
            host.cancelFrame(9)
            assert.deepEqual(frames, [9])
            assert.equal(host.viewport().width, dom.window.innerWidth)
        } finally {
            Reflect.deleteProperty(globalThis, "window")
            Reflect.deleteProperty(globalThis, "document")
            dom.window.close()
        }
    })
})

describe("themeColors", () => {
    it("falls back when the page sets no Grammar token", () => {
        assert.deepEqual(themeColors(() => ""), FALLBACK_COLORS)
        assert.deepEqual(themeColors((name) => (name === "--accent" ? " #e11d48 " : "")), ["#e11d48"])
    })
})

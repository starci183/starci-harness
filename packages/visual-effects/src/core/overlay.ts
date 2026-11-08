/** A random source in [0, 1); the browser passes `Math.random`, a spec passes a seeded one. */
export type Random = () => number

/** The viewport an effect plays in, in CSS pixels. */
export interface Viewport {
    readonly width: number
    readonly height: number
}

/** The browser surface every effect needs; `pageHost` reads it from the page, a spec hands in its own. */
export interface EffectHost {
    readonly document: Document
    readonly viewport: () => Viewport
    readonly pixelRatio: () => number
    readonly prefersReducedMotion: () => boolean
    readonly requestFrame: (step: (now: number) => void) => number
    readonly cancelFrame: (handle: number) => void
    readonly random: Random
}

/**
 * One effect as the overlay runs it: it advances by a time step, draws itself on the overlay's 2D context, and says when it
 * has nothing left to show. Every effect of this package (confetti first) is one of these.
 */
export interface EffectSystem {
    readonly advance: (seconds: number, viewport: Viewport) => void
    readonly draw: (context: CanvasRenderingContext2D) => void
    readonly isFinished: () => boolean
}

/** An effect in flight: `done` settles when it finished and its canvas is gone; `stop` ends it at once. */
export interface EffectHandle {
    readonly done: Promise<void>
    readonly stop: () => void
}

/** What every effect call takes besides its own options. */
export interface EffectOptions {
    /** Play even when the reader asked the system for reduced motion (default false: then nothing is drawn). */
    readonly ignoreReducedMotion?: boolean
}

/** The longest frame step an effect takes, so a tab that slept does not jump every particle to its end at once. */
const MAX_STEP_SECONDS = 1 / 20

/** The overlay sits over everything, takes no pointer and is hidden from assistive technology. */
const OVERLAY_STYLE =
    "position:fixed;inset:0;inline-size:100vw;block-size:100dvh;pointer-events:none;z-index:2147483646"

/** A handle with nothing in flight. */
export const settledEffect = (): EffectHandle => ({ done: Promise.resolve(), stop: () => undefined })

/** The page's own host: the window's frame clock, size, pixel ratio and motion preference; null on the server. */
export const pageHost = (): EffectHost | null => {
    if (typeof window === "undefined" || typeof document === "undefined") return null
    return {
        document,
        viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
        pixelRatio: () => Math.min(window.devicePixelRatio || 1, 2),
        prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        requestFrame: (step) => window.requestAnimationFrame(step),
        cancelFrame: (handle) => {
            window.cancelAnimationFrame(handle)
        },
        random: Math.random,
    }
}

/** Reads one custom property of the page root's computed style ("" when unset or when there is no window). */
export const readRootToken = (host: EffectHost, name: string): string => {
    const view = host.document.defaultView
    return view === null ? "" : view.getComputedStyle(host.document.documentElement).getPropertyValue(name)
}

/**
 * Plays one effect on an overlay canvas of its own, which it removes when the effect finishes. `create` builds the system
 * once the overlay exists (it reads the viewport and theme then). Nothing is drawn without a host, without a 2D context, or
 * for a reader who asked for reduced motion (unless the options say to ignore that).
 */
export const playOverlay = (
    name: string,
    options: EffectOptions,
    host: EffectHost | null,
    create: (host: EffectHost) => EffectSystem,
): EffectHandle => {
    if (host === null) return settledEffect()
    if (options.ignoreReducedMotion !== true && host.prefersReducedMotion()) return settledEffect()
    const canvas = host.document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (context === null) return settledEffect()
    const system = create(host)
    canvas.setAttribute("aria-hidden", "true")
    canvas.setAttribute("data-starci-visual-effect", name)
    canvas.setAttribute("style", OVERLAY_STYLE)
    host.document.body.appendChild(canvas)

    let frame = 0
    let last: number | null = null
    let isOver = false
    let finish: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
        finish = resolve
    })
    const end = (): void => {
        if (isOver) return
        isOver = true
        host.cancelFrame(frame)
        canvas.remove()
        finish()
    }
    const step = (now: number): void => {
        const viewport = host.viewport()
        const ratio = host.pixelRatio()
        canvas.width = Math.round(viewport.width * ratio)
        canvas.height = Math.round(viewport.height * ratio)
        const seconds = last === null ? 0 : Math.min((now - last) / 1000, MAX_STEP_SECONDS)
        last = now
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, viewport.width, viewport.height)
        system.advance(seconds, viewport)
        system.draw(context)
        if (system.isFinished()) end()
        else frame = host.requestFrame(step)
    }
    frame = host.requestFrame(step)
    return { done, stop: end }
}

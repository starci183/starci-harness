import type { DnaBox, DnaMeasurement, DnaSample } from "../../harness/dna.js"

/*
 * The page side of `starci dna check`: a self-contained function the browser runs (its source is sent over the DevTools protocol),
 * so it names nothing outside its own body. The CLI is compiled without the DOM library; the few DOM members it reads are typed
 * here, structurally.
 */

interface Box {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
    readonly width: number
    readonly height: number
}

interface Style {
    getPropertyValue: (property: string) => string
    readonly paddingLeft: string
    readonly paddingRight: string
    readonly borderTopWidth: string
    readonly borderRightWidth: string
    readonly borderBottomWidth: string
    readonly borderLeftWidth: string
}

interface PageElement {
    readonly tagName: string
    readonly id: string
    readonly parentElement: PageElement | null
    readonly children: ArrayLike<PageElement>
    readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>
    readonly style: { setProperty: (property: string, value: string) => void }
    getAttribute: (name: string) => string | null
    getBoundingClientRect: () => Box
    getClientRects: () => ArrayLike<Box>
    closest: (selector: string) => PageElement | null
    matches: (selector: string) => boolean
    contains: (other: PageElement) => boolean
    querySelectorAll: (selector: string) => ArrayLike<PageElement>
    appendChild: (child: PageElement) => PageElement
    remove: () => void
}

interface PageDocument {
    querySelectorAll: (selector: string) => ArrayLike<PageElement>
    createElement: (tag: string) => PageElement
}

interface PageWindow {
    readonly document: PageDocument
    getComputedStyle: (element: PageElement) => Style
}

/** One measured law the page evaluates, keyed by its id. */
export interface PageLaw {
    readonly id: string
    readonly measure: DnaMeasurement
}

/** What the page is asked: the attribute that marks a Grammar root and the laws per family. */
export interface PageInput {
    readonly rootAttribute: string
    readonly laws: Readonly<Record<string, readonly PageLaw[]>>
}

/** The samples of one law under one Grammar root. */
export interface PageLawResult {
    readonly id: string
    readonly samples: readonly DnaSample[]
    readonly error?: string
}

/** One Grammar root the page found, with what every law of its family measured there. */
export interface PageRootResult {
    readonly family: string
    readonly path: string
    readonly laws: readonly PageLawResult[]
}

/** Everything the page measured. */
export interface PageResult {
    readonly roots: readonly PageRootResult[]
}

/**
 * Runs in the page: waits until a Grammar root is in the document (a Storybook story or a client app renders after load), or the
 * time is up, then for web fonts and two frames, so the layout measured is the settled one. True when a root appeared.
 */
export const settlePage = async (input: { readonly rootAttribute: string; readonly waitMs: number }): Promise<boolean> => {
    const view = globalThis as unknown as PageWindow & {
        readonly document: PageDocument & { readonly fonts: { readonly ready: Promise<unknown> } }
        requestAnimationFrame: (callback: () => void) => number
        setTimeout: (callback: () => void, ms: number) => number
    }
    const deadline = Date.now() + input.waitMs
    const present = (): boolean => view.document.querySelectorAll(`[${input.rootAttribute}]`).length > 0
    // Polls every 50ms, one tick after the other, until the root is in the document or the time is up.
    const poll = async (): Promise<void> => {
        if (present() || Date.now() >= deadline) return
        await new Promise<void>((done) => view.setTimeout(done, 50))
        await poll()
    }
    const frame = (): Promise<void> => new Promise<void>((done) => view.requestAnimationFrame(done))
    await poll()
    await view.document.fonts.ready
    await frame()
    await frame()
    return present()
}

/** How a rendered story declares its place in a skeleton pair: `parameters.dna` ({ pair, phase }) and its `shape` arg. */
export interface StoryPairing {
    readonly id: string
    readonly pair: string | null
    readonly phase: string | null
    readonly shape: string | null
}

/**
 * Runs in a Storybook iframe after the story rendered: reads the current story's id, `parameters.dna.pair`, `parameters.dna.phase`
 * and its `shape` arg (the live args when the preview exposes them, else the story's initial args). Null outside a Storybook.
 */
export const readStoryPairing = (): StoryPairing | null => {
    interface Story {
        readonly id?: string
        readonly parameters?: { readonly dna?: { readonly pair?: unknown; readonly phase?: unknown } }
        readonly initialArgs?: Readonly<Record<string, unknown>>
    }
    interface Preview {
        readonly currentRender?: { readonly story?: Story }
        readonly storyStore?: { readonly args?: { get?: (id: string) => Readonly<Record<string, unknown>> | undefined } }
    }
    const preview = (globalThis as unknown as { readonly __STORYBOOK_PREVIEW__?: Preview }).__STORYBOOK_PREVIEW__
    const story = preview?.currentRender?.story
    if (story?.id === undefined) return null
    const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)
    const args = preview?.storyStore?.args?.get?.(story.id) ?? story.initialArgs ?? {}
    return { id: story.id, pair: text(story.parameters?.dna?.pair), phase: text(story.parameters?.dna?.phase), shape: text(args.shape) }
}

/** Runs in the page: finds every Grammar root and measures each law of its family on every element it selects. */
export const measurePage = (input: PageInput): PageResult => {
    const view = globalThis as unknown as PageWindow
    const doc = view.document
    const rootSelector = `[${input.rootAttribute}]`
    const px = (value: string): number => Number.parseFloat(value) || 0
    const list = (items: ArrayLike<PageElement>): PageElement[] => Array.from(items)

    // A marker attribute as a selector: bare when it is a flag (empty or "true"), else with its value.
    const markerSelector = (marker: { readonly name: string; readonly value: string } | undefined): string => {
        if (marker === undefined) return ""
        return marker.value === "" || marker.value === "true" ? `[${marker.name}]` : `[${marker.name}="${marker.value}"]`
    }
    const step = (element: PageElement): string => {
        const tag = element.tagName.toLowerCase()
        if (element.id !== "") return `${tag}#${element.id}`
        const marker = Array.from(element.attributes).find((attribute) => attribute.name.startsWith("data-grammar-") || attribute.name === "data-component" || attribute.name === "data-slot" || attribute.name === "data-case")
        const parent = element.parentElement
        const twins = parent === null ? [] : list(parent.children).filter((child) => child.tagName === element.tagName)
        const nth = twins.length > 1 ? `:nth-of-type(${String(twins.indexOf(element) + 1)})` : ""
        return `${tag}${markerSelector(marker)}${nth}`
    }
    const pathOf = (element: PageElement): string => {
        const steps: string[] = []
        let at: PageElement | null = element
        while (at !== null && steps.length < 12) {
            steps.unshift(step(at))
            if (at.tagName.toLowerCase() === "body") break
            at = at.parentElement
        }
        return steps.join(" > ")
    }
    const visible = (element: PageElement): boolean => element.getClientRects().length > 0
    const paddingBox = (element: PageElement): Box => {
        const box = element.getBoundingClientRect()
        const style = view.getComputedStyle(element)
        const top = box.top + px(style.borderTopWidth)
        const right = box.right - px(style.borderRightWidth)
        const bottom = box.bottom - px(style.borderBottomWidth)
        const left = box.left + px(style.borderLeftWidth)
        return { top, right, bottom, left, width: right - left, height: bottom - top }
    }
    const overlaps = (a: Box, b: Box): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
    const resolveVar = (element: PageElement, property: string, name: string): string => {
        const probe = doc.createElement("span")
        probe.style.setProperty("position", "absolute")
        probe.style.setProperty("visibility", "hidden")
        probe.style.setProperty(property, `var(${name})`)
        const host = element.parentElement ?? element
        host.appendChild(probe)
        const value = view.getComputedStyle(probe).getPropertyValue(property)
        probe.remove()
        return value
    }

    const round = (value: number): number => Math.round(value * 100) / 100
    // The widest distance from the element to the padding box of its nearest `ref` ancestor, over the edges measured.
    const insetOf = (element: PageElement, ref: string, edges: readonly string[]): number | null => {
        const owner = element.parentElement?.closest(ref) ?? null
        if (owner === null) return null
        const inner = paddingBox(owner)
        const box = element.getBoundingClientRect()
        const distance: Record<string, number> = { top: box.top - inner.top, right: inner.right - box.right, bottom: inner.bottom - box.bottom, left: box.left - inner.left }
        return round(Math.max(...edges.map((edge) => Math.abs(distance[edge] ?? 0))))
    }
    // How many `ref` elements enclose the element, up to and including its Grammar root.
    const ancestorsOf = (element: PageElement, root: PageElement, ref: string): number => {
        let count = 0
        let at = element.parentElement
        while (at !== null && at !== root) {
            if (at.matches(ref)) count += 1
            at = at.parentElement
        }
        if (at === root && root.matches(ref)) count += 1
        return count
    }
    // The element's box and the box of every visible leaf under it that matches `leafSelector`, keyed by child position.
    const unitBoxes = (element: PageElement, path: string, leafSelector: string): DnaBox[] => {
        const boxOf = (item: PageElement, key: string, at: string): DnaBox => {
            const box = item.getBoundingClientRect()
            return { key, path: at, x: round(box.left), y: round(box.top), width: round(box.width), height: round(box.height) }
        }
        const boxes: DnaBox[] = [boxOf(element, "", path)]
        const walk = (parent: PageElement, key: string, at: string): void => {
            list(parent.children).forEach((child, index) => {
                const childKey = `${key}/${String(index + 1)}`
                const childPath = `${at} > ${step(child)}`
                if (child.children.length === 0) {
                    if (child.matches(leafSelector) && visible(child)) boxes.push(boxOf(child, childKey, childPath))
                } else walk(child, childKey, childPath)
            })
        }
        walk(element, "", path)
        return boxes
    }
    // The element's width as a share of the content width of its nearest `ref` ancestor.
    const shareOf = (element: PageElement, ref: string): number | null => {
        const owner = element.parentElement?.closest(ref) ?? null
        if (owner === null) return null
        const style = view.getComputedStyle(owner)
        const content = paddingBox(owner).width - px(style.paddingLeft) - px(style.paddingRight)
        return content > 0 ? Math.round((element.getBoundingClientRect().width / content) * 1000) / 1000 : null
    }

    const sampleOf = (element: PageElement, root: PageElement, measure: DnaMeasurement): DnaSample => {
        const path = pathOf(element)
        const ref = measure.ref ?? ""
        switch (measure.metric) {
            case "height":
                return { path, measured: round(element.getBoundingClientRect().height) }
            case "width":
                return { path, measured: round(element.getBoundingClientRect().width) }
            case "css": {
                const property = measure.property ?? ""
                const measured = view.getComputedStyle(element).getPropertyValue(property)
                return measure.expected.var === undefined ? { path, measured } : { path, measured, resolvedVar: resolveVar(element, property, measure.expected.var) }
            }
            case "attribute":
                return { path, measured: element.getAttribute(measure.property ?? "") }
            case "inset":
                return { path, measured: insetOf(element, ref, measure.edges ?? ["left", "right"]) }
            case "outside": {
                const scope = (measure.scope === undefined ? null : element.closest(measure.scope)) ?? root
                const box = element.getBoundingClientRect()
                const inside = list(scope.querySelectorAll(ref)).some((other) => other !== element && !element.contains(other) && (other.contains(element) || overlaps(other.getBoundingClientRect(), box)))
                return { path, measured: !inside }
            }
            case "ancestors":
                return { path, measured: ancestorsOf(element, root, ref) }
            case "skeleton-parity":
                return { path, measured: null, boxes: unitBoxes(element, path, measure.leaf ?? "*") }
            case "share":
                return { path, measured: shareOf(element, ref) }
        }
    }

    const roots = list(doc.querySelectorAll(rootSelector))
    return {
        roots: roots.map((root) => {
            const family = root.getAttribute(input.rootAttribute) ?? ""
            const laws = (input.laws[family] ?? []).map((law): PageLawResult => {
                try {
                    const elements = list(root.querySelectorAll(law.measure.selector)).filter((element) => element.closest(rootSelector) === root && visible(element))
                    return { id: law.id, samples: elements.map((element) => sampleOf(element, root, law.measure)) }
                } catch (error: unknown) {
                    return { id: law.id, samples: [], error: error instanceof Error ? error.message : String(error) }
                }
            })
            return { family, path: pathOf(root), laws }
        }),
    }
}

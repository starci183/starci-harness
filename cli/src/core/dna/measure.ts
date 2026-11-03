/// <reference lib="dom" />
import type { DnaBreak, DnaPart, DnaScalar, DnaVariant, DnaValue, DnaWhere } from "../../harness/dna.js"

/*
 * The page side of `starci dna check`: a self-contained function the browser runs (its source is sent over the DevTools protocol),
 * so it names nothing outside its own body; the judge it applies to every sample (harness/dna.ts judgePart) is handed in as a
 * parameter for the same reason. It installs `window.__dna`, which the driver (check.ts) calls:
 *
 *   begin   the Grammar roots of the page and the facts the story declares (`parameters.dna.fixture`)
 *   run     every static variant: the sample of each element, judged here so a page sends back only what broke
 *   locate  the matches of a dynamic variant (an interaction, or a `context.state`), scrolled into view, with their centre
 *   before  the pre-act facts of one match (the `{ before }` value, the focus-ring baseline, the navigation marker)
 *   after   the sample of one match once the driver has acted on it
 *
 * The CLI is compiled with the DOM library for this file's types only; nothing here runs in Node.
 */

/** What a report says when the thing an act should have produced never appeared. */
export const NOTHING_MATCHED = "nothing matched"

/** A variant with the index the driver refers to it by. */
export interface PageVariant {
    readonly index: number
    readonly variant: DnaVariant
}

/** What the page says about one variant on one page: how many matches and samples it judged, and the samples that broke it. */
export interface PageReport {
    readonly index: number
    /** Elements (or scopes) the variant's select reached. */
    readonly matched: number
    /** Samples judged: a match the page could measure. */
    readonly evaluated: number
    /** Why a match was not measured (a reference the page lacks, a fact the story does not declare), distinct reasons. */
    readonly skipped: readonly string[]
    readonly brokenCount: number
    /** The first samples that broke the law. */
    readonly broken: readonly { readonly path: string; readonly breaks: readonly DnaBreak[] }[]
    readonly error?: string
}

/** One match of a dynamic variant: where it is and where to put the pointer. */
export interface PageTarget {
    readonly path: string
    readonly x: number
    readonly y: number
}

/** What the page needs to know before it measures. */
export interface PageBegin {
    readonly rootAttribute: string
    readonly family: string
    readonly maxBroken: number
}

/** The probe the page installs. */
export interface DnaProbe {
    begin: (input: PageBegin) => { readonly roots: number; readonly anyRoot: number; readonly fixture: Readonly<Record<string, DnaScalar>>; readonly story: string; readonly followUp: string | null }
    run: (variants: readonly PageVariant[]) => PageReport[]
    locate: (variant: PageVariant) => PageTarget[]
    before: (variant: PageVariant, target: number) => void
    after: (variant: PageVariant, target: number) => PageReport
    focus: (variant: PageVariant, target: number) => void
    blur: () => void
    reset: () => void
}

declare global {
    interface Window {
        __dna?: DnaProbe
        __dnaNavigation?: number
    }
}

type Judge = (part: DnaPart) => { readonly ok: boolean; readonly want: string }

/** Installs `window.__dna`. Runs in the page. */
export const installProbe = (judgePart: Judge): void => {
    const doc = document
    const state: {
        input: PageBegin
        root: Element | null
        fixture: Record<string, DnaScalar>
        targets: Map<number, Element[]>
        beforeValues: Map<string, DnaScalar[]>
        ringBaseline: Map<Element, string>
    } = { input: { rootAttribute: "data-grammar-family", family: "", maxBroken: 20 }, root: null, fixture: {}, targets: new Map(), beforeValues: new Map(), ringBaseline: new Map() }

    const rootSelector = (): string => `[${state.input.rootAttribute}="${state.input.family}"]`
    const list = <T extends Element>(items: ArrayLike<T>): T[] => Array.from(items)
    const round = (value: number): number => Math.round(value * 100) / 100
    const px = (value: string): number => Number.parseFloat(value) || 0
    const visible = (element: Element): boolean => element.getClientRects().length > 0
    const style = (element: Element, pseudo?: string | null): CSSStyleDeclaration => getComputedStyle(element, pseudo ?? null)
    const inReference = (element: Element): boolean => element.closest("[data-dna-reference]") !== null

    // ---- paths ----
    const markerOf = (element: Element): string => {
        const marker = Array.from(element.attributes).find((attribute) => attribute.name.startsWith("data-grammar-") || attribute.name === "data-component" || attribute.name === "data-slot")
        if (marker === undefined) return ""
        return marker.value === "" || marker.value === "true" ? `[${marker.name}]` : `[${marker.name}="${marker.value}"]`
    }
    const stepOf = (element: Element): string => {
        const tag = element.tagName.toLowerCase()
        if (element.id !== "") return `${tag}#${element.id}`
        const parent = element.parentElement
        const twins = parent === null ? [] : list(parent.children).filter((child) => child.tagName === element.tagName)
        const twinsSuffix = twins.length > 1 ? `:nth-of-type(${String(twins.indexOf(element) + 1)})` : ""
        return `${tag}${markerOf(element)}${twinsSuffix}`
    }
    const pathOf = (element: Element): string => {
        const steps: string[] = []
        let at: Element | null = element
        while (at !== null && steps.length < 10) {
            steps.unshift(stepOf(at))
            if (at.tagName === "BODY") break
            at = at.parentElement
        }
        return steps.join(" > ")
    }

    // ---- colours ----
    const canvas = doc.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const surface = canvas.getContext("2d", { willReadFrequently: true })
    const COLOUR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|^#[0-9a-f]{3,8}$/i
    const rgbaOf = (value: string): [number, number, number, number] | null => {
        if (surface === null) return null
        surface.clearRect(0, 0, 1, 1)
        surface.fillStyle = "#010203"
        surface.fillStyle = value
        surface.fillRect(0, 0, 1, 1)
        const data = surface.getImageData(0, 0, 1, 1).data
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, (data[3] ?? 0) / 255]
    }
    const canon = (value: DnaScalar): DnaScalar => {
        if (typeof value !== "string" || !COLOUR.test(value.trim())) return value
        const rgba = rgbaOf(value.trim())
        return rgba === null ? value : `rgba(${String(rgba[0])}, ${String(rgba[1])}, ${String(rgba[2])}, ${String(Math.round(rgba[3] * 1000) / 1000)})`
    }
    const groundOf = (element: Element): [number, number, number] => {
        const layers: [number, number, number, number][] = []
        let at: Element | null = element
        while (at !== null) {
            const rgba = rgbaOf(style(at).backgroundColor)
            if (rgba !== null && rgba[3] > 0) layers.push(rgba)
            if (rgba !== null && rgba[3] >= 0.999) break
            at = at.parentElement
        }
        let ground: [number, number, number] = [255, 255, 255]
        layers.reverse()
        for (const [r, g, b, a] of layers) ground = [r * a + ground[0] * (1 - a), g * a + ground[1] * (1 - a), b * a + ground[2] * (1 - a)]
        return ground
    }
    const luminance = (rgb: readonly [number, number, number]): number => {
        const channel = (value: number): number => {
            const unit = value / 255
            return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
    }
    const contrastOf = (element: Element): number => {
        const text = rgbaOf(style(element).color)
        if (text === null) return 0
        const ground = groundOf(element)
        const over: [number, number, number] = [text[0] * text[3] + ground[0] * (1 - text[3]), text[1] * text[3] + ground[1] * (1 - text[3]), text[2] * text[3] + ground[2] * (1 - text[3])]
        const [light, dark] = [Math.max(luminance(over), luminance(ground)), Math.min(luminance(over), luminance(ground))]
        return round((light + 0.05) / (dark + 0.05))
    }

    // ---- box shadow and transform ----
    const firstShadow = (element: Element): number[] => {
        const value = style(element).boxShadow
        if (value === "none" || value === "") return [0, 0, 0, 0]
        let depth = 0
        let end = value.length
        for (let index = 0; index < value.length; index += 1) {
            const char = value[index]
            if (char === "(") depth += 1
            else if (char === ")") depth -= 1
            else if (char === "," && depth === 0) {
                end = index
                break
            }
        }
        const layer = value.slice(0, end).replace(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/gi, "")
        const lengths = Array.from(layer.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))px/g)).map((match) => Number(match[1]))
        return [lengths[0] ?? 0, lengths[1] ?? 0, lengths[2] ?? 0, lengths[3] ?? 0]
    }
    const matrixOf = (element: Element): { scale: number; x: number; y: number } => {
        const computed = style(element)
        const numbers = (text: string): number[] => Array.from(text.matchAll(/-?\d*\.?\d+(?:e-?\d+)?/gi)).map((match) => Number(match[0]))
        let scale = 1
        let x = 0
        let y = 0
        const transform = computed.transform
        if (transform.startsWith("matrix3d(")) {
            const n = numbers(transform)
            scale = Math.hypot(n[0] ?? 1, n[1] ?? 0)
            x = n[12] ?? 0
            y = n[13] ?? 0
        } else if (transform.startsWith("matrix(")) {
            const n = numbers(transform)
            scale = Math.hypot(n[0] ?? 1, n[1] ?? 0)
            x = n[4] ?? 0
            y = n[5] ?? 0
        }
        const scaleProperty = computed.getPropertyValue("scale")
        if (scaleProperty !== "" && scaleProperty !== "none") scale *= numbers(scaleProperty)[0] ?? 1
        const translateProperty = computed.getPropertyValue("translate")
        if (translateProperty !== "" && translateProperty !== "none") {
            const n = numbers(translateProperty)
            x += n[0] ?? 0
            y += n[1] ?? 0
        }
        return { scale: round(scale), x: round(x), y: round(y) }
    }

    // ---- accessibility ----
    const IMPLICIT: Readonly<Record<string, string>> = {
        button: "button", a: "link", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", textarea: "textbox", select: "combobox",
        img: "img", ul: "list", ol: "list", li: "listitem", table: "table", tr: "row", td: "cell", th: "columnheader", nav: "navigation", main: "main", dialog: "dialog",
        hr: "separator", progress: "progressbar", aside: "complementary", form: "form", header: "banner", footer: "contentinfo", section: "region", article: "article",
    }
    const INPUT_ROLE: Readonly<Record<string, string>> = { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", reset: "button", search: "searchbox", number: "spinbutton" }
    const roleOf = (element: Element): string => {
        const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0]
        if (explicit !== undefined && explicit !== "") return explicit
        const tag = element.tagName.toLowerCase()
        if (tag === "input") return INPUT_ROLE[(element.getAttribute("type") ?? "text").toLowerCase()] ?? "textbox"
        if (tag === "a" && !element.hasAttribute("href")) return ""
        return IMPLICIT[tag] ?? ""
    }
    const NAME_FROM_CONTENT: ReadonlySet<string> = new Set(["button", "link", "heading", "tab", "option", "menuitem", "menuitemradio", "menuitemcheckbox", "radio", "checkbox", "switch", "row", "cell", "columnheader", "gridcell", "tooltip", "treeitem", "listitem"])
    const textOf = (element: Element): string => element.textContent.replace(/\s+/g, " ").trim()
    // A node an aria-labelledby points at contributes its own aria-label before its text (accname 2B), so a labelled icon button names a menu it opens.
    const referencedTextOf = (element: Element): string => {
        const label = element.getAttribute("aria-label")?.trim()
        return label !== undefined && label !== "" ? label : textOf(element)
    }
    const nameOf = (element: Element): string => {
        const labelledby = element.getAttribute("aria-labelledby")
        if (labelledby !== null) {
            const joined = labelledby.split(/\s+/).map((id) => doc.getElementById(id)).filter((item): item is HTMLElement => item !== null).map(referencedTextOf).join(" ").trim()
            if (joined !== "") return joined
        }
        const label = element.getAttribute("aria-label")?.trim()
        if (label !== undefined && label !== "") return label
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            const labels = list(element.labels ?? [])
            const named = labels.map(textOf).join(" ").trim()
            if (named !== "") return named
        }
        const alt = element.getAttribute("alt")
        if (alt !== null && alt !== "") return alt
        if (NAME_FROM_CONTENT.has(roleOf(element))) {
            const content = textOf(element)
            if (content !== "") return content
        }
        return element.getAttribute("title")?.trim() ?? ""
    }
    const descriptionOf = (element: Element): string => {
        const ids = element.getAttribute("aria-describedby")
        if (ids === null) return ""
        return ids.split(/\s+/).map((id) => doc.getElementById(id)).filter((item): item is HTMLElement => item !== null).map(textOf).join(" ").trim()
    }
    const focusableOf = (element: Element): boolean => element instanceof HTMLElement && !element.hasAttribute("disabled") && !element.hasAttribute("inert") && element.closest("[inert]") === null && element.tabIndex >= 0 && visible(element)
    const linesOf = (element: Element): number => {
        const range = doc.createRange()
        range.selectNodeContents(element)
        const tops = new Set(Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top / 2)))
        return tops.size
    }

    // ---- geometry ----
    const paddingBox = (element: Element): { left: number; right: number; top: number; bottom: number } => {
        const rect = element.getBoundingClientRect()
        const computed = style(element)
        return { left: rect.left + px(computed.borderLeftWidth), right: rect.right - px(computed.borderRightWidth), top: rect.top + px(computed.borderTopWidth), bottom: rect.bottom - px(computed.borderBottomWidth) }
    }
    const hitAreaOf = (element: Element): number => {
        element.scrollIntoView({ block: "center", inline: "center" })
        const rect = element.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const owns = (x: number, y: number): boolean => {
            const hit = doc.elementFromPoint(x, y)
            return hit !== null && (hit === element || element.contains(hit))
        }
        const holdsAt = (r: number): boolean => [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]].every(([dx, dy]) => owns(cx + (dx ?? 0), cy + (dy ?? 0)))
        if (!owns(cx, cy)) return 0
        let reach = 0
        while (reach < 96 && holdsAt(reach + 1)) reach += 1
        return reach * 2
    }
    const scrollOwnerCache = new Map<Element, [boolean, boolean]>()
    const scrollOwnership = (element: Element): [boolean, boolean] => {
        const cached = scrollOwnerCache.get(element)
        if (cached !== undefined) return cached
        const computed = style(element)
        const scrolls = (overflow: string): boolean => overflow === "auto" || overflow === "scroll"
        const found: [boolean, boolean] = [scrolls(computed.overflowX) && element.scrollWidth > element.clientWidth + 1, scrolls(computed.overflowY) && element.scrollHeight > element.clientHeight + 1]
        scrollOwnerCache.set(element, found)
        return found
    }
    const scrollOwners = (element: Element, axis: 0 | 1): number => {
        let count = 0
        let at: Element | null = element
        while (at !== null && at !== doc.documentElement) {
            if (scrollOwnership(at)[axis]) count += 1
            at = at.parentElement
        }
        return count
    }
    const ringsOf = (element: Element): number => {
        let count = 0
        for (const item of [element, ...list(element.querySelectorAll("*"))]) {
            const computed = style(item)
            const outline = computed.outlineStyle !== "none" && px(computed.outlineWidth) > 0
            const ring = computed.boxShadow !== "none" && computed.boxShadow !== (state.ringBaseline.get(item) ?? "none")
            if (outline || ring) count += 1
        }
        return count
    }
    const paintedBox = (element: Element): Element => {
        const boundary = element.closest("[data-component]")
        let at: Element | null = element
        while (at !== null) {
            const rgba = rgbaOf(style(at).backgroundColor)
            if (rgba !== null && rgba[3] > 0) return at
            if (at === boundary) break
            at = at.parentElement
        }
        return element
    }

    // ---- metrics ----
    // A size is the box the layout gives, not the box a press or an entrance transform paints: the element's own scale is divided out.
    const ownScale = (element: Element): { readonly x: number; readonly y: number } => {
        const transform = style(element).transform
        if (transform === "none" || transform === "") return { x: 1, y: 1 }
        const matrix = new DOMMatrix(transform)
        return { x: Math.hypot(matrix.a, matrix.b) || 1, y: Math.hypot(matrix.c, matrix.d) || 1 }
    }
    const firstLetterCase = (element: Element): DnaScalar => {
        const letter = Array.from(textOf(element)).find((char) => char.toLowerCase() !== char.toUpperCase())
        // A label with no letter (a count, a glyph) has no first letter to be cased; it reads as the case the law wants.
        if (letter === undefined) return "uppercase"
        return letter === letter.toUpperCase() ? "uppercase" : "lowercase"
    }

    const tabsLook = (element: Element): DnaScalar => {
        const selected = element.matches("[role=\"tab\"][aria-selected=\"true\"]") ? element : element.querySelector("[role=\"tab\"][aria-selected=\"true\"]")
        const indicator = selected?.querySelector(".tabs__indicator") ?? element.querySelector(".tabs__indicator")
        if (selected === null || indicator === null) return null
        return indicator.getBoundingClientRect().height >= selected.getBoundingClientRect().height * 0.8 ? "pill" : "underline"
    }

    const readMetric = (element: Element, metric: string, pseudo: string | null): DnaScalar | DnaScalar[] => {
        const rect = element.getBoundingClientRect()
        switch (metric) {
            case "width":
                return round(rect.width / ownScale(element).x)
            case "height":
                return round(rect.height / ownScale(element).y)
            case "top":
                return round(rect.top)
            case "bottom":
                return round(rect.bottom)
            case "left":
                return round(rect.left)
            case "right":
                return round(rect.right)
            case "inner-left":
                return round(paddingBox(element).left)
            case "inner-right":
                return round(paddingBox(element).right)
            case "hit-area":
                return hitAreaOf(element)
            case "radius": {
                const raw = style(element, pseudo).borderStartStartRadius
                return raw.endsWith("%") ? round((Number.parseFloat(raw) / 100) * Math.min(rect.width, rect.height)) : round(px(raw))
            }
            case "border-width": {
                const computed = style(element, pseudo)
                return Math.max(px(computed.borderTopWidth), px(computed.borderRightWidth), px(computed.borderBottomWidth), px(computed.borderLeftWidth))
            }
            case "shadow-blur":
                return firstShadow(element)[2] ?? 0
            case "shadow-offset": {
                const shadow = firstShadow(element)
                return [shadow[0] ?? 0, shadow[1] ?? 0]
            }
            case "scale":
                return matrixOf(element).scale
            case "translate": {
                const moved = matrixOf(element)
                return [moved.x, moved.y]
            }
            case "contrast":
                return contrastOf(element)
            case "scroll-owners-x":
                return scrollOwners(element, 0)
            case "scroll-owners-y":
                return scrollOwners(element, 1)
            case "focus-rings":
                return ringsOf(element)
            case "tabs-look": {
                return tabsLook(element)
            }
            case "navigation": {
                if (window.__dnaNavigation === undefined) return "reload"
                return window.__dnaNavigation === history.length ? "none" : "client"
            }
            case "role":
                return roleOf(element)
            case "name":
                return nameOf(element)
            case "description":
                return descriptionOf(element)
            case "focusable":
                return focusableOf(element)
            case "focused":
                return doc.activeElement === element
            case "controls": {
                const id = element.getAttribute("aria-controls")
                const controlled = id === null ? null : doc.getElementById(id)
                return controlled === null ? null : roleOf(controlled)
            }
            case "text":
                return textOf(element)
            case "first-letter": {
                return firstLetterCase(element)
            }
            case "lines":
                return linesOf(element)
            default:
                return style(element, pseudo).getPropertyValue(metric)
        }
    }
    const flat = (value: DnaScalar | DnaScalar[]): DnaScalar[] => (Array.isArray(value) ? value : [value])
    // The scalars a metric list reads on an element; attr reads the attribute by its name.
    const readAll = (element: Element, kind: string, metrics: readonly string[], pseudo: string | null): DnaScalar[] =>
        metrics.flatMap((metric) => (kind === "attr" ? [element.getAttribute(metric)] : flat(readMetric(element, metric, pseudo)))).map(canon)

    // ---- selection ----
    const DOCUMENT = "document "
    const scopeOfSelector = (selector: string, from: Element | null): { readonly host: ParentNode; readonly selector: string; readonly document: boolean } =>
        selector.startsWith(DOCUMENT) ? { host: doc, selector: selector.slice(DOCUMENT.length), document: true } : { host: from ?? doc, selector, document: false }
    // An element belongs to the grammar root it stands in; a scope inside that root (a Tabs, a PageHeader) selects what stands in the same root, not only from the root itself.
    const queryAll = (selector: string, from: Element | null): Element[] => {
        const where = scopeOfSelector(selector, from)
        return list(where.host.querySelectorAll(where.selector)).filter((element) => !inReference(element) && (where.document || from === null || element.closest(rootSelector()) === from.closest(rootSelector())))
    }
    const queryMeasured = (selector: string, from: Element | null): Element[] => queryAll(selector, from).filter(visible)

    // ---- values ----
    type Resolved = { readonly alternatives: DnaScalar[][] } | { readonly skip: string }
    const lengthOf = (anchor: Element, raw: string, property: string): DnaScalar => {
        // The probe sits inside the element so a token defined on the element itself resolves; a void element cannot hold one.
        const host = anchor.matches("input,img,hr,br,textarea,select") ? (anchor.parentElement ?? anchor) : anchor
        const probe = doc.createElement("span")
        probe.dataset.dnaReference = "probe"
        probe.style.setProperty("position", "absolute")
        probe.style.setProperty("visibility", "hidden")
        probe.style.setProperty(property, raw)
        host.appendChild(probe)
        const value = style(probe).getPropertyValue(property)
        probe.remove()
        return value
    }
    const resolveToken = (anchor: Element, token: string, metric: string): DnaScalar => {
        const raw = style(anchor).getPropertyValue(token).trim()
        if (raw === "") return null
        if (/color|background|fill|stroke/i.test(metric)) return canon(lengthOf(anchor, `var(${token})`, "background-color"))
        const resolved = lengthOf(anchor, `var(${token})`, "width")
        return resolved === "" || resolved === "auto" ? raw : resolved
    }
    const vendorReference = (component: string, props: Readonly<Record<string, string | number | boolean>>, anchor: Element): Element | null => {
        const wanted = Object.entries(props).map(([key, value]) => [key, typeof value === "string" && value.startsWith("$") ? (anchor.getAttribute(value.slice(1)) ?? "") : value] as const)
        return (
            list(doc.querySelectorAll<HTMLElement>(`[data-dna-vendor="${component}"]`)).find((candidate) => {
                const declared = JSON.parse(candidate.dataset.dnaProps ?? "{}") as Record<string, unknown>
                return wanted.every(([key, value]) => String(declared[key]) === String(value))
            }) ?? null
        )
    }
    const oneOfAlternatives = (oneOf: Extract<DnaValue, { oneOf: unknown }>["oneOf"], anchor: Element, metrics: readonly string[], context: { readonly scope: Element | null; readonly rows: number; readonly beforeKey: string }): Resolved => {
        const value = { oneOf }
        const parts = value.oneOf.map((item) => resolve(anchor, item, metrics, context))
        const alternatives = parts.flatMap((part) => ("alternatives" in part ? part.alternatives : []))
        return alternatives.length === 0 ? { skip: "no alternative of oneOf resolves" } : { alternatives }
    }

    const countAlternatives = (count: string, offset: number | undefined, scope: Element | null): Resolved => {
        const value = { count, offset }
        const inside = scope === null ? queryAll(value.count, null).length : queryAll(value.count, scope).length
        return { alternatives: [[inside + (value.offset ?? 0)]] }
    }

    const vendorAlternatives = (vendor: Extract<DnaValue, { vendor: unknown }>["vendor"], anchor: Element): Resolved => {
        const value = { vendor }
        const reference = vendorReference(value.vendor.component, value.vendor.props, anchor)
        if (reference === null) return { skip: `no ${value.vendor.component} reference (${JSON.stringify(value.vendor.props)}) is rendered beside the story` }
        const names = typeof value.vendor.metric === "string" ? [value.vendor.metric] : value.vendor.metric
        return { alternatives: [readAll(reference, "style", names, null)] }
    }

    const resolve = (anchor: Element, value: DnaValue | undefined, metrics: readonly string[], context: { readonly scope: Element | null; readonly rows: number; readonly beforeKey: string }): Resolved => {
        if (value === undefined) return { alternatives: [] }
        if (typeof value !== "object") return { alternatives: [[canon(value)]] }
        if ("token" in value) {
            const resolved = metrics.map((metric) => resolveToken(anchor, value.token, metric))
            return resolved.includes(null) ? { skip: `${value.token} is not set where the element is` } : { alternatives: [resolved] }
        }
        if ("threshold" in value) return { skip: "a threshold is read before the page" }
        if ("vendor" in value) {
            return vendorAlternatives(value.vendor, anchor)
        }
        if ("self" in value) return { alternatives: [flat(readMetric(anchor, value.self, null)).map((item) => (typeof item === "number" ? round(item * value.times) : item))] }
        if ("count" in value) {
            return countAlternatives(value.count, value.offset, context.scope)
        }
        if ("rows" in value) return { alternatives: [[context.rows + value.rows]] }
        if ("oneOf" in value) {
            return oneOfAlternatives(value.oneOf, anchor, metrics, context)
        }
        if ("before" in value) {
            const saved = state.beforeValues.get(context.beforeKey)
            return saved === undefined ? { skip: "no value was taken before the act" } : { alternatives: [saved] }
        }
        const fact = state.fixture[value.fixture]
        return fact === undefined ? { skip: `the story declares no fixture fact "${value.fixture}"` } : { alternatives: [[fact]] }
    }

    // ---- reports ----
    interface Collector {
        matched: number
        evaluated: number
        skipped: Set<string>
        brokenCount: number
        broken: { path: string; breaks: DnaBreak[] }[]
    }
    const newCollector = (): Collector => ({ matched: 0, evaluated: 0, skipped: new Set(), brokenCount: 0, broken: [] })
    const finish = (index: number, collector: Collector, error?: string): PageReport => ({
        index,
        matched: collector.matched,
        evaluated: collector.evaluated,
        skipped: Array.from(collector.skipped),
        brokenCount: collector.brokenCount,
        broken: collector.broken,
        ...(error === undefined ? {} : { error }),
    })
    const toleranceOf = (variant: DnaVariant): number => variant.tolerance ?? (variant.kind === "box" || variant.kind === "relation" || variant.kind === "uniform" ? 0.5 : 0.01)
    const judgeInto = (collector: Collector, path: string, parts: readonly DnaPart[]): void => {
        collector.evaluated += 1
        const breaks: DnaBreak[] = []
        for (const part of parts) {
            const verdict = judgePart(part)
            if (!verdict.ok) breaks.push({ metric: part.metric, measured: part.measured.map((scalar) => JSON.stringify(scalar)).join(", "), want: verdict.want })
        }
        if (breaks.length === 0) return
        collector.brokenCount += 1
        if (collector.broken.length < state.input.maxBroken) collector.broken.push({ path, breaks })
    }
    const patternFlag = (value: DnaValue | undefined): boolean => typeof value === "string"

    const whereHolds = (element: Element, where: DnaWhere, variant: DnaVariant): boolean => {
        const resolved = resolve(element, where.value, [where.metric], { scope: null, rows: 0, beforeKey: "" })
        if (!("alternatives" in resolved)) return false
        const part: DnaPart = { metric: where.metric, op: where.op, measured: readAll(element, "style", [where.metric], variant.pseudo), expected: resolved.alternatives, pattern: false, tolerance: toleranceOf(variant) }
        return judgePart(part).ok
    }

    /** The part one element gives for a metric list, an operator and a value; a reason string when it cannot be measured. */
    const partOf = (element: Element, variant: DnaVariant, metrics: readonly string[], op: DnaVariant["op"], value: DnaValue | undefined, kind: string, place: { readonly scope: Element | null; readonly beforeKey: string }): DnaPart | string => {
        const resolved = resolve(element, value, metrics, { ...place, rows: 0 })
        if ("skip" in resolved) return resolved.skip
        if (resolved.alternatives.length === 0 && op !== "set") return "the measure has no value"
        return { metric: metrics.join(","), op, measured: readAll(element, kind, metrics, variant.pseudo), expected: resolved.alternatives, pattern: patternFlag(value), tolerance: toleranceOf(variant) }
    }

    const selectedBy = (variant: DnaVariant, root: Element, anchors: readonly Element[] | null): Element[] => {
        if (anchors !== null) return Array.from(anchors)
        // A control with pointer-events none is not pressable: its hit area is not a fact about the control.
        const found = queryMeasured(variant.select, root).filter((element) => !variant.metrics.includes("hit-area") || style(element).pointerEvents !== "none")
        return variant.where === null ? found : found.filter((element) => variant.where !== null && whereHolds(element, variant.where, variant))
    }

    // ---- seams ----
    const hasPaint = (value: string): boolean => {
        const rgba = rgbaOf(value)
        return rgba !== null && rgba[3] > 0
    }
    const pseudoSeam = (above: Element, below: Element): { left: number; right: number } | null => {
        for (const [owner, pseudo] of [[above, "::after"], [below, "::before"]] as const) {
            const computed = style(owner, pseudo)
            if (computed.content === "none" || computed.content === "normal") continue
            const thin = px(computed.height) > 0 && px(computed.height) <= 2
            if (thin && (hasPaint(computed.backgroundColor) || (px(computed.borderTopWidth) > 0 && computed.borderTopStyle !== "none"))) {
                const host = owner.getBoundingClientRect()
                const left = host.left + px(computed.left)
                const right = computed.right === "auto" ? left + px(computed.width) : host.right - px(computed.right)
                return { left, right }
            }
        }
        return null
    }

    const seamBetween = (above: Element, below: Element): { left: number; right: number } | null => {
        const a = above.getBoundingClientRect()
        const b = below.getBoundingClientRect()
        const lower = style(above)
        if (px(lower.borderBottomWidth) > 0 && lower.borderBottomStyle !== "none" && hasPaint(lower.borderBottomColor)) return { left: a.left, right: a.right }
        const upper = style(below)
        if (px(upper.borderTopWidth) > 0 && upper.borderTopStyle !== "none" && hasPaint(upper.borderTopColor)) return { left: b.left, right: b.right }
        const pseudo = pseudoSeam(above, below)
        if (pseudo !== null) return pseudo
        const between = list(doc.querySelectorAll("hr,[role=\"separator\"],[data-component=\"Divider\"]")).find((item) => {
            const rect = item.getBoundingClientRect()
            return rect.width > 0 && rect.top >= a.bottom - 1 && rect.bottom <= b.top + 2 && rect.height <= 2
        })
        if (between !== undefined) {
            const rect = between.getBoundingClientRect()
            return { left: rect.left, right: rect.right }
        }
        return null
    }

    // ---- the evaluator ----
    interface Sink {
        readonly collector: Collector
        readonly skip: (reason: string) => void
        readonly add: (path: string, parts: readonly (DnaPart | string)[]) => void
    }
    const sinkOf = (collector: Collector): Sink => {
        const skip = (reason: string): void => {
            collector.skipped.add(reason)
        }
        const add = (path: string, parts: readonly (DnaPart | string)[]): void => {
            const reasons = parts.filter((part): part is string => typeof part === "string")
            if (reasons.length > 0) {
                reasons.forEach(skip)
                return
            }
            judgeInto(collector, path, parts.filter((part): part is DnaPart => typeof part !== "string"))
        }
        return { collector, skip, add }
    }

    /** A variant judged on each element it selects, one part per element. */
    const evaluateEach = (variant: DnaVariant, root: Element, anchors: readonly Element[] | null, beforeKeys: readonly string[] | null, sink: Sink): void => {
        const { collector, add } = sink
        const matches = selectedBy(variant, root, anchors)
        collector.matched = matches.length
        matches.forEach((original, position) => {
            const element = variant.target === "painted-box" ? paintedBox(original) : original
            add(pathOf(original), [partOf(element, variant, variant.metrics, variant.op, variant.value, variant.kind, { scope: null, beforeKey: beforeKeys?.[position] ?? "" })])
        })
    }
    /** A variant that reads custom properties of the root: set, or ordered against each other. */
    const evaluateTokens = (variant: DnaVariant, root: Element, sink: Sink): void => {
        const { collector, add } = sink
        collector.matched = 1
        const names = variant.metrics
        if (variant.op === "set") {
            for (const name of names) {
                const raw = style(root).getPropertyValue(name).trim()
                add(name, [{ metric: name, op: "set", measured: [raw], expected: [], pattern: false, tolerance: 0 }])
            }
        } else {
            const lengths = names.map((name) => {
                const raw = style(root).getPropertyValue(name).trim()
                return raw === "" ? null : lengthOf(root, `var(${name})`, "width")
            })
            const parts = names.slice(0, -1).map((name, at): DnaPart | string => {
                const next = names[at + 1] ?? ""
                const [left, right] = [lengths[at], lengths[at + 1]]
                if (left === null || left === undefined || right === null || right === undefined) return `${left === null || left === undefined ? name : next} is not set on the root`
                return { metric: `${name} ${variant.op} ${next}`, op: variant.op, measured: [left], expected: [[right]], pattern: false, tolerance: 0 }
            })
            add(pathOf(root), parts)
        }
    }
    /** A variant whose elements in one scope must read alike. */
    const evaluateUniform = (variant: DnaVariant, scopeElement: Element, within: Element | null, sink: Sink): void => {
        const { skip, add } = sink
        const group = queryMeasured(variant.select, scopeElement)
        if (group.length === 0) {
            skip("no element of the scope matches")
            return
        }
        const rows = group.map((item) => readAll(item, "style", variant.metrics, variant.pseudo))
        const first = rows[0] ?? []
        const measured = rows.flat()
        const resolved = variant.value === undefined ? { alternatives: [rows.flatMap(() => first)] } : resolve(scopeElement, variant.value, variant.metrics, { scope: within, rows: 0, beforeKey: "" })
        if ("skip" in resolved) skip(resolved.skip)
        else add(pathOf(scopeElement), [{ metric: variant.metrics.join(","), op: variant.op, measured, expected: resolved.alternatives, pattern: false, tolerance: toleranceOf(variant) }])
    }
    /** One host of a seams variant: its rows, the seams drawn between them and what they are judged against. */
    const evaluateSeamsOf = (variant: DnaVariant, host: Element, sink: Sink): void => {
        const { skip, add } = sink
        const rows = variant.rows === null ? [] : list(host.querySelectorAll(variant.rows)).filter(visible)
        if (rows.length === 0) {
            skip("the match has no rows")
            return
        }
        const seams = rows.slice(0, -1).map((row, at) => seamBetween(row, rows[at + 1] ?? row))
        const drawn = seams.filter((seam): seam is { left: number; right: number } => seam !== null)
        const inner = paddingBox(host)
        if (variant.metrics.includes("count")) {
            const resolved = resolve(host, variant.value, variant.metrics, { scope: null, rows: rows.length, beforeKey: "" })
            if ("skip" in resolved) skip(resolved.skip)
            else add(pathOf(host), [{ metric: "count", op: variant.op, measured: [drawn.length], expected: resolved.alternatives, pattern: false, tolerance: 0 }])
        } else if (drawn.length === 0) {
            skip("the match draws no seam to measure")
        } else {
            const resolved = resolve(host, variant.value, variant.metrics, { scope: null, rows: rows.length, beforeKey: "" })
            if ("skip" in resolved) skip(resolved.skip)
            else add(pathOf(host), [{ metric: "inset-inline", op: variant.op, measured: drawn.flatMap((seam) => [round(seam.left - inner.left), round(inner.right - seam.right)]), expected: resolved.alternatives, pattern: false, tolerance: 0.5 }])
        }
    }
    /** A variant that reads the seams between the rows of each match. */
    const evaluateSeams = (variant: DnaVariant, root: Element, within: Element | null, sink: Sink): void => {
        for (const host of queryMeasured(variant.select, within ?? root)) evaluateSeamsOf(variant, host, sink)
    }
    /** A count variant in one scope: the elements the select finds, judged against the value. */
    const evaluateCount = (variant: DnaVariant, scopeElement: Element, within: Element | null, sink: Sink): void => {
        const found = scopeElement === doc.documentElement || (variant.scope === null && variant.select.startsWith(DOCUMENT)) ? queryAll(variant.select, null) : queryAll(variant.select, scopeElement)
        const kept = variant.where === null ? found : found.filter((item) => variant.where !== null && whereHolds(item, variant.where, variant))
        sink.add(pathOf(scopeElement), [partOfCount(variant, kept.length, within)])
    }
    /** A variant judged once per scope: a count, a uniform read or its seams. */
    const evaluateScopes = (variant: DnaVariant, root: Element, sink: Sink): void => {
        const wholeScope = variant.kind === "count" && variant.select.startsWith(DOCUMENT) ? doc.documentElement : root
        const scopes = variant.scope === null ? [wholeScope] : queryAll(variant.scope, root)
        sink.collector.matched = scopes.length
        for (const scopeElement of scopes) {
            const within = scopeElement === doc.documentElement ? null : scopeElement
            if (variant.kind === "count") evaluateCount(variant, scopeElement, within, sink)
            else if (variant.kind === "uniform") evaluateUniform(variant, scopeElement, within, sink)
            else if (variant.kind === "seams") evaluateSeams(variant, root, within, sink)
        }
    }
    const relationTarget = (ref: NonNullable<DnaVariant["ref"]>, original: Element): Element | null => {
        const ancestor = original.closest(ref.within)
        let target: Element | null = null
        if (ancestor !== null) {
            if (ref.select === "self") target = ancestor
            else if (ref.select === "previous") target = original.previousElementSibling
            else target = ancestor.querySelector(ref.select)
        }
        return target
    }

    /** A variant that compares each match with a reference element. */
    const evaluateRelation = (variant: DnaVariant, root: Element, anchors: readonly Element[] | null, sink: Sink): void => {
        const { collector, skip, add } = sink
        const matches = selectedBy(variant, root, anchors)
        collector.matched = matches.length
        for (const original of matches) {
            const ref = variant.ref
            if (ref === null) continue
            const target = relationTarget(ref, original)
            if (target === null) {
                skip("the reference element of the relation is not rendered")
                continue
            }
            const reference = readAll(target, "box", ref.metrics, null)
            const offset = typeof ref.offset === "number" ? ref.offset : Number.parseFloat(ref.offset ?? "0") || 0
            const element = variant.target === "painted-box" ? paintedBox(original) : original
            add(pathOf(original), [
                {
                    metric: variant.metrics.join(","),
                    op: variant.op,
                    measured: readAll(element, "box", variant.metrics, variant.pseudo),
                    expected: [reference.map((item) => (typeof item === "number" ? round(item + offset) : item))],
                    pattern: false,
                    tolerance: toleranceOf(variant),
                },
            ])
        }
    }
    const evaluate = (variant: DnaVariant, index: number, anchors: readonly Element[] | null, beforeKeys: readonly string[] | null): PageReport => {
        const collector = newCollector()
        const root = state.root
        if (root === null) return finish(index, collector, "no Grammar root of the family on the page")
        try {
            const sink = sinkOf(collector)
            const single = variant.kind === "uniform" || variant.kind === "count" || variant.kind === "seams" || variant.kind === "relation" || variant.kind === "tokens"
            if (!single) evaluateEach(variant, root, anchors, beforeKeys, sink)
            else if (variant.kind === "tokens") evaluateTokens(variant, root, sink)
            else {
                evaluateScopes(variant, root, sink)
                if (variant.kind === "relation") evaluateRelation(variant, root, anchors, sink)
            }
            return finish(index, collector)
        } catch (error: unknown) {
            return finish(index, collector, error instanceof Error ? error.message : String(error))
        }
    }

    // Count and uniform parts are built from the resolved value, so a skipped fact stays a skip.
    const partOfCount = (variant: DnaVariant, count: number, scope: Element | null): DnaPart | string => {
        const anchor = scope ?? state.root ?? doc.documentElement
        const resolved = resolve(anchor, variant.value, ["count"], { scope, rows: 0, beforeKey: "" })
        if ("skip" in resolved) return resolved.skip
        return { metric: "count", op: variant.op, measured: [count], expected: resolved.alternatives, pattern: false, tolerance: 0 }
    }

    // ---- the thing a dynamic variant measures after the act ----
    const afterVariantOf = (variant: DnaVariant): DnaVariant => {
        const after = variant.after
        if (after === null) return variant
        return {
            ...variant,
            kind: after.kind,
            select: after.select ?? variant.select,
            scope: after.scope,
            pseudo: after.pseudo,
            metrics: after.metrics,
            op: after.op,
            value: after.value,
            where: after.where,
            after: null,
            act: [],
            ref: null,
            rows: null,
        }
    }

    const probe: DnaProbe = {
        begin: (input) => {
            state.input = input
            state.targets = new Map()
            state.beforeValues = new Map()
            state.ringBaseline = new Map()
            scrollOwnerCache.clear()
            const roots = list(doc.querySelectorAll(rootSelector())).filter((element) => !inReference(element))
            state.root = roots[0] ?? null
            const preview = (globalThis as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { story?: { id?: string; parameters?: { dna?: { fixture?: Record<string, DnaScalar>; followUp?: unknown } } } } } }).__STORYBOOK_PREVIEW__
            const story = preview?.currentRender?.story
            state.fixture = story?.parameters?.dna?.fixture ?? {}
            const followUp = story?.parameters?.dna?.followUp
            return { roots: roots.length, anyRoot: list(doc.querySelectorAll(`[${input.rootAttribute}]`)).filter((element) => !inReference(element)).length, fixture: state.fixture, story: story?.id ?? "", followUp: typeof followUp === "string" ? followUp : null }
        },
        run: (variants) => variants.map((item) => evaluate(item.variant, item.index, null, null)),
        locate: (item) => {
            const root = state.root
            if (root === null) return []
            const found = queryMeasured(item.variant.select, root).filter((element) => item.variant.where === null || whereHolds(element, item.variant.where, item.variant))
            state.targets.set(item.index, found)
            return found.map((element) => {
                element.scrollIntoView({ block: "center", inline: "center" })
                const rect = element.getBoundingClientRect()
                return { path: pathOf(element), x: round(rect.left + rect.width / 2), y: round(rect.top + rect.height / 2) }
            })
        },
        before: (item, target) => {
            const element = state.targets.get(item.index)?.[target]
            if (element === undefined) return
            const after = afterVariantOf(item.variant)
            state.beforeValues.set(`${String(item.index)}:${String(target)}`, readAll(element, "style", after.metrics, after.pseudo))
            state.ringBaseline = new Map([element, ...list(element.querySelectorAll("*"))].map((node) => [node, style(node).boxShadow]))
            window.__dnaNavigation = history.length
        },
        after: (item, target) => {
            const element = state.targets.get(item.index)?.[target]
            if (element === undefined) return finish(item.index, newCollector())
            const variant = afterVariantOf(item.variant)
            const key = `${String(item.index)}:${String(target)}`
            // A `then` that names its own select looks at the whole page; otherwise it looks at the match that was acted on.
            const own = (item.variant.after?.select ?? null) === null
            const report = evaluate({ ...variant, where: own ? null : variant.where }, item.index, own ? [element] : null, [key])
            // The thing the act should have produced never appeared: the anchor was exercised and the law is broken.
            if (report.matched === 0 && report.error === undefined && report.skipped.length === 0 && variant.kind !== "count") {
                return { ...report, matched: 1, brokenCount: 1, broken: [{ path: pathOf(element), breaks: [{ metric: variant.metrics.join(","), measured: "nothing matched" /* NOTHING_MATCHED, which the driver compares */, want: `${variant.select} to be on the page after the act` }] }] }
            }
            return { ...report, matched: Math.max(report.matched, 1) }
        },
        focus: (item, target) => {
            const element = state.targets.get(item.index)?.[target]
            if (!(element instanceof HTMLElement)) return
            const options: FocusOptions & { focusVisible: boolean } = { focusVisible: true }
            element.focus(options)
        },
        blur: () => {
            const active = doc.activeElement
            if (active instanceof HTMLElement) active.blur()
        },
        reset: () => {
            state.targets = new Map()
            state.beforeValues = new Map()
            state.ringBaseline = new Map()
            scrollOwnerCache.clear()
        },
    }
    window.__dna = probe
}

/**
 * Runs in the page: waits until a Grammar root is in the document (a Storybook story or a client app renders after load), or the
 * time is up, then for web fonts and three frames, so the layout measured is the settled one. True when a root appeared.
 */
export const settlePage = async (input: { readonly rootSelector: string; readonly waitMs: number }): Promise<boolean> => {
    const deadline = Date.now() + input.waitMs
    const present = (): boolean => document.querySelector(input.rootSelector) !== null
    const poll = async (): Promise<void> => {
        if (present() || Date.now() >= deadline) return
        await new Promise<void>((done) => setTimeout(done, 50))
        await poll()
    }
    const frame = (): Promise<void> => new Promise<void>((done) => requestAnimationFrame(() => {
            done()
        }))
    await poll()
    await document.fonts.ready
    await frame()
    await frame()
    await frame()
    return present()
}

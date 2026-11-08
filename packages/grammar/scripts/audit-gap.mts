import { readFileSync, writeFileSync } from "node:fs"
import { chromium, type Browser } from "@playwright/test"

/**
 * Audits the proximity law in a rendered page: inside any container, its children stand at least ONE step closer than the
 * container stands to its siblings (scale 4 identity, 8 inline, 12 row, 24 section, 32 region, 16 card inset). Measured by
 * computed style in headless Chromium: for every flex or grid container with two or more rendered children, its inner gap is
 * compared with the gap of the nearest ancestor that spaces it from siblings. A bounded box (visible border, a background
 * differing from the ancestor's, or a shadow) groups its own content and is exempt; two region gaps (32 or more) are a
 * ceiling, not a violation. Gaps off the scale are listed as warnings.
 *
 * `node scripts/audit-gap.mts <url>... [--urls-file <file>] [--viewport 1440x900] [--json <out>] [--wait <ms|networkidle>]
 * [--storage-state <file>] [--browser <path>]`. Exit 1 when any violation is found, 2 when a page cannot be loaded.
 */

const SCALE: readonly number[] = [0, 4, 8, 12, 16, 24, 32]
const TIMEOUT_MS = 60_000

interface Violation {
    readonly selector: string
    readonly ancestor: string
    readonly component?: string
    readonly ancestorComponent?: string
    readonly inner: number
    readonly innerAxis: string
    readonly outer: number
    readonly outerAxis: string
}

interface Warning {
    readonly selector: string
    readonly component?: string
    readonly axis: string
    readonly gap: number
}

interface PageAudit {
    readonly containers: number
    readonly violations: readonly Violation[]
    readonly ceilings: readonly Violation[]
    readonly warnings: readonly Warning[]
}

interface UrlReport extends Partial<PageAudit> {
    readonly url: string
    readonly error?: string
}

const argv = process.argv.slice(2)
const valueFlags = new Set(["--urls-file", "--viewport", "--json", "--wait", "--storage-state", "--browser"])
const flag = (name: string): string | undefined => {
    const at = argv.indexOf(name)
    return at < 0 ? undefined : argv[at + 1]
}

const urls: string[] = []
for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? ""
    if (valueFlags.has(arg)) at += 1
    else if (!arg.startsWith("--")) urls.push(arg)
}
const urlsFile = flag("--urls-file")
if (urlsFile !== undefined) {
    for (const line of readFileSync(urlsFile, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed !== "" && !trimmed.startsWith("#")) urls.push(trimmed)
    }
}
if (urls.length === 0) {
    console.error("usage: node scripts/audit-gap.mts <url>... [--urls-file f] [--viewport 1440x900] [--json out] [--wait ms|networkidle] [--storage-state f] [--browser path]")
    process.exit(2)
}

const viewportMatch = /^(\d+)x(\d+)$/.exec(flag("--viewport") ?? "1440x900")
if (viewportMatch === null) {
    console.error("--viewport must look like 1440x900")
    process.exit(2)
}
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) }
const wait = flag("--wait") ?? "networkidle"
const storageState = flag("--storage-state")
const jsonOut = flag("--json")
const browserPath = flag("--browser")

/** Runs inside the page; it must stay self-contained. */
function measure(scale: readonly number[]): PageAudit {
    const px = (value: string): number => {
        const parsed = parseFloat(value)
        return Number.isNaN(parsed) ? 0 : parsed
    }
    const isLayout = (style: CSSStyleDeclaration): boolean => /^(inline-)?(flex|grid)$/.test(style.display)
    const isRendered = (el: Element): boolean => {
        const style = getComputedStyle(el)
        if (style.display === "none" || style.position === "absolute" || style.position === "fixed") return false
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0
    }
    const renderedChildren = (el: Element): Element[] => Array.from(el.children).filter(isRendered)
    interface Gap {
        readonly value: number
        readonly axis: string
        readonly row: number
        readonly column: number
    }
    const gapOf = (style: CSSStyleDeclaration): Gap => {
        const row = px(style.rowGap)
        const column = px(style.columnGap)
        if (style.display.endsWith("grid")) return { value: Math.max(row, column), axis: row === column ? "both" : row > column ? "row" : "column", row, column }
        const vertical = style.flexDirection.startsWith("column")
        return { value: vertical ? row : column, axis: vertical ? "row-gap (column flow)" : "column-gap (row flow)", row, column }
    }
    const transparent = (color: string): boolean => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color) || /\/\s*0(\.0+)?\)$/.test(color)
    const bounded = (el: Element, ancestor: Element): boolean => {
        const style = getComputedStyle(el)
        const sides = [
            [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
            [style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
            [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
            [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
        ] as const
        if (sides.some(([width, line, color]) => px(width) > 0 && line !== "none" && !transparent(color))) return true
        if (style.boxShadow !== "none") return true
        return !transparent(style.backgroundColor) && style.backgroundColor !== getComputedStyle(ancestor).backgroundColor
    }
    const segment = (el: Element): string => {
        const tag = el.tagName.toLowerCase()
        if (el.id !== "") return `#${CSS.escape(el.id)}`
        const component = el.getAttribute("data-component")
        if (component !== null) return `${tag}[data-component="${component}"]`
        const grammar = Array.from(el.classList).find((name) => name.startsWith("starci-core-"))
        const base = grammar === undefined ? tag : `${tag}.${CSS.escape(grammar)}`
        const siblings = el.parentElement === null ? [] : Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName)
        return siblings.length > 1 ? `${base}:nth-of-type(${siblings.indexOf(el) + 1})` : base
    }
    const selectorOf = (el: Element): string => {
        const parts: string[] = []
        let at: Element | null = el
        while (at !== null && at !== document.documentElement) {
            parts.unshift(segment(at))
            const joined = parts.join(" > ")
            if (document.querySelectorAll(joined).length === 1) return joined
            at = at.parentElement
        }
        return parts.join(" > ")
    }
    const componentOf = (el: Element): string | undefined => el.getAttribute("data-component") ?? undefined

    const violations: Violation[] = []
    const ceilings: Violation[] = []
    const warnings: Warning[] = []
    let containers = 0
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
        const style = getComputedStyle(el)
        if (!isLayout(style) || renderedChildren(el).length < 2) continue
        containers += 1
        const inner = gapOf(style)
        const component = componentOf(el)
        const axes: readonly (readonly [string, number])[] = style.display.endsWith("grid") ? [["row", inner.row], ["column", inner.column]] : [[inner.axis, inner.value]]
        for (const [axis, value] of axes) {
            if (!scale.includes(value)) warnings.push({ selector: selectorOf(el), ...(component === undefined ? {} : { component }), axis, gap: value })
        }
        if (inner.value <= 0) continue
        const chain: Element[] = [el]
        let link: Element = el
        for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
            const kids = renderedChildren(parent)
            if (!kids.includes(link)) break
            const parentStyle = getComputedStyle(parent)
            const outer = isLayout(parentStyle) && kids.length >= 2 ? gapOf(parentStyle) : undefined
            if (outer !== undefined && outer.value > 0) {
                if (chain.some((member) => bounded(member, parent))) break
                const ancestorComponent = componentOf(parent)
                const found: Violation = {
                    selector: selectorOf(el),
                    ancestor: selectorOf(parent),
                    ...(component === undefined ? {} : { component }),
                    ...(ancestorComponent === undefined ? {} : { ancestorComponent }),
                    inner: inner.value,
                    innerAxis: inner.axis,
                    outer: outer.value,
                    outerAxis: outer.axis,
                }
                if (inner.value >= 32 && outer.value >= 32) ceilings.push(found)
                else if (inner.value >= outer.value) violations.push(found)
                break
            }
            chain.push(parent)
            link = parent
        }
    }
    return { containers, violations, ceilings, warnings }
}

const auditPage = async (browser: Browser, url: string): Promise<PageAudit> => {
    const context = await browser.newContext({ viewport, ...(storageState === undefined ? {} : { storageState }) })
    try {
        const page = await context.newPage()
        await page.goto(url, { waitUntil: "load", timeout: TIMEOUT_MS })
        if (wait === "networkidle") await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => undefined)
        else await page.waitForTimeout(Number(wait) || 0)
        return await page.evaluate(measure, SCALE)
    } finally {
        await context.close()
    }
}

const label = (selector: string, component?: string): string => (component === undefined ? selector : `${selector}  <${component}>`)

let engine: Browser | undefined
const reports: UrlReport[] = []
try {
    engine = await chromium.launch({ headless: true, timeout: TIMEOUT_MS, ...(browserPath === undefined ? {} : { executablePath: browserPath }) })
    for (const url of urls) {
        try {
            reports.push({ url, ...(await auditPage(engine, url)) })
        } catch (error) {
            reports.push({ url, error: error instanceof Error ? error.message : String(error) })
        }
    }
} finally {
    await engine?.close()
}

let violationCount = 0
let warningCount = 0
let failedLoads = 0
for (const report of reports) {
    console.log(`\n${report.url}  (${viewport.width}x${viewport.height})`)
    if (report.error !== undefined) {
        failedLoads += 1
        console.log(`  ERROR ${report.error.split("\n")[0]}`)
        continue
    }
    const violations = report.violations ?? []
    const warnings = report.warnings ?? []
    violationCount += violations.length
    warningCount += warnings.length
    console.log(`  ${report.containers} containers, ${violations.length} violations, ${(report.ceilings ?? []).length} region ceilings, ${warnings.length} off-scale gaps`)
    if (violations.length > 0) {
        console.log("  VIOLATIONS (inner gap >= outer gap)")
        for (const row of violations) {
            console.log(`  ${row.inner}px ${row.innerAxis} >= ${row.outer}px ${row.outerAxis}`)
            console.log(`      inner:    ${label(row.selector, row.component)}`)
            console.log(`      ancestor: ${label(row.ancestor, row.ancestorComponent)}`)
        }
    }
    if (warnings.length > 0) {
        console.log("  WARNINGS (gap off the 0/4/8/12/16/24/32 scale)")
        for (const warning of warnings) console.log(`  ${`${warning.gap}px ${warning.axis}`.padEnd(28)} ${label(warning.selector, warning.component)}`)
    }
}
console.log(`\nSUMMARY ${reports.length} page(s): ${violationCount} violation(s), ${warningCount} off-scale warning(s), ${failedLoads} failed load(s)`)
if (jsonOut !== undefined) writeFileSync(jsonOut, `${JSON.stringify({ viewport, reports }, null, 2)}\n`)
process.exitCode = failedLoads > 0 ? 2 : violationCount > 0 ? 1 : 0

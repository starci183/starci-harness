import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium, type Browser } from "@playwright/test"
import { createElement, type ComponentType, type ReactNode } from "react"

/**
 * Proves that an app sets its own theme: a test app that sets HeroUI's tokens and nothing else (`theme-proof/app-theme.css`)
 * renders the built grammar in both families and both modes, and every part follows, measured by computed style in a
 * headless Chromium managed by Playwright (no dev server). A second scenario renders each family on its own `theme.css`
 * defaults, and a third overrides one token over those defaults. Run after `npm run build`:
 * `node scripts/prove-theme.mts [--browser <path>]`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")

interface Probe {
    readonly name: string
    readonly selector: string
    readonly property: string
    /** The token the part must paint with. */
    readonly token: string
    /** The token a family paints with instead, where its look differs by design. */
    readonly familyToken?: Readonly<Partial<Record<"core" | "offset-pop", string>>>
    /** A fixed computed value the part must hold whatever the theme, where a law fixes it (no token is painted). */
    readonly fixed?: string
}

interface ReactDomServer {
    renderToStaticMarkup(node: ReactNode): string
}

type Part = ComponentType<Record<string, unknown>>

interface GrammarModule {
    readonly GrammarRoot: Part
    readonly Button: Part
    readonly Badge: Part
    readonly Text: Part
    readonly SurfaceCard: Part
    readonly Input: Part
    readonly Link: Part
    readonly Heading: Part
    readonly StatusDot: Part
}

interface Row {
    readonly name: string
    readonly actual?: string
    readonly expected?: string
    readonly token?: string
    readonly part?: string
    readonly missing?: true
}

const PROBES: readonly Probe[] = [
    { name: "root ink", selector: ".grammar-common-root", property: "color", token: "--foreground" },
    { name: "root canvas", selector: ".grammar-common-root", property: "background-color", token: "--background" },
    { name: "primary button fill", selector: '[data-component="Button"]', property: "background-color", token: "--accent" },
    { name: "primary button ink", selector: '[data-component="Button"]', property: "color", token: "--accent-foreground" },
    { name: "card surface", selector: ".starci-core-surface", property: "background-color", token: "--surface" },
    { name: "muted text", selector: '[data-component="Text"][data-tone="muted"]', property: "color", token: "--muted" },
    { name: "accent badge ink", selector: '[data-component="Badge"][data-tone="accent"]', property: "color", token: "--accent-soft-foreground", familyToken: { "offset-pop": "--foreground" } },
    { name: "success badge ink", selector: '[data-component="Badge"][data-tone="success"]', property: "color", token: "--success-soft-foreground", familyToken: { "offset-pop": "--foreground" } },
    { name: "success badge tint", selector: '[data-component="Badge"][data-tone="success"]', property: "background-color", token: "--success-soft" },
    { name: "danger badge ink", selector: '[data-component="Badge"][data-tone="danger"]', property: "color", token: "--danger-soft-foreground", familyToken: { "offset-pop": "--foreground" } },
    { name: "danger badge tint", selector: '[data-component="Badge"][data-tone="danger"]', property: "background-color", token: "--danger-soft" },
    // A text link is the exact brand --accent, underlined, and no contrast law judges it: the token the theme proves it paints.
    { name: "link", selector: ".starci-core-link", property: "color", token: "--accent", familyToken: { "offset-pop": "--foreground" } },
    { name: "heading", selector: '[data-component="Heading"]', property: "color", token: "--foreground" },
    { name: "status dot ring", selector: ".starci-core-status-dot-mark", property: "border-top-color", token: "--success" },
    { name: "field fill", selector: "[data-slot='input']", property: "background-color", token: "--field-background" },
    // OVERFLOW-6: no scroller under the family root shows a bar, in every theme, so the proof holds the hidden bar, not a colour.
    { name: "scrollbar hidden", selector: ".grammar-common-root", property: "scrollbar-width", token: "--scrollbar", fixed: "none" },
]

const flag = (name: string): string | undefined => {
    const at = process.argv.indexOf(name)
    return at < 0 ? undefined : process.argv[at + 1]
}

const BROWSERS = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

const browser = flag("--browser") ?? process.env["STARCI_BROWSER"] ?? BROWSERS.find((candidate) => existsSync(candidate))
if (browser === undefined) throw new Error("no Chromium browser: name one with --browser or STARCI_BROWSER")

const importModule = async <T,>(specifier: string): Promise<T> => await import(specifier)
const server = await importModule<ReactDomServer>("react-dom/server")

type Family = "core" | "offset-pop"
type Scenario = "app" | "default" | "override"

const markup = async (family: Family): Promise<string> => {
    const G = await importModule<GrammarModule>(pathToFileURL(join(root, "dist", family, "index.js")).href)
    return server.renderToStaticMarkup(
        createElement(
            G.GrammarRoot,
            { "data-grammar-family": family },
            createElement(G.Input, { id: "email", name: "email", label: "Email", kind: "email" }),
            createElement(G.Button, { intent: "commit" }, "Save"),
            createElement(
                G.SurfaceCard,
                { label: "Overview" },
                createElement(G.Text, { tone: "muted" }, "A muted line"),
                createElement(G.Badge, { tone: "accent" }, "New"),
                createElement(G.Badge, { tone: "success" }, "Paid"),
                createElement(G.Badge, { tone: "danger" }, "Late"),
                createElement(G.Link, { href: "/docs" }, "Read more"),
                createElement(G.Heading, { level: 3 }, "A heading"),
                createElement(G.StatusDot, { tone: "success", "aria-label": "Running" }),
            ),
        ),
    )
}

/** Runs after the page and its stylesheets load; returns the measured colours without waiting for Chromium to exit. */
const measure = (probes: readonly Probe[]): readonly Row[] => {
    const root = document.querySelector(".grammar-common-root")
    if (root === null) throw new Error("the page has no Grammar root")
    const missingSheets = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter((link) => link.sheet === null)
    if (missingSheets.length > 0) throw new Error(`stylesheets did not load: ${missingSheets.map((link) => link.href).join(", ")}`)
    const used = (token: string, property: string): string => {
        const el = document.createElement("i")
        el.style.setProperty(property, `var(${token})`)
        root.appendChild(el)
        const value = getComputedStyle(el).getPropertyValue(property).trim()
        el.remove()
        return value
    }
    return probes.map((probe) => {
        const el = document.querySelector(probe.selector)
        if (el === null) return { name: probe.name, missing: true }
        const actual = getComputedStyle(el).getPropertyValue(probe.property).trim()
        const expected = probe.fixed ?? used(probe.token, probe.property)
        return { name: probe.name, actual, expected, token: probe.token, part: `${el.tagName.toLowerCase()}.${String(el.className).replaceAll(" ", ".")}` }
    })
}

const url = (path: string): string => pathToFileURL(path).href

const page = (family: Family, scenario: Scenario, mode: "light" | "dark", body: string, work: string): string => `<!doctype html>
<html class="${mode === "dark" ? "dark" : ""}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${url(join(root, "node_modules/@heroui/styles/dist/heroui.min.css"))}">
<link rel="stylesheet" href="${url(join(root, "dist", family, "styles.css"))}">
${scenario === "app" ? `<link rel="stylesheet" href="${url(join(work, "app-theme.css"))}">` : `<link rel="stylesheet" href="${url(join(root, "dist", family, "theme.css"))}">`}
<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>
${scenario === "override" ? "<style>:root { --accent: rgb(10 20 200); --accent-foreground: rgb(255 255 224); }</style>" : ""}
</head><body>${body}</body></html>`

const TIMEOUT_MS = 30_000
const work = mkdtempSync(join(tmpdir(), "theme-proof-"))
let engine: Browser | undefined
let failures = 0
try {
    copyFileSync(join(here, "theme-proof", "app-theme.css"), join(work, "app-theme.css"))
    engine = await chromium.launch({ executablePath: browser, headless: true, chromiumSandbox: process.getuid?.() !== 0, timeout: TIMEOUT_MS })
    const context = await engine.newContext()
    const rendered = await context.newPage()
    rendered.setDefaultTimeout(TIMEOUT_MS)
    rendered.setDefaultNavigationTimeout(TIMEOUT_MS)
    for (const family of ["core", "offset-pop"] as const) {
        const body = await markup(family)
        for (const scenario of ["app", "default", "override"] as const) {
            for (const mode of ["light", "dark"] as const) {
                const file = join(work, `${family}-${scenario}-${mode}.html`)
                writeFileSync(file, page(family, scenario, mode, body, work))
                const label = `${family} ${scenario} ${mode}`
                console.log(`theme proof: measuring ${label}`)
                let rows: readonly Row[]
                try {
                    await rendered.goto(url(file), { waitUntil: "load" })
                    rows = await rendered.evaluate(measure, PROBES.map((probe) => ({ ...probe, token: probe.familyToken?.[family] ?? probe.token })))
                } catch (error) {
                    throw new Error(`theme proof: ${label} could not be measured (${file})`, { cause: error })
                }
                for (const row of rows) {
                    const part = `${label} ${row.name}`
                    // The override scenario changes the accent only: the other parts stay on the family defaults.
                    const compared = scenario !== "override" || row.token === "--accent" || row.token === "--accent-foreground"
                    if (row.missing === true || row.actual === undefined || row.expected === undefined) {
                        failures += 1
                        console.log(`FAIL ${part}: the part is not on the page`)
                    } else if (compared && row.actual !== row.expected) {
                        failures += 1
                        console.log(`FAIL ${part}: ${row.part ?? "the part"} painted ${row.actual}, ${row.token ?? "the token"} is ${row.expected}`)
                    } else console.log(`ok   ${part}: ${row.actual}`)
                }
            }
        }
    }
    await context.close()
} finally {
    try {
        await engine?.close()
    } finally {
        rmSync(work, { recursive: true, force: true })
    }
}
console.log(failures === 0 ? "theme proof: every part follows the theme" : `theme proof: ${failures} part(s) did not follow`)
process.exitCode = failures === 0 ? 0 : 1

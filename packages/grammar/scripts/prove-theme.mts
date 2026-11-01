import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createElement, type ComponentType, type ReactNode } from "react"

/**
 * Proves that an app sets its own theme: a test app that sets HeroUI's tokens and nothing else (`theme-proof/app-theme.css`)
 * renders the built grammar in both families and both modes, and every part follows, measured by computed style in a
 * headless Chromium (no dev server). A second scenario renders each family on its own `theme.css` defaults, and a third
 * overrides one token over those defaults. Run after `npm run build`: `node scripts/prove-theme.mts [--browser <path>]`.
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
    { name: "link", selector: ".starci-core-link", property: "color", token: "--link", familyToken: { "offset-pop": "--foreground" } },
    { name: "heading", selector: '[data-component="Heading"]', property: "color", token: "--foreground" },
    { name: "status dot", selector: ".starci-core-status-dot-mark", property: "background-color", token: "--success" },
    { name: "field fill", selector: "[data-slot='input']", property: "background-color", token: "--field-background" },
    { name: "scrollbar", selector: ".grammar-common-root", property: "scrollbar-color", token: "--scrollbar" },
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

/** Runs in the page: the colour a part paints against the colour its token resolves to on that part's root. */
const script = (family: Family): string => `
const probes = ${JSON.stringify(PROBES.map((probe) => ({ ...probe, token: probe.familyToken?.[family] ?? probe.token })))};
const root = document.querySelector('.grammar-common-root');
const used = (token, property) => {
    const el = document.createElement('i');
    el.style.setProperty(property, 'var(' + token + ')');
    root.appendChild(el);
    const value = getComputedStyle(el).getPropertyValue(property).trim();
    el.remove();
    return value;
};
const rows = probes.map((probe) => {
    const el = document.querySelector(probe.selector);
    if (!el) return { name: probe.name, missing: true };
    const actual = getComputedStyle(el).getPropertyValue(probe.property).trim();
    const expected = probe.property === 'scrollbar-color' ? used(probe.token, 'color') + ' ' + used('--scrollbar-track', 'color') : used(probe.token, probe.property);
    return { name: probe.name, actual, expected, token: probe.token, part: el.tagName.toLowerCase() + '.' + String(el.className).replace(/ /g, '.') };
});
document.getElementById('proof').textContent = JSON.stringify({ rows });
`

const url = (path: string): string => pathToFileURL(path).href

const page = (family: Family, scenario: Scenario, mode: "light" | "dark", body: string, work: string): string => `<!doctype html>
<html class="${mode === "dark" ? "dark" : ""}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${url(join(root, "node_modules/@heroui/styles/dist/heroui.min.css"))}">
<link rel="stylesheet" href="${url(join(root, "dist", family, "styles.css"))}">
${scenario === "app" ? `<link rel="stylesheet" href="${url(join(work, "app-theme.css"))}">` : `<link rel="stylesheet" href="${url(join(root, "dist", family, "theme.css"))}">`}
<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>
${scenario === "override" ? "<style>:root { --accent: rgb(10 20 200); --accent-foreground: rgb(255 255 224); }</style>" : ""}
</head><body>${body}<pre id="proof"></pre><script>${script(family)}</script></body></html>`

const decode = (text: string): string => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

// Chrome refuses to start as root (the CI container) without this; the pages are the proof's own files.
const sandbox = process.getuid?.() === 0 ? ["--no-sandbox"] : []
const work = mkdtempSync(join(tmpdir(), "theme-proof-"))
const lines: string[] = []
let failures = 0
try {
    mkdirSync(join(work, "profile"))
    copyFileSync(join(here, "theme-proof", "app-theme.css"), join(work, "app-theme.css"))
    for (const family of ["core", "offset-pop"] as const) {
        const body = await markup(family)
        for (const scenario of ["app", "default", "override"] as const) {
            for (const mode of ["light", "dark"] as const) {
                const file = join(work, `${family}-${scenario}-${mode}.html`)
                writeFileSync(file, page(family, scenario, mode, body, work))
                const dom = execFileSync(browser, ["--headless=new", ...sandbox, "--disable-gpu", "--no-first-run", `--user-data-dir=${join(work, "profile")}`, "--virtual-time-budget=3000", "--dump-dom", url(file)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
                const found = /<pre id="proof">([\s\S]*?)<\/pre>/.exec(dom)?.[1]
                if (found === undefined || found === "") throw new Error(`${family} ${scenario} ${mode}: the page produced no result`)
                const rows = (JSON.parse(decode(found)) as { rows: Row[] }).rows
                for (const row of rows) {
                    const label = `${family} ${scenario} ${mode} ${row.name}`
                    // The override scenario changes the accent only: the other parts stay on the family defaults.
                    const compared = scenario !== "override" || row.token === "--accent" || row.token === "--accent-foreground"
                    if (row.missing === true || row.actual === undefined || row.expected === undefined) {
                        failures += 1
                        lines.push(`FAIL ${label}: the part is not on the page`)
                    } else if (compared && row.actual !== row.expected) {
                        failures += 1
                        lines.push(`FAIL ${label}: ${row.part ?? "the part"} painted ${row.actual}, ${row.token ?? "the token"} is ${row.expected}`)
                    } else lines.push(`ok   ${label}: ${row.actual}`)
                }
            }
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true })
}
console.log(lines.join("\n"))
console.log(failures === 0 ? "theme proof: every part follows the theme" : `theme proof: ${failures} part(s) did not follow`)
process.exitCode = failures === 0 ? 0 : 1

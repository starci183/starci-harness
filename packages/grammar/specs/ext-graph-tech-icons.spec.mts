/**
 * The built-in tech logos of MermaidDiagram (owner 2026-11-26): every logo is one aria-hidden mark in the current colour, its chip sets that colour to
 * the brand's hex where it keeps 3:1 on the chip in the theme in force and leaves the node's ink under it (Express black on a dark chip), a node's
 * `R@{ icon: "name" }` finds its logo in \`techIcons\`, a name nothing draws stays out of the map (the node then takes no room for it), and an app's own
 * icon wins over a built-in of the same name.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-graph-tech-icons.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { JSDOM } from "jsdom"
import { parseDiagram } from "../src/core/ext/graph/diagram/mermaid.ts"
import type { DiagramGraph, ParsedDiagram } from "../src/core/ext/graph/diagram/model.ts"
import { LogoChip, brandColorOf, techIconColors, techIcons, withTechIcons } from "../src/core/ext/graph/diagram/techIcons.tsx"
import { TECH_ICON_HEX, TECH_ICON_PATHS } from "../src/core/ext/graph/diagram/techIconPaths.ts"
import { LOGO_CONTRAST, contrastRatio, logoFill, parseCssColor } from "../src/core/ext/graph/diagram/logoInk.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
const borrowed = ["window", "document", "navigator", "DOMParser", "Element", "HTMLElement", "SVGElement", "Node"] as const

before(() => {
    const page = dom.window as unknown as Record<string, unknown>
    for (const name of borrowed) Object.defineProperty(globalThis, name, { value: name === "window" ? dom.window : page[name], configurable: true, writable: true })
})

after(() => {
    for (const name of borrowed) Reflect.deleteProperty(globalThis, name)
    dom.window.close()
})

const markup = (name: string): string => renderToStaticMarkup(createElement("span", null, techIcons[name]))

const NAMES = ["postgresql", "mongodb", "mysql", "redis", "express", "nestjs", "nodedotjs", "docker", "kubernetes", "rabbitmq", "apachekafka", "nginx", "graphql", "typescript", "javascript", "go", "python", "react", "nextdotjs", "elasticsearch", "minio"]

describe("techIcons", () => {
    it("has a logo for every built-in name, the generic database and service, and none for a name nothing draws", () => {
        for (const name of [...NAMES, "database", "service"]) assert.ok(techIcons[name] !== undefined, `${name} has a mark`)
        assert.equal(techIcons["amazons3"], undefined)
        assert.equal(techIcons["no-such-logo"], undefined)
        assert.deepEqual(Object.keys(TECH_ICON_PATHS).sort(), [...NAMES].sort())
    })

    it("draws each mark in the current colour, hidden from a screen reader: the chip it stands in chooses that colour", () => {
        for (const name of Object.keys(techIcons)) {
            const html = markup(name)
            assert.match(html, /<svg [^>]*aria-hidden="true"/u, name)
            assert.match(html, /currentColor/u, name)
            assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/u, `${name} carries no colour of its own`)
        }
        assert.equal(markup("postgres"), markup("postgresql"))
    })

    it("knows every brand's official colour, simple-icons' hex, aliases included; the generic marks have none", () => {
        assert.deepEqual(Object.keys(TECH_ICON_HEX).sort(), [...NAMES].sort())
        for (const name of NAMES) assert.match(techIconColors[name] ?? "", /^#[0-9A-F]{6}$/u, name)
        assert.equal(techIconColors["postgresql"], "#4169E1")
        assert.equal(techIconColors["redis"], "#FF4438")
        assert.equal(techIconColors["express"], "#0A0A0A")
        assert.equal(techIconColors["postgres"], techIconColors["postgresql"])
        assert.equal(techIconColors["database"], undefined)
        assert.equal(techIconColors["service"], undefined)
        // The app's own art for a name keeps its own colours: no brand colour is laid over it.
        assert.equal(brandColorOf("redis", undefined), "#FF4438")
        assert.equal(brandColorOf("redis", { redis: createElement("i") }), undefined)
        assert.equal(brandColorOf(undefined, undefined), undefined)
    })

    it("fills the logo chip with the brand colour it is given, and leaves the ink when it is given none", () => {
        const coloured = renderToStaticMarkup(createElement(LogoChip, { icon: techIcons["postgresql"], color: "#4169E1" }))
        assert.match(coloured, /^<span class="starci-graph-diagram-chip starci-graph-diagram-icon" data-logo-fill="brand" aria-hidden="true" style="color:#4169E1">/u)
        const ink = renderToStaticMarkup(createElement(LogoChip, { icon: techIcons["express"] }))
        assert.match(ink, /data-logo-fill="ink"/u)
        assert.doesNotMatch(ink, /style=/u)
    })
})

/** The logo chip of the core family in light and in dark (5% ink over the surface), as a browser computes its `color-mix(in oklab, …)`. */
const LIGHT_CHIP = "oklab(0.96 0 0)"
const DARK_CHIP = "oklab(0.25 0 0)"

describe("logo colour and its contrast fallback", () => {
    it("reads the colours a browser computes for the tokens: hex, rgb, color(srgb), oklab, oklch", () => {
        assert.deepEqual(parseCssColor("#fff"), [255, 255, 255])
        assert.deepEqual(parseCssColor("#4169E1"), [65, 105, 225])
        assert.deepEqual(parseCssColor("rgb(10, 20, 30)"), [10, 20, 30])
        assert.deepEqual(parseCssColor("rgba(10 20 30 / 50%)"), [10, 20, 30])
        assert.deepEqual(parseCssColor("color(srgb 1 0 0)"), [255, 0, 0])
        const white = parseCssColor("oklab(1 0 0)")
        assert.ok(white !== null && white.every((channel) => Math.abs(channel - 255) < 1), "oklab white")
        const black = parseCssColor("oklch(0 0 0)")
        assert.ok(black !== null && black.every((channel) => Math.abs(channel) < 1), "oklch black")
        assert.equal(parseCssColor("var(--surface)"), null)
    })

    it("measures the WCAG contrast", () => {
        assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21)
        assert.equal(contrastRatio([128, 128, 128], [128, 128, 128]), 1)
    })

    it("fills a logo with its brand colour where it keeps 3:1 on the chip, in light and dark alike", () => {
        const light = parseCssColor(LIGHT_CHIP)
        const dark = parseCssColor(DARK_CHIP)
        for (const name of ["redis", "nestjs", "postgresql", "nginx", "graphql", "typescript"]) {
            assert.equal(logoFill(techIconColors[name], light), techIconColors[name], `${name} light`)
            assert.equal(logoFill(techIconColors[name], dark), techIconColors[name], `${name} dark`)
        }
        assert.equal(logoFill(techIconColors["postgresql"], light), "#4169E1")
    })

    it("falls back to the ink under 3:1: black brands on a dark chip, pale brands on a light one", () => {
        const light = parseCssColor(LIGHT_CHIP)
        const dark = parseCssColor(DARK_CHIP)
        // Express and Next.js are black: brand on the light chip, the ink on the dark one.
        for (const name of ["express", "nextdotjs", "apachekafka"]) {
            assert.equal(logoFill(techIconColors[name], light), techIconColors[name], `${name} light`)
            assert.equal(logoFill(techIconColors[name], dark), undefined, `${name} dark falls back to the ink`)
        }
        // React and JavaScript are pale: the ink on the light chip, brand on the dark one.
        for (const name of ["react", "javascript"]) {
            assert.equal(logoFill(techIconColors[name], light), undefined, `${name} light falls back to the ink`)
            assert.equal(logoFill(techIconColors[name], dark), techIconColors[name], `${name} dark`)
        }
        for (const [name, hex] of Object.entries(techIconColors)) {
            const brand = parseCssColor(hex)
            assert.ok(brand !== null && light !== null && dark !== null)
            assert.equal(logoFill(hex, light) !== undefined, contrastRatio(brand, light) >= LOGO_CONTRAST, `${name} light`)
            assert.equal(logoFill(hex, dark) !== undefined, contrastRatio(brand, dark) >= LOGO_CONTRAST, `${name} dark`)
        }
    })

    it("keeps the ink while the chip's colour is unknown, so a logo never flashes a colour it would not keep", () => {
        assert.equal(logoFill("#0A0A0A", null), undefined)
        assert.equal(logoFill(undefined, [255, 255, 255]), undefined)
    })

    it("lets an app's own icon win over a built-in of the same name and add its own", () => {
        const own = createElement("i", null, "mine")
        const merged = withTechIcons({ redis: own, cache: own })
        assert.equal(merged["redis"], own)
        assert.equal(merged["cache"], own)
        assert.equal(merged["postgresql"], techIcons["postgresql"])
        assert.equal(withTechIcons(undefined)["redis"], techIcons["redis"])
    })

    it("is read from the name a node gives with `X@{ icon: name }`, a subgraph included", async () => {
        const parsed: ParsedDiagram = await parseDiagram(`flowchart LR
  subgraph D["Docker trên máy bạn"]
    O[orders]
    P[(Postgres)]
  end
  O@{ icon: "express" }
  P@{ icon: "postgresql" }
  D@{ icon: "docker" }
  O --> P`)
        assert.ok(parsed.kind === "flowchart")
        const drawn: DiagramGraph = parsed
        const iconOf = (id: string): string | null => drawn.nodes.find((node) => node.id === id)?.icon ?? null
        assert.deepEqual(["O", "P", "D"].map(iconOf), ["express", "postgresql", "docker"])
        for (const name of ["express", "postgresql", "docker"]) assert.ok(techIcons[name] !== undefined)
    })

    it("is documented where the diagram is", () => {
        const doc = readFileSync(new URL("../../../contexts/ui/components/diagram.md", import.meta.url), "utf8")
        for (const name of [...NAMES, "database", "service"]) assert.ok(doc.includes("`" + name + "`"), `${name} is in diagram.md`)
    })
})

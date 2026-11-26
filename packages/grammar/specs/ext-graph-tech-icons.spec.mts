/**
 * The built-in tech logos of MermaidDiagram (owner 2026-11-26): every logo is one monochrome, aria-hidden mark in the current colour, a node's
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
import { techIcons, withTechIcons } from "../src/core/ext/graph/diagram/techIcons.tsx"
import { TECH_ICON_PATHS } from "../src/core/ext/graph/diagram/techIconPaths.ts"

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

    it("draws each mark in the current colour, hidden from a screen reader, with no brand colour", () => {
        for (const name of Object.keys(techIcons)) {
            const html = markup(name)
            assert.match(html, /<svg [^>]*aria-hidden="true"/u, name)
            assert.match(html, /currentColor/u, name)
            assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/u, `${name} carries no colour of its own`)
        }
        assert.equal(markup("postgres"), markup("postgresql"))
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

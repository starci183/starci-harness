/**
 * MermaidDiagram graph v2 (owner 2026-11-26): what an architecture flowchart says beyond its boxes. A service's port is taken off the end of its label
 * and drawn as a pill; `class X edit` marks the node the learner edits; a node's Mermaid tooltip is its description line; a flowchart's edge is a call
 * (solid, accent) or data (`-.->`, dashed, neutral) and the legend chip shows only when both are there; pointing at or focusing a step lights its
 * neighbourhood. These specs hold the pure mapping and sizes; the stories `TechLogos` and `HoverFocus` play the same in a browser.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-graph-diagram-v2.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { parseDiagram } from "../src/core/ext/graph/diagram/mermaid.ts"
import { EDIT_CLASS, describeDiagram, edgeKind, needsKindLegend, neighbourhood, splitPort, type DiagramGraph, type ParsedDiagram } from "../src/core/ext/graph/diagram/model.ts"
import { EDIT_SIZE, ICON_GAP, ICON_SIZE, extrasWidth, nodeSize, portWidth } from "../src/core/ext/graph/diagram/graph.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
// Mermaid's parser reads the page (DOMPurify, the window) even when it draws nothing.
const borrowed = ["window", "document", "navigator", "DOMParser", "Element", "HTMLElement", "SVGElement", "Node"] as const

before(() => {
    const page = dom.window as unknown as Record<string, unknown>
    for (const name of borrowed) Object.defineProperty(globalThis, name, { value: name === "window" ? dom.window : page[name], configurable: true, writable: true })
})

after(() => {
    for (const name of borrowed) Reflect.deleteProperty(globalThis, name)
    dom.window.close()
})

const graph = (parsed: ParsedDiagram): DiagramGraph => {
    assert.ok(parsed.kind === "flowchart" || parsed.kind === "state", `a graph, not ${parsed.kind}`)
    return parsed
}

const SHOP = `flowchart LR
  K[Khách] --> O[orders :4001]
  O --> P[payments :4002]
  O -.-> OD[(orders db)]
  P -.-> PD[(payments db)]
  P -.-> R[(redis)]
  O@{ icon: "express" }
  P@{ icon: "express" }
  class P edit
  click O call note() "Takes the order, then calls payments"`

describe("a service's port, the edit mark and the description line", () => {
    it("takes a port off the end of a label, on the same line or its own, and leaves other colons alone", () => {
        assert.deepEqual(splitPort("orders :4001"), { label: "orders", port: "4001" })
        assert.deepEqual(splitPort("orders\n:4001"), { label: "orders", port: "4001" })
        assert.deepEqual(splitPort("orders"), { label: "orders" })
        assert.deepEqual(splitPort(":4001"), { label: ":4001" })
        assert.deepEqual(splitPort("Ratio 1:2"), { label: "Ratio 1:2" })
        assert.deepEqual(splitPort("time 10:30"), { label: "time 10:30" })
    })

    it("maps them from the source: the port off the label, `class P edit`, the tooltip of `click`", async () => {
        const drawn = graph(await parseDiagram(SHOP))
        const node = (id: string) => drawn.nodes.find((each) => each.id === id)
        assert.equal(EDIT_CLASS, "edit")
        assert.deepEqual([node("O")?.label, node("O")?.port, node("O")?.edit, node("O")?.description], ["orders", "4001", undefined, "Takes the order, then calls payments"])
        assert.deepEqual([node("P")?.label, node("P")?.port, node("P")?.edit, node("P")?.description], ["payments", "4002", true, undefined])
        assert.equal(node("OD")?.port, undefined)
        // A decision keeps its words whole, colon and all.
        const decided = graph(await parseDiagram("flowchart TB\n  A{Port :80?} --> B[web :80]"))
        assert.deepEqual(decided.nodes.map((each) => [each.label, each.port ?? null]), [["Port :80?", null], ["web", "80"]])
    })

    it("names them in the text version: the port, the edit mark in the app's words and the description", async () => {
        const { items } = describeDiagram(graph(await parseDiagram(SHOP)), "to", "you edit this")
        assert.ok(items.includes("orders :4001: Takes the order, then calls payments"), items.join(" | "))
        assert.ok(items.includes("payments :4002 (you edit this)"), items.join(" | "))
    })

    it("widens the node by the chip, the pill and the edit chip, each a gap apart, and keeps its height", () => {
        const width = (text: string): number => text.length * 7
        const bare = { id: "O", label: "orders service", shape: "box" as const }
        const plain = nodeSize(bare, "LR", width)
        const full = nodeSize({ ...bare, icon: "express", port: "4001", edit: true }, "LR", width)
        assert.equal(ICON_SIZE, 26)
        assert.equal(full.width - plain.width, ICON_SIZE + ICON_GAP + portWidth("4001", width) + ICON_GAP + EDIT_SIZE + ICON_GAP)
        assert.equal(extrasWidth({ ...bare, port: "4001" }, width), portWidth("4001", width) + ICON_GAP)
        assert.equal(full.height, plain.height)
        // A container, a bar and a start or end mark take no extras.
        assert.equal(extrasWidth({ id: "G", label: "group", shape: "container", icon: "docker" }, width), 0)
    })

    it("draws a store rounder than a service: deep caps on a tinted cylinder", () => {
        const width = (text: string): number => text.length * 7
        const store = nodeSize({ id: "D", label: "orders db", shape: "cylinder" }, "LR", width)
        const service = nodeSize({ id: "S", label: "orders db", shape: "box" }, "LR", width)
        assert.ok(store.height >= 72 && store.height > service.height)
        const sheet = readFileSync(new URL("../src/core/ext/graph/diagram/styles.css", import.meta.url), "utf8")
        assert.match(sheet, /\.starci-graph-diagram-node\[data-shape="cylinder"\] \{\s*--starci-graph-diagram-fill: var\(--starci-graph-diagram-store-fill\);/u)
        assert.match(sheet, /\.starci-graph-diagram-lid \{[^}]*fill: var\(--starci-graph-diagram-store-lid\)/u)
        assert.match(sheet, /\.starci-graph-diagram-chip\.starci-graph-diagram-edit \{[^}]*background: var\(--accent-soft\)/u)
    })
})

describe("calls and data", () => {
    it("a plain link is a call, a dotted one data; a loop's back edge returns along the calls", async () => {
        const drawn = graph(await parseDiagram(SHOP))
        assert.deepEqual(drawn.edges.map(edgeKind), ["call", "call", "data", "data", "data"])
        assert.equal(edgeKind({ id: "b", source: "A", target: "B", dashed: true, thick: false, back: true }), "call")
    })

    it("shows the legend chip only when a flowchart has both kinds", async () => {
        assert.equal(needsKindLegend(graph(await parseDiagram(SHOP))), true)
        assert.equal(needsKindLegend(graph(await parseDiagram("flowchart LR\n  A --> B\n  B --> C"))), false)
        assert.equal(needsKindLegend(graph(await parseDiagram("flowchart LR\n  A -.-> B\n  B -.-> C"))), false)
        // A state diagram's transitions are neither: no legend.
        assert.equal(needsKindLegend(graph(await parseDiagram("stateDiagram-v2\n  [*] --> A\n  A --> B"))), false)
    })

    it("paints a call solid in the accent and data dashed in the neutral, under any tone", () => {
        const sheet = readFileSync(new URL("../src/core/ext/graph/diagram/styles.css", import.meta.url), "utf8")
        assert.match(sheet, /\.react-flow__edge\.starci-graph-diagram-edge--call \{\s*color: var\(--accent\);/u)
        assert.match(sheet, /\.react-flow__edge\.starci-graph-diagram-edge--data \{\s*color: var\(--muted\);/u)
        assert.match(sheet, /\.starci-graph-diagram-edge--data \.react-flow__edge-path \{\s*stroke-dasharray/u)
        // The tones come after the kinds, so a toned edge keeps its tone.
        assert.ok(sheet.indexOf("starci-graph-diagram-edge--call {") < sheet.indexOf("starci-graph-diagram-edge--danger {"))
    })
})

describe("hover focus", () => {
    it("lights the node, the nodes one edge away and the edges between them", async () => {
        const drawn = graph(await parseDiagram(SHOP))
        const payments = neighbourhood(drawn, "P")
        assert.deepEqual([...payments.nodes].sort(), ["O", "P", "PD", "R"])
        assert.deepEqual([...payments.edges].sort(), ["e2", "e4", "e5"])
        const customer = neighbourhood(drawn, "K")
        assert.deepEqual([...customer.nodes].sort(), ["K", "O"])
        assert.deepEqual([...customer.edges], ["e1"])
    })

    it("is drawn for pointer and keyboard alike, and the fade stops under reduced motion", () => {
        const sheet = readFileSync(new URL("../src/core/ext/graph/diagram/styles.css", import.meta.url), "utf8")
        assert.match(sheet, /\.react-flow__node\.starci-graph-diagram-dim/u)
        assert.match(sheet, /starci-graph-diagram-node\[role="button"\]:focus-visible \{[^}]*outline/u)
        assert.match(sheet, /@media \(prefers-reduced-motion: reduce\) \{[^@]*transition: none;/u)
        const component = readFileSync(new URL("../src/core/ext/graph/diagram/MermaidDiagram.tsx", import.meta.url), "utf8")
        for (const handler of ["onNodeMouseEnter", "onNodeMouseLeave", "onNodeClick", "onFocus", "onBlur", "onKeyDown"]) assert.ok(component.includes(`${handler}:`), handler)
    })
})

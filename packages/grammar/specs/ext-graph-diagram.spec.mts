/**
 * MermaidDiagram on the graph canvas (owner 2026-11-23): Mermaid's own parser reads the source and the graph ext draws it. These specs hold the
 * mapping from Mermaid's database to what the canvas lays out (a flowchart and a state diagram as a graph, a sequence as its rows in order), the
 * sequence layout (rows top to bottom in the order written, a message between its two lifelines, a block round its rows) and the text version.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-graph-diagram.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { parseDiagram } from "../src/core/ext/graph/diagram/mermaid.ts"
import { describeDiagram, plainLabel, type DiagramGraph, type ParsedDiagram, type SequenceModel } from "../src/core/ext/graph/diagram/model.ts"
import { layoutSequence } from "../src/core/ext/graph/diagram/sequence.ts"
import { layoutDiagram } from "../src/core/ext/graph/diagram/graph.ts"
import { STRAIGHT_SNAP, estimateLabel } from "../src/core/ext/graph/layout.ts"
import { openView } from "../src/core/ext/graph/shared/view.ts"
import { dedupeRuns, overlaps } from "../src/core/ext/graph/shared/overlap.ts"
import { layoutFlow } from "../src/core/ext/graph/layout.ts"
import { resolveFlow } from "../src/core/ext/graph/model.ts"
import type { FlowNode, GraphEdge } from "../src/core/ext/graph/types.ts"

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
const sequence = (parsed: ParsedDiagram): SequenceModel => {
    assert.equal(parsed.kind, "sequence")
    return parsed as SequenceModel
}
const node = (drawn: DiagramGraph, id: string) => {
    const found = drawn.nodes.find((each) => each.id === id)
    assert.ok(found !== undefined, `node ${id}`)
    return found
}

describe("flowchart to graph", () => {
    it("maps every vertex to its shape, every link to an edge with its words, and keeps the direction", async () => {
        const drawn = graph(
            await parseDiagram(`flowchart LR
  A[Client] -->|request| B{Gate}
  B -.-> C[(Orders)]
  B ==> D((Done))
  D --> E([Reply])
  E --> F(Round)`),
        )
        assert.equal(drawn.kind, "flowchart")
        assert.equal(drawn.direction, "LR")
        assert.deepEqual(
            drawn.nodes.map((each) => [each.id, each.label, each.shape]),
            [
                ["A", "Client", "box"],
                ["B", "Gate", "diamond"],
                ["C", "Orders", "cylinder"],
                ["D", "Done", "circle"],
                ["E", "Reply", "stadium"],
                ["F", "Round", "round"],
            ],
        )
        assert.deepEqual(
            drawn.edges.map((edge) => [edge.source, edge.target, edge.label ?? null, edge.dashed, edge.thick]),
            [
                ["A", "B", "request", false, false],
                ["B", "C", null, true, false],
                ["B", "D", null, false, true],
                ["D", "E", null, false, false],
                ["E", "F", null, false, false],
            ],
        )
    })

    it("draws RL across and BT and TD down", async () => {
        assert.equal(graph(await parseDiagram("flowchart RL\n  A --> B")).direction, "LR")
        assert.equal(graph(await parseDiagram("graph BT\n  A --> B")).direction, "TB")
        assert.equal(graph(await parseDiagram("graph TD\n  A --> B")).direction, "TB")
    })

    it("puts each subgraph's nodes in its container, the innermost one when subgraphs nest", async () => {
        const drawn = graph(
            await parseDiagram(`flowchart TB
  subgraph Outer [Server side]
    A[Api]
    subgraph Inner [Storage]
      B[(Db)]
    end
  end
  C[Client] --> A
  A --> B`),
        )
        assert.equal(node(drawn, "Outer").shape, "container")
        assert.equal(node(drawn, "Outer").label, "Server side")
        assert.equal(node(drawn, "Inner").parentId, "Outer")
        assert.equal(node(drawn, "A").parentId, "Outer")
        assert.equal(node(drawn, "B").parentId, "Inner")
        assert.equal(node(drawn, "C").parentId, undefined)
    })

    it("tones a node by `class X danger|success|accent` and by the tones map, the map first; a class outside the tones paints nothing", async () => {
        const drawn = graph(
            await parseDiagram(
                `flowchart LR
  A --> B --> C --> D
  classDef danger fill:#f00
  class A danger
  class B accent
  class D fancy`,
                { B: "success", C: "danger" },
            ),
        )
        assert.equal(node(drawn, "A").tone, "danger")
        assert.equal(node(drawn, "B").tone, "success")
        assert.equal(node(drawn, "C").tone, "danger")
        assert.equal(node(drawn, "D").tone, undefined)
    })

    it("reads a label's words as plain text: a <br> breaks the line, markdown quotes and tags drop", () => {
        assert.equal(plainLabel("Read<br/>the price"), "Read\nthe price")
        assert.equal(plainLabel("\"`**Bold** words`\""), "Bold words")
        assert.equal(plainLabel("<b>tag</b> #quot;quoted#quot;"), "tag \"quoted\"")
    })

    it("refuses a source Mermaid refuses", async () => {
        await assert.rejects(parseDiagram("flowchart LR\n  A --> {"))
    })
})

describe("state diagram to graph", () => {
    it("maps states, start and end marks, a composite state as a container, transitions with their words, and tones", async () => {
        const drawn = graph(
            await parseDiagram(
                `stateDiagram-v2
  [*] --> Idle
  Idle --> Busy: start
  Busy --> Idle: done
  state Busy {
    [*] --> Work
    Work --> [*]
  }
  Busy --> Stale: late write
  Stale --> [*]
  Idle : Waiting for work
  class Stale danger`,
                { Idle: "accent" },
            ),
        )
        assert.equal(drawn.kind, "state")
        assert.equal(drawn.direction, "TB")
        assert.equal(node(drawn, "Busy").shape, "container")
        assert.equal(node(drawn, "Work").parentId, "Busy")
        assert.equal(node(drawn, "Idle").label, "Waiting for work")
        assert.equal(node(drawn, "Idle").shape, "round")
        assert.equal(node(drawn, "Idle").tone, "accent")
        assert.equal(node(drawn, "Stale").tone, "danger")
        assert.deepEqual(drawn.nodes.filter((each) => each.shape === "start").map((each) => each.parentId ?? null).sort(), ["Busy", null].sort())
        assert.equal(drawn.nodes.filter((each) => each.shape === "end").length, 2)
        assert.ok(drawn.nodes.filter((each) => each.shape === "start" || each.shape === "end").every((each) => each.label === ""))
        const transitions = drawn.edges.map((edge) => [edge.source, edge.target, edge.label ?? null])
        assert.ok(transitions.some(([from, to, words]) => from === "Idle" && to === "Busy" && words === "start"))
        assert.ok(transitions.some(([from, to, words]) => from === "Busy" && to === "Stale" && words === "late write"))
    })
})

const BLOCKS = `sequenceDiagram
  autonumber
  participant C as Customer
  actor S as Shop
  participant Q
  C->>S: Pays
  Note over C,S: paid in full
  alt in stock
    S->>Q: Queue delivery
    Q-->>S: Queued
  else sold out
    S--xC: Sold out
  end
  loop every 5s
    S->>S: Check stock
  end
  Note left of Q: runs in the background
  C-)S: Thanks`

describe("sequence to rows in the order written", () => {
    it("keeps the participants in the order met, their aliases as names and actors marked", async () => {
        const model = sequence(await parseDiagram(BLOCKS))
        assert.deepEqual(
            model.participants.map((each) => [each.id, each.label, each.kind]),
            [
                ["C", "Customer", "participant"],
                ["S", "Shop", "actor"],
                ["Q", "Q", "participant"],
            ],
        )
        assert.equal(model.numbered, true)
    })

    it("lists messages, notes and block rows in source order, each message with its place from 1, reply and head", async () => {
        const model = sequence(await parseDiagram(BLOCKS, undefined, { 4: "danger", 6: "success" }))
        const rows = model.rows.map((row) => {
            if (row.kind === "message") return `m${String(row.index)} ${row.from}>${row.to} ${row.text}${row.reply ? " reply" : ""} ${row.head}${row.tone === undefined ? "" : ` ${row.tone}`}`
            if (row.kind === "note") return `note ${row.side} ${row.from},${row.to} ${row.text}`
            if (row.kind === "open") return `open ${row.blockKind} ${row.label}`
            if (row.kind === "section") return `section ${row.label}`
            return "close"
        })
        assert.deepEqual(rows, [
            "m1 C>S Pays arrow",
            "note over C,S paid in full",
            "open alt in stock",
            "m2 S>Q Queue delivery arrow",
            "m3 Q>S Queued reply arrow",
            "section sold out",
            "m4 S>C Sold out reply cross danger",
            "close",
            "open loop every 5s",
            "m5 S>S Check stock arrow",
            "close",
            "note left Q,Q runs in the background",
            "m6 C>S Thanks arrow success",
        ])
    })

    it("lays the rows out top to bottom in order, each message between its two lifelines, each block round its rows", async () => {
        const model = sequence(await parseDiagram(BLOCKS))
        const layout = layoutSequence(model, (text) => text.length * 7)
        const x = new Map(layout.participants.map((each) => [each.id, each.x] as const))
        assert.ok((x.get("C") ?? 0) < (x.get("S") ?? 0) && (x.get("S") ?? 0) < (x.get("Q") ?? 0), "the columns in the participants' order")
        const ys = layout.messages.map((message) => message.y)
        assert.deepEqual([...ys].sort((a, b) => a - b), ys, "messages top to bottom")
        assert.ok(ys.every((y, index) => index === 0 || y > (ys[index - 1] ?? 0)))
        for (const message of layout.messages) {
            assert.equal(message.x1, x.get(message.row.from))
            assert.equal(message.x2, x.get(message.row.to))
            assert.ok(message.y > layout.lifelineTop && message.y2 < layout.lifelineEnd, "on the lifelines")
            if (message.self) assert.ok(message.y2 > message.y, "a self-message returns lower")
            if (!message.self) assert.ok(Math.abs(message.x2 - message.x1) >= message.text.width, "the words fit between the lifelines")
        }
        const [alt, loop] = layout.fields
        assert.equal(alt?.kind, "alt")
        assert.equal(alt?.sections.length, 1)
        assert.equal(loop?.kind, "loop")
        const inside = (field: typeof alt, index: number): boolean => {
            const message = layout.messages[index]
            return field !== undefined && message !== undefined && message.y > field.box.y && message.y2 < field.box.y + field.box.height && message.x1 >= field.box.x && message.x2 <= field.box.x + field.box.width
        }
        assert.ok(inside(alt, 1) && inside(alt, 2) && inside(alt, 3), "alt holds messages 2 to 4")
        assert.ok(!inside(alt, 0) && !inside(alt, 4), "alt holds no message outside it")
        assert.ok(inside(loop, 4), "loop holds the self-message")
        const divider = alt?.sections[0]?.y ?? 0
        assert.ok((layout.messages[2]?.y ?? 0) < divider && divider < (layout.messages[3]?.y ?? 0), "else divides messages 3 and 4")
        // The notes stand in their rows: the first between messages 1 and 2, the second after the loop.
        assert.ok((layout.notes[0]?.box.y ?? 0) > (layout.messages[0]?.y ?? 0) && (layout.notes[0]?.box.y ?? 0) < (layout.messages[1]?.y ?? 0))
        assert.ok((layout.notes[1]?.box.y ?? 0) > (loop?.box.y ?? 0) + (loop?.box.height ?? 0) - 1)
        assert.ok(layout.width > 0 && layout.height === layout.lifelineEnd)
    })

    it("closes a block the source never closed", async () => {
        const model = sequence(await parseDiagram("sequenceDiagram\n  A->>B: hi\n  opt maybe\n    B->>A: yes\n  end"))
        assert.deepEqual(model.rows.map((row) => row.kind), ["message", "open", "message", "close"])
    })
})

describe("the text version and the other kinds", () => {
    it("reads a graph's nodes then its links, and a sequence's messages in order", async () => {
        const flow = graph(await parseDiagram("flowchart LR\n  A[Read] -->|miss| B[(Db)]\n  subgraph S [Store]\n    B\n  end"))
        const text = describeDiagram(flow)
        assert.deepEqual(text.items, ["Store", "Read", "Db (Store)"])
        assert.deepEqual(text.links, ["Read to Db: miss"])
        const talk = describeDiagram(sequence(await parseDiagram("sequenceDiagram\n  participant A as Alice\n  A->>B: hi\n  B-->>A: hello")))
        assert.deepEqual(talk.items, ["Alice to B: hi", "B to Alice: hello"])
    })

    it("hands any other kind to Mermaid's own drawing", async () => {
        const pie = await parseDiagram('pie title Reads\n  "Hit" : 82\n  "Miss" : 18')
        assert.equal(pie.kind, "other")
        const gantt = await parseDiagram("gantt\n  dateFormat YYYY-MM-DD\n  section Fix\n    Read logs :a1, 2026-11-20, 1d")
        assert.equal(gantt.kind, "other")
    })
})

describe("the routing law (owner: Chốt, every graph)", () => {
    const DECISION = `flowchart LR
  A[Read the price book] --> B{Newer version?}
  B -- yes --> C[Write to Redis]
  B -- no --> D[Drop the old one]
  C --> E[(Redis)]
  A -.-> F[(Postgres)]`

    const boxesOf = (out: Awaited<ReturnType<typeof layoutDiagram>>) =>
        new Map(out.sizes.map((size) => [size.id, { ...(out.layout.positions[size.id] ?? { x: 0, y: 0 }), width: out.layout.boxes[size.id]?.width ?? size.width, height: out.layout.boxes[size.id]?.height ?? size.height }]))

    for (const direction of ["LR", "TB"] as const) {
        it(`${direction}: an edge whose ends share a rank line is straight, any other bends once; the decision's main branch is straight, every branch labelled at the split`, async () => {
            // Top-down, the dashed side edge puts its database beside the decision, where no one-bend route to "D" passes clear: the law's L is taken only
            // when it crosses no node, so that fixture keeps ELK's route; this one has room.
            const source = direction === "LR" ? DECISION : DECISION.replace("flowchart LR", "flowchart TB").replace("\n  A -.-> F[(Postgres)]", "")
            const parsed = graph(await parseDiagram(source))
            const out = await layoutDiagram(parsed, (text) => text.length * 7, estimateLabel)
            const boxes = boxesOf(out)
            const across = direction === "LR" ? 1 : 0
            const centre = (id: string): number => {
                const box = boxes.get(id)
                assert.ok(box !== undefined, id)
                return across === 1 ? box.y + box.height / 2 : box.x + box.width / 2
            }
            for (const edge of parsed.edges) {
                const route = out.layout.routes[edge.id]
                assert.ok(route !== undefined, edge.id)
                const bends = route.points.length - 2
                if (Math.abs(centre(edge.source) - centre(edge.target)) <= STRAIGHT_SNAP) assert.equal(bends, 0, `${edge.id} on one rank line is straight`)
                else assert.ok(bends <= 1, `${edge.id} bends at most once, not ${String(bends)}`)
                // No micro-jog: every run is a real run.
                for (let index = 1; index < route.points.length; index += 1) {
                    const [ax, ay] = route.points[index - 1] ?? [0, 0]
                    const [bx, by] = route.points[index] ?? [0, 0]
                    assert.ok(ax === bx || ay === by, `${edge.id} is orthogonal`)
                    if (index > 1 && index < route.points.length - 1) assert.ok(Math.hypot(bx - ax, by - ay) > STRAIGHT_SNAP, `${edge.id} has no jog`)
                }
            }
            assert.ok(Math.abs(centre("B") - centre("C")) <= STRAIGHT_SNAP, "the decision's main branch (the first) continues straight")
            for (const id of ["e2", "e3"]) {
                const route = out.layout.routes[id]
                const label = route?.label
                const first = route?.points[0]
                assert.ok(label !== undefined && first !== undefined, `${id} is labelled`)
                const near = Math.hypot(label.x + label.width / 2 - first[0], label.y + label.height / 2 - first[1])
                assert.ok(near <= 24 + Math.max(label.width, label.height), `${id}'s words stand at the split (${String(Math.round(near))})`)
            }
        })
    }

    it("opens fitted: every node, route and label is inside the first view, at 100% or less", async () => {
        const parsed = graph(await parseDiagram(DECISION))
        const out = await layoutDiagram(parsed, (text) => text.length * 7, estimateLabel)
        for (const frame of [{ width: 1408, height: 384 }, { width: 326, height: 384 }]) {
            const view = openView(frame, { x: 0, y: 0, width: out.width, height: out.height }, undefined, { top: 16, right: 16, bottom: 64, left: 16 })
            assert.ok(view.zoom <= 1)
            const inside = (x: number, y: number): boolean => x * view.zoom + view.x >= -0.5 && x * view.zoom + view.x <= frame.width + 0.5 && y * view.zoom + view.y >= -0.5 && y * view.zoom + view.y <= frame.height + 0.5
            for (const route of Object.values(out.layout.routes)) for (const [x, y] of route.points) assert.ok(inside(x, y), `route point ${String(x)},${String(y)} in the ${String(frame.width)} frame`)
            for (const box of boxesOf(out).values()) assert.ok(inside(box.x, box.y) && inside(box.x + box.width, box.y + box.height), "node in view")
        }
    })

    it("a read-only graph hides its edges' handle dots, and every arrowhead is one size", () => {
        const sheet = readFileSync(new URL("../src/core/ext/graph/shared/styles.css", import.meta.url), "utf8")
        assert.match(sheet, /\.starci-graph:not\(\[data-editable="true"\]\) \.starci-graph-edge-dot \{\s*display: none;/u)
        const step = readFileSync(new URL("../src/core/ext/graph/shared/StepEdge.ts", import.meta.url), "utf8")
        const message = readFileSync(new URL("../src/core/ext/graph/diagram/MermaidDiagram.tsx", import.meta.url), "utf8")
        assert.equal(/const ARROW = (\d+)/u.exec(step)?.[1], /const HEAD = (\d+)/u.exec(message)?.[1])
    })
})

describe("every stretch is drawn once (the routing law, rule 6)", () => {
    const drawnOnce = (routes: Readonly<Record<string, { readonly points: readonly (readonly [number, number])[] }>>, links: readonly { readonly id?: string; readonly target: string }[], rank: (id: string) => number) => {
        const once = dedupeRuns(Object.entries(routes).map(([id, route]) => ({ id, points: route.points, rank: rank(id) })))
        const ids = [...once.keys()]
        for (const [index, id] of ids.entries())
            for (const other of ids.slice(index + 1)) assert.ok(!overlaps(once.get(id)?.points ?? [], once.get(other)?.points ?? []), `${id} and ${other} share a stretch`)
        // Edges that reach one target at one point carry one arrowhead between them: the others end on its line at a junction.
        const byEnd = new Map<string, string[]>()
        for (const link of links) {
            const drawn = link.id === undefined ? undefined : once.get(link.id)
            const end = drawn?.points[drawn.points.length - 1]
            if (drawn === undefined || end === undefined || drawn.joinEnd) continue
            const key = `${link.target}@${String(Math.round(end[0] / 6))},${String(Math.round(end[1] / 6))}`
            byEnd.set(key, [...(byEnd.get(key) ?? []), link.id ?? ""])
        }
        for (const [key, heads] of byEnd) assert.equal(heads.length, 1, `${key} has one arrowhead, not ${heads.join(", ")}`)
        return once
    }

    it("a lesson flowchart: no two edges in one corridor, one arrowhead per entry", async () => {
        for (const source of ["flowchart TB\n  U[Open] --> G[GET]\n  G -->|miss| S[SELECT]\n  S --> W[SET]\n  G -->|hit| R([Reply])\n  W --> R", "flowchart LR\n  A[Read] --> B{Newer?}\n  B -- yes --> C[Write]\n  B -- no --> D[Drop]\n  C --> E[(Redis)]\n  D --> E\n  A -.-> F[(Postgres)]"]) {
            const parsed = graph(await parseDiagram(source))
            const out = await layoutDiagram(parsed, (text) => text.length * 7, estimateLabel)
            drawnOnce(out.layout.routes, parsed.edges, (id) => (parsed.edges.find((edge) => edge.id === id)?.dashed === true ? 2 : 3))
        }
    })

    it("a run graph whose branches join again (FlowGraph): the joins meet the stronger line, never run beside it", async () => {
        const decision = (id: string): FlowNode => ({ id, label: id, shape: "diamond", kind: "condition", outputs: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] })
        const step = (id: string): FlowNode => ({ id, label: id })
        const nodes = [step("start"), decision("paid"), decision("stock"), step("ship"), step("back"), step("remind"), step("log"), step("end")]
        const edges: GraphEdge[] = [
            { source: "start", target: "paid" }, { source: "paid", target: "stock", sourcePort: "yes" }, { source: "paid", target: "remind", sourcePort: "no" },
            { source: "stock", target: "ship", sourcePort: "yes" }, { source: "stock", target: "back", sourcePort: "no" },
            { source: "ship", target: "log" }, { source: "back", target: "log" }, { source: "remind", target: "log" }, { source: "log", target: "end" },
        ]
        for (const direction of ["TB", "LR"] as const) {
            const model = resolveFlow(nodes, edges, direction)
            const out = await layoutFlow(model.sizes, model.links, { direction })
            const once = drawnOnce(out.routes, model.links, (id) => (id.startsWith("ship") ? 7 : 3))
            assert.ok([...once.values()].some((route) => route.joinEnd), `${direction}: the joins into log meet one line`)
        }
    })

    it("an edge is one drawn line: the running state restyles it, no second path over it", () => {
        const step = readFileSync(new URL("../src/core/ext/graph/shared/StepEdge.ts", import.meta.url), "utf8")
        assert.equal((step.match(/\bd: path\b/gu) ?? []).length, 0, "no extra path drawn on the edge's own route")
        assert.equal((step.match(/h\(BaseEdge/gu) ?? []).length, 1)
    })
})

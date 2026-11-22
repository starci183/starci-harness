import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement, type ReactElement, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { Position, ReactFlowProvider, type Edge, type EdgeProps } from "@xyflow/react"
import type { StepEdgeData } from "../src/core/ext/graph/build.ts"
import { FlowGraph } from "../src/core/ext/graph/FlowGraph.ts"
import { FlowLegend } from "../src/core/ext/graph/shared/legend.ts"
import { SchemaMap } from "../src/core/ext/graph/SchemaMap.ts"
import { StepEdge, backRoute, roundedPath } from "../src/core/ext/graph/shared/StepEdge.ts"
import { GraphSkeleton } from "../src/core/ext/graph/shared/skeleton.ts"
import type { FlowNode, FlowStatusLabels, GraphEdge, SchemaEntity } from "../src/core/ext/graph/types.ts"

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true })
const globals = globalThis as unknown as Record<string, unknown>
// The core components (HeroUI, React Aria) also read CSS.supports, animation frames, getComputedStyle and the event classes of the page.
const borrowed = ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node", "IS_REACT_ACT_ENVIRONMENT", "ResizeObserver", "DOMMatrixReadOnly", "CSS", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "HTMLInputElement", "HTMLButtonElement"]

const words: FlowStatusLabels = { done: "done word", running: "running word", wait: "wait word", error: "error word", skipped: "skipped word", todo: "todo word" }
const nodes: FlowNode[] = [
    { id: "a", label: "Start", description: "first", icon: createElement("i", { "data-icon": "mine" }), status: "done" },
    { id: "b", label: "Send", status: "wait" },
]
const edges: GraphEdge[] = [{ source: "a", target: "b" }]
const entities: SchemaEntity[] = [
    { id: "order", label: "Order", description: "9 fields", count: 12, fields: Array.from({ length: 8 }, (_, index) => ({ id: `f${String(index)}`, label: `Field ${String(index)}`, type: "text" })) },
    { id: "contact", label: "Contact", count: 3 },
]

before(() => {
    class Observer {
        observe(): void {
            return undefined
        }
        unobserve(): void {
            return undefined
        }
        disconnect(): void {
            return undefined
        }
    }
    class Matrix {
        m22 = 1
    }
    const values: Record<string, unknown> = {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        HTMLElement: dom.window.HTMLElement,
        SVGElement: dom.window.SVGElement,
        Element: dom.window.Element,
        Node: dom.window.Node,
        IS_REACT_ACT_ENVIRONMENT: true,
        ResizeObserver: Observer,
        DOMMatrixReadOnly: Matrix,
        CSS: { supports: () => false, escape: (value: string) => value },
        requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => { callback(Date.now()) }, 0),
        cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => { clearTimeout(handle) },
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        MutationObserver: dom.window.MutationObserver,
        Event: dom.window.Event,
        KeyboardEvent: dom.window.KeyboardEvent,
        MouseEvent: dom.window.MouseEvent,
        PointerEvent: dom.window.MouseEvent,
        FocusEvent: dom.window.FocusEvent,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
    }
    for (const name of borrowed) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true })
    Object.assign(dom.window, { ResizeObserver: Observer, DOMMatrixReadOnly: Matrix, CSS: values["CSS"] })
})

after(() => {
    for (const name of borrowed) Reflect.deleteProperty(globals, name)
    dom.window.close()
})

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const mount = async (element: ReactElement, until?: string): Promise<Element> => {
    const host = dom.window.document.createElement("div")
    dom.window.document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
        root.render(element)
        await wait(25)
    })
    for (let waited = 0; waited < 3000 && until !== undefined && host.querySelector(until) === null; waited += 25) await act(() => wait(25))
    return host
}
const key = (target: Element, name: string): void => {
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true }))
}

describe("FlowGraph", () => {
    it("shows a skeleton with no text while loading, and no graph", async () => {
        const host = await mount(createElement(FlowGraph, { nodes, edges, statusLabels: words, isLoading: true, label: "Run" }))
        assert.ok(host.querySelector(".starci-graph-skeleton"))
        assert.equal(host.textContent, "")
        assert.equal(host.querySelector("[aria-busy=true]")?.getAttribute("aria-label"), "Run")
        assert.equal(host.querySelector(".react-flow"), null)
    })

    it("draws a node per entry, named by label and status word, with the icon in its tile", async () => {
        const host = await mount(createElement(FlowGraph, { nodes, edges, statusLabels: words, label: "Run" }), ".react-flow")
        const labels = [...host.querySelectorAll(".react-flow__node")].map((node) => node.getAttribute("aria-label"))
        assert.deepEqual(labels.sort(), ["Send, wait word", "Start, done word"])
        assert.equal(host.querySelector(".starci-graph-node[data-status=wait]")?.getAttribute("data-tone"), "warning")
        // The node's mark is the core's IconTile with the node's icon; its words are core Text roles; its status the core's InlineStatus.
        assert.ok(host.querySelector(".starci-graph-node-icon [data-component=IconTile] [data-icon=mine]"))
        assert.equal(host.querySelectorAll(".starci-graph-node[data-status=done] .starci-graph-node-text [data-component=Text]")[1]?.textContent, "first")
        assert.equal(host.querySelector(".starci-graph-node[data-status=wait] .starci-graph-status [data-component=InlineStatus]")?.textContent, "wait word")
        assert.equal(host.querySelector("[role=region]")?.getAttribute("aria-label"), "Run")
        assert.equal(host.querySelector(".starci-graph-minimap"), null)
    })

    it("selects on click, Enter and Escape, and tells the app", async () => {
        const pressed: string[] = []
        const selected: (string | null)[] = []
        const host = await mount(
            createElement(FlowGraph, { nodes, edges, statusLabels: words, label: "Run", onNodePress: (id) => pressed.push(id), onSelect: (id) => selected.push(id), minimap: true, minimapLabel: "Overview" }),
            ".react-flow__node",
        )
        const first = host.querySelector(".react-flow__node[data-id=a]")
        assert.ok(first)
        await act(async () => {
            first.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
            await wait(10)
        })
        assert.equal(host.querySelector(".starci-graph-node[data-selected=true] .starci-graph-node-text [data-component=Text]")?.textContent, "Start")
        const second = host.querySelector(".react-flow__node[data-id=b]")
        assert.ok(second)
        await act(async () => {
            key(second, "Enter")
            await wait(10)
        })
        await act(async () => {
            key(second, "Escape")
            await wait(10)
        })
        assert.deepEqual(pressed, ["a", "b"])
        assert.deepEqual(selected, ["a", "b", null])
        assert.equal(host.querySelector("[data-selected=true]"), null)
        assert.ok(host.querySelector(".starci-graph-minimap"))
        assert.equal(host.querySelector(".starci-graph-minimap title")?.textContent, "Overview")
    })

    it("follows a selection the app controls", async () => {
        const host = await mount(createElement(FlowGraph, { nodes, edges, statusLabels: words, label: "Run", selectedId: "b" }), ".react-flow__node")
        assert.equal(host.querySelector(".starci-graph-node[data-selected=true] .starci-graph-node-text [data-component=Text]")?.textContent, "Send")
    })

    it("shows the empty words when there is nothing to draw", async () => {
        const host = await mount(createElement(FlowGraph, { nodes: [], edges: [], statusLabels: words, label: "Run", emptyLabel: "Nothing here" }))
        assert.equal(host.querySelector(".starci-graph-empty")?.textContent, "Nothing here")
        assert.equal(host.querySelector(".react-flow"), null)
    })
})

describe("SchemaMap", () => {
    it("draws an entity box with its figure, its fields and a +N row", async () => {
        const relations: GraphEdge[] = [{ id: "order.contact", source: "order", target: "contact" }]
        const host = await mount(createElement(SchemaMap, { entities, relations, label: "Schema", moreLabel: (count) => `${String(count)} more` }), ".react-flow__node")
        const names = [...host.querySelectorAll(".react-flow__node")].map((node) => node.getAttribute("aria-label"))
        assert.deepEqual(names.sort(), ["Contact, 3", "Order, 9 fields, 12"])
        assert.equal(host.querySelectorAll(".starci-graph-entity-field:not(.starci-graph-entity-more)").length, 6)
        assert.equal(host.querySelector(".starci-graph-entity-more")?.textContent, "2 more")
        assert.equal(host.querySelector(".starci-graph-entity-count")?.textContent, "12")
    })

    it("loads as a skeleton with no text and shows a plain +N without moreLabel", async () => {
        const loading = await mount(createElement(SchemaMap, { entities, relations: [], label: "Schema", isLoading: true }))
        assert.equal(loading.textContent, "")
        const host = await mount(createElement(SchemaMap, { entities, relations: [], label: "Schema" }), ".react-flow__node")
        assert.equal(host.querySelector(".starci-graph-entity-more")?.textContent, "+2")
    })
})

describe("GraphSkeleton", () => {
    it("is hidden from assistive technology and holds no text", async () => {
        const host = await mount(createElement(GraphSkeleton))
        assert.equal(host.firstElementChild?.getAttribute("aria-hidden"), "true")
        assert.equal(host.textContent, "")
        assert.equal(host.querySelectorAll(".starci-graph-skeleton-node").length, 4)
    })
})

const rich: FlowNode[] = [
    {
        id: "start",
        label: "Start",
        status: "done",
        kind: "event",
        tag: "Trigger",
        count: 7,
        chips: [{ label: "a" }, { label: "b", tone: "accent" }, { label: "c" }, { label: "d" }],
        agent: createElement("i", { "data-avatar": "bot" }),
        agentName: "Bot",
    },
    {
        id: "check",
        label: "Paid?",
        shape: "diamond",
        status: "done",
        outputs: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No", tone: "danger" },
        ],
    },
    { id: "ship", label: "Ship", status: "running", href: "/ship", outputs: [{ id: "ok", label: "OK" }] },
    { id: "remind", label: "Remind", status: "skipped", dimmed: true },
    { id: "loop", label: "Retry", status: "wait", container: { kind: "loop", childIds: ["try"], description: "up to 3", note: "again", exits: [{ id: "out", label: "Out" }], chips: [{ label: "x" }] } },
    { id: "try", label: "Try", status: "error" },
    { id: "group", label: "Group", container: { childIds: ["inner"] } },
    { id: "inner", label: "Inner", status: "todo", placeholder: true },
]
const richEdges: GraphEdge[] = [
    { source: "start", target: "check" },
    { source: "check", target: "ship", sourcePort: "yes", variant: "taken" },
    { source: "check", target: "remind", sourcePort: "no" },
    { source: "ship", target: "loop", sourcePort: "ok" },
    { source: "loop", target: "inner", sourcePort: "out", label: "next" },
]

describe("FlowGraph shapes", () => {
    it("draws cards, diamonds and containers with their parts, and the untaken branch with the words from props", async () => {
        const host = await mount(
            createElement(FlowGraph, { nodes: rich, edges: richEdges, statusLabels: words, label: "Run", skippedLabel: "Skipped here", legend: [{ label: "Event", kind: "event" }] }),
            ".starci-graph-container",
        )
        await act(() => wait(80))
        assert.ok(host.querySelector(".starci-graph-node[data-shape=diamond] polygon"))
        assert.equal(host.querySelector(".starci-graph-container[data-container=loop] .starci-graph-container-description")?.textContent, "up to 3")
        assert.equal(host.querySelector(".starci-graph-container[data-container=loop] .starci-graph-container-note")?.textContent, "again")
        assert.ok(host.querySelector(".starci-graph-container[data-container=group]"))
        assert.ok(host.querySelector(".starci-graph-node[data-shape=diamond] .starci-graph-handle-vertex"))
        assert.ok(host.querySelector(".starci-graph-node[data-status=running] .starci-graph-node-icon[data-status=running] [data-component=IconTile]"))
        assert.ok(host.querySelector(".starci-graph-node[data-status=done] > .starci-graph-status [data-component=InlineStatus]"))
        assert.equal(host.querySelector(".starci-graph-node-tag")?.textContent, "Trigger")
        assert.equal(host.querySelector(".starci-graph-node-count")?.textContent, "7")
        assert.ok(host.querySelectorAll(".starci-graph-chips [data-component=Badge]").length >= 4)
        assert.ok(host.querySelector(".starci-graph-agent-avatar [data-avatar=bot]"))
        assert.equal(host.querySelector(".starci-graph-agent-name")?.textContent, "Bot")
        assert.ok(host.querySelector('a.starci-graph-node-link[href="/ship"]'))
        assert.equal(host.querySelector(".starci-graph-legend-item [data-component=Text]")?.textContent, "Event")
    })

    it("renders the node link with the app router link", async () => {
        const Link = ({ href, className, children }: { readonly href: string; readonly className: string; readonly children: ReactNode }): ReactElement => createElement("button", { "data-router": href, className }, children)
        const host = await mount(
            createElement(FlowGraph, {
                nodes: [
                    { id: "a", label: "A", href: "/a" },
                    { id: "b", label: "B", shape: "diamond", href: "/b" },
                ],
                edges: [],
                statusLabels: words,
                label: "Run",
                linkComponent: Link,
            }),
            ".react-flow__node",
        )
        assert.ok(host.querySelector('button[data-router="/a"]'))
        assert.ok(host.querySelector('button[data-router="/b"]'))
    })

    it("draws the legend of kinds, states, edges and loop frames, outside a graph too", async () => {
        const host = await mount(
            createElement(FlowLegend, {
                items: [
                    { label: "Kind", kind: "action" },
                    { label: "Decision", kind: "condition", shape: "diamond" },
                    { label: "Loop", kind: "loop" },
                    { label: "Running", status: "running" },
                    { label: "Taken", edge: "taken" },
                ],
                className: "mine",
            }),
        )
        assert.equal(host.querySelectorAll(".starci-graph-legend.mine li").length, 5)
        assert.ok(host.querySelector(".starci-graph-legend-kind[data-shape=diamond]"))
        assert.ok(host.querySelector(".starci-graph-legend-loop"))
        // A state row is the core's InlineStatus with the app's word.
        assert.equal(host.querySelector(".starci-graph-legend-item [data-component=InlineStatus]")?.textContent, "Running")
        assert.ok(host.querySelector(".starci-graph-edge--taken .react-flow__edge-path"))
        const toned = await mount(createElement(FlowLegend, { items: [{ label: "A", kind: "end" }], kindTones: { end: "info" } }))
        assert.ok(toned.querySelector("[data-tile-tone=info]"))
    })
})

describe("FlowGraph editing and warnings", () => {
    it("is read-only by default and shows a reset control only while editable", async () => {
        const fixed = await mount(createElement(FlowGraph, { nodes, edges, statusLabels: words, label: "Run", resetLabel: "Reset" }), ".react-flow__node")
        assert.equal(fixed.querySelector("[data-editable]"), null)
        assert.equal(fixed.querySelector('.starci-graph-zoom [aria-label="Reset"]'), null)
        const calls: unknown[] = []
        const host = await mount(
            createElement(FlowGraph, {
                nodes,
                edges,
                statusLabels: words,
                label: "Run",
                editable: true,
                resetLabel: "Reset",
                positions: { a: { x: 5, y: 6 }, gone: { x: 1, y: 1 } },
                onPositionsChange: (next) => calls.push(next),
            }),
            ".react-flow__node",
        )
        assert.ok(host.querySelector("[data-editable=true]"))
        const reset = host.querySelector('.starci-graph-zoom [aria-label="Reset"]')
        assert.ok(reset)
        assert.equal(reset.getAttribute("aria-label"), "Reset")
        assert.match(host.querySelector(".react-flow__node[data-id=a]")?.getAttribute("style") ?? "", /translate\(5px,\s?6px\)/)
        await act(async () => {
            reset.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
            await wait(10)
        })
        assert.deepEqual(calls, [{}])
    })

    it("draws a still picture when it is not interactive: no zoom buttons, no overview map", async () => {
        const host = await mount(createElement(FlowGraph, { nodes, edges, statusLabels: words, label: "Run", interactive: false, minimap: true }), ".react-flow__node")
        assert.equal(host.querySelector(".starci-graph-zoom"), null)
        assert.equal(host.querySelector(".starci-graph-minimap"), null)
        assert.ok(host.querySelector(".react-flow__node"))
    })

    it("warns in development when two running nodes lie on one path, and only then", async () => {
        const warned: string[] = []
        const original = globalThis.console.warn
        globalThis.console.warn = (message: string) => warned.push(message)
        const twice: FlowNode[] = [
            { id: "a", label: "A", status: "running" },
            { id: "b", label: "B", status: "running" },
        ]
        const joined: GraphEdge[] = [{ source: "a", target: "b" }]
        try {
            await mount(createElement(FlowGraph, { nodes: twice, edges: joined, statusLabels: words, label: "Run" }), ".react-flow__node")
            assert.equal(warned.length, 1)
            assert.match(warned[0] ?? "", /"a" and "b" are both running on one path/)
            await mount(createElement(FlowGraph, { nodes: twice, edges: [], statusLabels: words, label: "Run" }), ".react-flow__node")
            assert.equal(warned.length, 1)
            const mode = process.env.NODE_ENV
            process.env.NODE_ENV = "production"
            try {
                await mount(createElement(FlowGraph, { nodes: twice, edges: joined, statusLabels: words, label: "Run" }), ".react-flow__node")
            } finally {
                if (mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV")
                else process.env.NODE_ENV = mode
            }
            assert.equal(warned.length, 1)
        } finally {
            globalThis.console.warn = original
        }
    })
})

describe("StepEdge", () => {
    const edge = (style: "plain" | "back", pill?: string): ReactElement =>
        createElement(
            ReactFlowProvider,
            null,
            createElement(
                "svg",
                null,
                createElement(StepEdge, {
                    id: "e",
                    source: "a",
                    target: "b",
                    sourceX: 0,
                    sourceY: 0,
                    targetX: 120,
                    targetY: 80,
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left,
                    selected: false,
                    animated: false,
                    selectable: false,
                    deletable: false,
                    sourceHandleId: null,
                    targetHandleId: null,
                    markerEnd: "url(#m)",
                    data: { style, pill, dangerPort: false, dimmed: false },
                } as unknown as EdgeProps<Edge<StepEdgeData>>),
            ),
        )

    it("draws a rounded orthogonal line, or a curve for a back edge, with a dot at its source and no wider hit path", async () => {
        const plain = await mount(edge("plain"))
        const back = await mount(edge("back", "words"))
        const pathOf = (host: Element): string => host.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? ""
        assert.match(pathOf(plain), /^M0 0/)
        assert.match(pathOf(back), /^M0 0L/)
        assert.match(pathOf(plain), /Q/)
        assert.ok(plain.querySelector("circle.starci-graph-edge-dot"))
        assert.equal(plain.querySelector(".react-flow__edge-interaction"), null)
        assert.ok(plain.querySelector("path.starci-graph-edge-arrow"))
    })
})

describe("the route of a back edge", () => {
    it("runs below both ends in a row, and beside both in a column", () => {
        const row = backRoute(300, 100, 40, 60, false)
        assert.deepEqual(row.points.at(2), [316, 156])
        assert.deepEqual(row.middle, [170, 156])
        const column = backRoute(100, 300, 120, 40, true)
        assert.deepEqual(column.points.at(2), [260, 316])
        assert.deepEqual(column.middle, [260, 170])
    })

    it("rounds a corner by the radius, less when a run is short, and draws nothing for no points", () => {
        assert.equal(roundedPath([], 12), "")
        assert.equal(
            roundedPath(
                [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                ],
                12,
            ),
            "M0 0L88 0Q100 0 100 12L100 100",
        )
        assert.match(
            roundedPath(
                [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                ],
                12,
            ),
            /^M0 0L5 0Q10 0 10 5/,
        )
    })
})

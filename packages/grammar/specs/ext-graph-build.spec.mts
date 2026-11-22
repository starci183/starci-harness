import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Position } from "@xyflow/react"
import { buildEntityNodes, buildFlowEdges, buildFlowNodes, buildSchemaEdges, containerKind, entityHeight, schemaSizes, structureKey, visibleFields } from "../src/core/ext/graph/build.ts"
import { ENTITY_HEAD_HEIGHT, ENTITY_ROW_HEIGHT, SCHEMA_FIELD_ROWS } from "../src/core/ext/graph/layout.ts"
import { resolveFlow } from "../src/core/ext/graph/model.ts"
import type { FlowNode, FlowStatusLabels, GraphEdge, SchemaEntity, SchemaField } from "../src/core/ext/graph/types.ts"

const words: FlowStatusLabels = { done: "done word", running: "running word", wait: "wait word", error: "error word", skipped: "skipped word", todo: "todo word" }
const nodes: FlowNode[] = [
    { id: "a", label: "Start", status: "done", kind: "event" },
    { id: "b", label: "Send", description: "email", status: "running", tone: "danger" },
    { id: "c", label: "Approve", status: "wait", dimmed: true },
    { id: "d", label: "Close", href: "/close" },
]
const edges: GraphEdge[] = [
    { source: "a", target: "b", label: "ok" },
    { source: "b", target: "c" },
    { source: "c", target: "d", placeholder: true },
    { source: "a", target: "ghost" },
    { source: "a", target: "b" },
]

const at = <T,>(list: readonly T[], index: number): T => {
    const item = list[index]
    assert.ok(item !== undefined)
    return item
}
const context = (direction: "LR" | "TB", selectedId: string | null) => ({ statusLabels: words, kindTones: undefined, direction, selectedId })

describe("buildFlowNodes", () => {
    it("names each node by label and status word, fixes it in place and sets the handle sides", () => {
        const model = resolveFlow(nodes, edges, "LR")
        const built = buildFlowNodes(nodes, model, { a: { x: 1, y: 2 } }, {}, context("LR", "b"))
        assert.equal(at(built, 0).ariaLabel, "Start, done word")
        assert.equal(at(built, 1).ariaLabel, "Send, running word")
        assert.equal(at(built, 3).ariaLabel, "Close, todo word")
        assert.deepEqual(at(built, 0).position, { x: 1, y: 2 })
        assert.deepEqual(at(built, 1).position, { x: 0, y: 0 })
        assert.equal(at(built, 0).draggable, false)
        assert.equal(at(built, 0).connectable, false)
        assert.equal(at(built, 0).sourcePosition, Position.Right)
        assert.equal(at(buildFlowNodes(nodes, model, {}, {}, context("TB", null)), 0).targetPosition, Position.Top)
        assert.equal(at(built, 1).data.node.description, "email")
        assert.deepEqual(
            built.map((node) => node.data.selected),
            [false, true, false, false],
        )
    })

    it("plates the icon tile in the tone of the state or the node's own tone, carries the status words, a link node one keyboard stop, and a card its type", () => {
        const model = resolveFlow(nodes, edges, "LR")
        const built = buildFlowNodes(nodes, model, {}, {}, context("LR", null))
        assert.deepEqual(
            built.map((node) => node.data.tileTone),
            ["success", "danger", "warning", "default"],
        )
        assert.equal(at(built, 3).focusable, false)
        assert.equal(at(built, 0).focusable, undefined)
        assert.deepEqual(new Set(built.map((node) => node.type)), new Set(["flow"]))
    })

    it("puts a container before its children, sizes it from its box and keeps a child inside it", () => {
        const list: FlowNode[] = [
            { id: "x", label: "X" },
            { id: "g", label: "Group", container: { childIds: ["x"] } },
            { id: "d", label: "Decide", shape: "diamond" },
        ]
        const model = resolveFlow(list, [], "LR")
        const built = buildFlowNodes(list, model, { x: { x: 16, y: 48 } }, { g: { width: 300, height: 200 } }, context("LR", null))
        assert.deepEqual(
            built.map((node) => [node.id, node.type]),
            [
                ["g", "container"],
                ["d", "diamond"],
                ["x", "flow"],
            ],
        )
        const group = at(built, 0)
        assert.deepEqual([group.width, group.height], [300, 200])
        const child = at(built, 2)
        assert.equal(child.parentId, "g")
        assert.equal(child.extent, "parent")
    })
})

describe("buildFlowEdges", () => {
    const model = resolveFlow(nodes, edges, "LR")

    it("animates only the edge into a running step, drops unknown ends and keeps ids unique", () => {
        const built = buildFlowEdges(model, nodes)
        assert.deepEqual(
            built.map((edge) => [edge.id, edge.animated]),
            [
                ["a->b", true],
                ["b->c", false],
                ["c->d", false],
                ["a->b#1", true],
            ],
        )
        assert.match(at(built, 1).className ?? "", /starci-graph-edge--wait/)
        assert.match(at(built, 0).className ?? "", /starci-graph-edge--running/)
        assert.match(at(built, 2).className ?? "", /starci-graph-edge--placeholder/)
        assert.match(at(built, 1).className ?? "", /starci-graph-edge--dimmed/)
    })

    it("puts a plain label on the line and keeps a card port label inside the card", () => {
        const built = buildFlowEdges(model, nodes)
        assert.equal(at(built, 0).data?.pill, "ok")
        assert.equal(at(built, 1).data?.pill, undefined)
    })

    it("carries the skipped words only on an untaken branch", () => {
        const list: FlowNode[] = [{ id: "d", label: "D", shape: "diamond", status: "done" }, { id: "y", label: "Y" }, { id: "n", label: "N" }]
        const branchEdges: GraphEdge[] = [
            { source: "d", target: "y", label: "Yes", variant: "taken" },
            { source: "d", target: "n", label: "No" },
        ]
        const built = buildFlowEdges(resolveFlow(list, branchEdges, "LR", "Skipped"), list)
        assert.deepEqual(
            built.map((edge) => [edge.sourceHandle, edge.data?.pill, edge.data?.style]),
            [
                ["port:Yes", "Yes", "taken"],
                ["port:No", "No · Skipped", "skipped"],
            ],
        )
        assert.equal(at(buildFlowEdges(resolveFlow(list, branchEdges, "LR"), list), 1).data?.pill, "No")
    })

    it("draws an error port in the danger tone", () => {
        const list: FlowNode[] = [{ id: "a", label: "A", outputs: [{ id: "e", label: "Error", tone: "danger" }] }, { id: "b", label: "B" }]
        const built = buildFlowEdges(resolveFlow(list, [{ source: "a", target: "b", sourcePort: "e" }], "TB"), list)
        assert.match(at(built, 0).className ?? "", /--danger/)
        assert.equal(at(built, 0).data?.dangerPort, true)
    })

    it("keeps an id the app gave and never animates a schema map", () => {
        const built = buildSchemaEdges(new Set(["a", "c"]), [{ id: "rel.1", source: "a", target: "c" }, { source: "a", target: "c" }, { source: "a", target: "c" }, { source: "a", target: "zz" }])
        assert.deepEqual(
            built.map((edge) => [edge.id, edge.animated, edge.className]),
            [
                ["rel.1", undefined, "starci-graph-edge starci-graph-edge--plain"],
                ["a->c", undefined, "starci-graph-edge starci-graph-edge--plain"],
                ["a->c#1", undefined, "starci-graph-edge starci-graph-edge--plain"],
            ],
        )
    })
})

describe("schema entities", () => {
    const fields = (count: number): SchemaField[] => Array.from({ length: count }, (_, index) => ({ id: `f${String(index)}`, label: `Field ${String(index)}`, type: "text" }))
    const entity = (count: number | undefined): SchemaEntity => ({ id: "e", label: "Order", description: "orders", count: 12, ...(count === undefined ? {} : { fields: fields(count) }) })

    it("draws up to the row cap and leaves the rest to a +N row", () => {
        assert.deepEqual(visibleFields(undefined), { rows: [], more: 0 })
        assert.equal(visibleFields(fields(SCHEMA_FIELD_ROWS)).more, 0)
        const many = visibleFields(fields(SCHEMA_FIELD_ROWS + 3))
        assert.equal(many.rows.length, SCHEMA_FIELD_ROWS)
        assert.equal(many.more, 3)
    })

    it("grows the box with its rows", () => {
        assert.equal(entityHeight(entity(undefined)), ENTITY_HEAD_HEIGHT)
        assert.equal(entityHeight(entity(2)), ENTITY_HEAD_HEIGHT + 2 * ENTITY_ROW_HEIGHT + 8)
        assert.equal(entityHeight(entity(SCHEMA_FIELD_ROWS + 1)), ENTITY_HEAD_HEIGHT + (SCHEMA_FIELD_ROWS + 1) * ENTITY_ROW_HEIGHT + 8)
        assert.equal(at(schemaSizes([entity(2)]), 0).height, entityHeight(entity(2)))
    })

    it("names an entity by its label, description and figure", () => {
        const built = buildEntityNodes([entity(1), { id: "x", label: "Bare" }], {}, "LR", "x")
        assert.equal(at(built, 0).ariaLabel, "Order, orders, 12")
        assert.equal(at(built, 1).ariaLabel, "Bare")
        assert.equal(at(built, 1).data.selected, true)
    })
})

describe("structureKey", () => {
    const sizes = (list: readonly FlowNode[]) => resolveFlow(list, edges, "LR").sizes
    const links = (list: readonly GraphEdge[]) => resolveFlow(nodes, list, "LR").links

    it("ignores statuses and labels but not ids, heights, ports, edges, direction or islands", () => {
        const base = structureKey(sizes(nodes), links(edges), "LR")
        assert.equal(structureKey(sizes(nodes.map((node) => ({ ...node, status: "error" as const, label: "x" }))), links(edges), "LR"), base)
        assert.notEqual(structureKey(sizes(nodes), links(edges), "TB"), base)
        assert.notEqual(structureKey(sizes(nodes), links(edges), "LR", "stack"), base)
        assert.notEqual(structureKey(sizes(nodes), links(edges.slice(1)), "LR"), base)
        assert.notEqual(structureKey(sizes(nodes.slice(1)), links(edges), "LR"), base)
        assert.notEqual(structureKey(sizes([{ ...at(nodes, 0), outputs: [{ id: "p", label: "P" }] }, ...nodes.slice(1)]), links(edges), "LR"), base)
        assert.notEqual(structureKey(schemaSizes([{ id: "a", label: "A", fields: [{ id: "f", label: "F" }] }]), [], "LR"), structureKey(schemaSizes([{ id: "a", label: "A" }]), [], "LR"))
    })
})

describe("containerKind", () => {
    it("is a group unless it says loop", () => {
        assert.equal(containerKind({ childIds: [] }), "group")
        assert.equal(containerKind({ childIds: [], kind: "loop" }), "loop")
    })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { FLOW_NODE_HEIGHT, ISLAND_GAP, NODE_WIDTH, layoutFlow, layoutGraph, usableLinks, type SizedNode } from "../src/core/ext/graph/layout.ts"
import type { GraphPosition } from "../src/core/ext/graph/types.ts"

const sized = (id: string, height = FLOW_NODE_HEIGHT): SizedNode => ({ id, width: NODE_WIDTH, height })
const nodes = ["a", "b", "c", "d"].map((id) => sized(id))
const links = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "b", target: "d" },
    { source: "c", target: "d" },
]

const reader = (positions: Readonly<Record<string, GraphPosition>>): ((id: string) => GraphPosition) => (id) => {
    const position = positions[id]
    assert.ok(position)
    return position
}

describe("layoutGraph", () => {
    it("gives the same positions for the same graph, every time", async () => {
        const first = await layoutGraph(nodes, links)
        const second = await layoutGraph([...nodes], [...links])
        assert.deepEqual(first, second)
        assert.deepEqual(Object.keys(first).sort(), ["a", "b", "c", "d"])
    })

    it("lays out left to right: a layer per step, the fan-out one above the other, no overlap", async () => {
        const at = reader(await layoutGraph(nodes, links, "LR"))
        assert.ok(at("a").x + NODE_WIDTH < at("b").x)
        assert.equal(at("b").x, at("c").x)
        assert.ok(at("b").x + NODE_WIDTH < at("d").x)
        assert.ok(Math.abs(at("b").y - at("c").y) >= FLOW_NODE_HEIGHT)
    })

    it("lays out top to bottom when asked", async () => {
        const at = reader(await layoutGraph(nodes, links, "TB"))
        assert.ok(at("a").y + FLOW_NODE_HEIGHT < at("b").y)
        assert.equal(at("b").y, at("c").y)
        assert.ok(at("b").y + FLOW_NODE_HEIGHT < at("d").y)
        assert.ok(Math.abs(at("b").x - at("c").x) >= NODE_WIDTH)
    })

    it("keeps boxes of different heights apart", async () => {
        const tall = [sized("a", 200), sized("b", 120), sized("c")]
        const at = reader(await layoutGraph(tall, [{ source: "a", target: "c" }, { source: "b", target: "c" }]))
        assert.ok(Math.abs(at("a").y - at("b").y) >= 120 || Math.abs(at("a").y - at("b").y) >= 200)
    })

    it("survives a cycle, an unknown end, a self loop and a repeated link", async () => {
        const messy = [
            { source: "x", target: "y" },
            { source: "y", target: "x" },
            { source: "x", target: "x" },
            { source: "x", target: "y" },
            { source: "x", target: "ghost" },
        ]
        const two = [sized("x"), sized("y")]
        assert.deepEqual(usableLinks(two, messy), [
            { source: "x", target: "y" },
            { source: "y", target: "x" },
        ])
        assert.deepEqual(Object.keys(await layoutGraph(two, messy)).sort(), ["x", "y"])
    })

    it("lays out an empty graph", async () => {
        assert.deepEqual(await layoutGraph([], []), {})
    })
})

describe("layoutFlow", () => {
    const two = [sized("a"), sized("b"), sized("c"), sized("d")]
    const pairs = [
        { source: "a", target: "b" },
        { source: "c", target: "d" },
    ]

    it("lays disconnected parts side by side, and in one column when told to stack", async () => {
        const wrapped = (await layoutFlow(two, pairs, { width: 2000 })).positions
        const at = reader(wrapped)
        assert.equal(at("a").y, at("c").y)
        assert.ok(at("c").x >= at("b").x + NODE_WIDTH + ISLAND_GAP)
        const stacked = reader((await layoutFlow(two, pairs, { islands: "stack", width: 2000 })).positions)
        assert.equal(stacked("a").x, stacked("c").x)
        assert.ok(stacked("c").y >= stacked("a").y + FLOW_NODE_HEIGHT + ISLAND_GAP)
    })

    it("wraps the islands into a new row at the width", async () => {
        const at = reader((await layoutFlow(two, pairs, { width: 700 })).positions)
        assert.equal(at("c").x, 0)
        assert.ok(at("c").y >= at("a").y + FLOW_NODE_HEIGHT + ISLAND_GAP)
    })

    it("lays out a container round its children and positions a child inside it", async () => {
        const nodes: SizedNode[] = [
            { id: "loop", width: 248, height: 120, insets: { top: 48, right: 16, bottom: 16, left: 16 } },
            { id: "x", width: NODE_WIDTH, height: FLOW_NODE_HEIGHT, parentId: "loop" },
            { id: "y", width: NODE_WIDTH, height: FLOW_NODE_HEIGHT, parentId: "loop" },
            sized("after"),
        ]
        const links = [
            { source: "x", target: "y" },
            { source: "loop", target: "after" },
            { source: "y", target: "loop" },
            { source: "loop", target: "x" },
        ]
        const { positions, boxes } = await layoutFlow(nodes, links)
        const at = reader(positions)
        const box = boxes.loop
        assert.ok(box)
        assert.ok(box.width >= 2 * NODE_WIDTH + 32 && box.height >= 48 + FLOW_NODE_HEIGHT + 16)
        assert.ok(at("x").x >= 16 && at("x").y >= 48)
        assert.ok(at("y").x + NODE_WIDTH <= box.width)
        assert.ok(at("after").x >= at("loop").x + box.width)
    })

    it("lets an edge leave a port and keeps the order of the ports", async () => {
        const branch: SizedNode = {
            id: "d",
            width: 176,
            height: 104,
            ports: [
                { id: "yes", side: "EAST" },
                { id: "no", side: "EAST" },
            ],
        }
        const nodes = [sized("s"), branch, sized("y"), sized("n")]
        const at = reader(
            (
                await layoutFlow(nodes, [
                    { source: "s", target: "d" },
                    { source: "d", target: "y", sourcePort: "yes" },
                    { source: "d", target: "n", sourcePort: "no" },
                    { source: "d", target: "n", sourcePort: "gone" },
                ])
            ).positions,
        )
        assert.ok(at("y").y < at("n").y)
        assert.ok(at("d").x > at("s").x)
    })

    it("stands a node with an unknown or cyclic parent at the top", async () => {
        const nodes: SizedNode[] = [
            { id: "a", width: NODE_WIDTH, height: FLOW_NODE_HEIGHT, parentId: "ghost" },
            { id: "b", width: NODE_WIDTH, height: FLOW_NODE_HEIGHT, parentId: "c" },
            { id: "c", width: NODE_WIDTH, height: FLOW_NODE_HEIGHT, parentId: "b" },
        ]
        const { positions } = await layoutFlow(nodes, [])
        assert.deepEqual(Object.keys(positions).sort(), ["a", "b", "c"])
    })
})

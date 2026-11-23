import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { NODE_WIDTH } from "../src/core/ext/graph/layout.ts"
import { PORT_COLUMN, OUT_PORT, DIAMOND_HEIGHT, DIAMOND_WIDTH, cardHeight, cardWidth, isDiamond, portSide, resolveFlow } from "../src/core/ext/graph/model.ts"
import type { FlowNode, GraphEdge } from "../src/core/ext/graph/types.ts"

const at = <T,>(list: readonly T[], index: number): T => {
    const item = list[index]
    assert.ok(item !== undefined)
    return item
}

const decision: FlowNode = { id: "d", label: "Paid?", shape: "diamond", status: "done" }
const nodes: FlowNode[] = [{ id: "s", label: "Start", status: "done" }, decision, { id: "yes", label: "Ship", status: "running" }, { id: "no", label: "Remind", status: "skipped" }]
const edges: GraphEdge[] = [
    { source: "s", target: "d" },
    { source: "d", target: "yes", label: "Yes", variant: "taken" },
    { source: "d", target: "no", label: "No" },
]

describe("resolveFlow", () => {
    it("takes the ports of a branch from the labels of its edges and puts them on the vertices", () => {
        const model = resolveFlow(nodes, edges, "LR")
        assert.deepEqual(
            model.ports.get("d")?.map((port) => [port.id, port.side]),
            [
                ["Yes", "EAST"],
                ["No", "SOUTH"],
            ],
        )
        assert.equal(model.ports.get("s"), undefined)
        const size = model.sizes.find((candidate) => candidate.id === "d")
        assert.deepEqual([size?.width, size?.height], [DIAMOND_WIDTH, DIAMOND_HEIGHT])
        assert.deepEqual(
            model.links.map((link) => link.sourcePort),
            [OUT_PORT, "Yes", "No"],
        )
    })

    it("draws the taken branch solid and the untaken one skipped with the branch words; the label stays on the port", () => {
        const model = resolveFlow(nodes, edges, "TB")
        assert.deepEqual(
            model.edges.map((item) => [item.style, item.branchSkipped]),
            [
                ["taken", false],
                ["taken", false],
                ["skipped", true],
            ],
        )
        assert.equal(at(model.edges, 1).port?.label, "Yes")
        assert.deepEqual(
            model.ports.get("d")?.map((port) => port.side),
            ["SOUTH", "EAST"],
        )
    })

    it("flows into a running step, is amber into a waiting one, and skips an edge into a skipped node", () => {
        const flat = resolveFlow(
            [
                { id: "a", label: "A", status: "running" },
                { id: "b", label: "B", status: "wait" },
                { id: "c", label: "C", status: "skipped" },
            ],
            [
                { source: "a", target: "b" },
                { source: "b", target: "c" },
                { source: "a", target: "c", id: "x", variant: "fallback" },
                { source: "c", target: "a", variant: "back" },
            ],
            "LR",
        )
        assert.deepEqual(
            flat.edges.map((item) => [item.id, item.style, item.branchSkipped]),
            [
                ["a->b", "wait", false],
                ["b->c", "skipped", false],
                ["x", "fallback", false],
                ["c->a", "back", false],
            ],
        )
        assert.deepEqual(flat.links.map((link) => [link.id, link.back === true]), [["a->b", false], ["b->c", false], ["x", false], ["c->a", true]])
    })

    it("declares ports with outputs, keeps ids unique and drops edges with an unknown end", () => {
        const model = resolveFlow(
            [
                {
                    id: "a",
                    label: "A",
                    outputs: [
                        { id: "ok", label: "OK" },
                        { id: "err", label: "Error", tone: "danger" },
                    ],
                },
                { id: "b", label: "B" },
            ],
            [
                { source: "a", target: "b", sourcePort: "err" },
                { source: "a", target: "b", sourcePort: "ok" },
                { source: "a", target: "ghost" },
            ],
            "LR",
        )
        assert.deepEqual(
            model.edges.map((item) => [item.id, item.port?.id]),
            [
                ["a->b", "err"],
                ["a->b#1", "ok"],
            ],
        )
        assert.equal(at(model.edges, 0).port?.tone, "danger")
        assert.equal(model.sizes.find((size) => size.id === "a")?.height, cardHeight({ id: "a", label: "A" }, 2, "LR"))
    })

    it("holds the children of a container and gives it its exits", () => {
        const model = resolveFlow(
            [
                { id: "loop", label: "Retry", container: { kind: "loop", childIds: ["x", "y", "ghost", "loop"], exits: [{ id: "done", label: "Done" }], note: "again" } },
                { id: "x", label: "X" },
                { id: "y", label: "Y" },
            ],
            [{ source: "loop", target: "y", sourcePort: "done" }],
            "TB",
        )
        assert.deepEqual(
            [...model.parents],
            [
                ["x", "loop"],
                ["y", "loop"],
            ],
        )
        assert.equal(model.sizes.find((size) => size.id === "x")?.parentId, "loop")
        assert.equal(model.sizes.find((size) => size.id === "loop")?.insets?.bottom, 48)
        assert.equal(model.ports.get("loop")?.[0]?.side, "SOUTH")
    })
})

describe("sizes", () => {
    it("grows a card by its chips, agent and ports", () => {
        const plain: FlowNode = { id: "a", label: "A" }
        assert.equal(cardHeight(plain, 0, "LR"), 64)
        assert.equal(cardHeight({ ...plain, chips: [{ label: "x" }] }, 0, "LR"), 88)
        assert.equal(cardHeight({ ...plain, agentName: "bot" }, 0, "LR"), 84)
        assert.equal(cardHeight(plain, 2, "TB"), 96)
        assert.equal(cardHeight(plain, 3, "LR"), 100)
    })

    it("widens a card by its port column only when the ports stand down its end side", () => {
        assert.equal(cardWidth(0, "LR"), NODE_WIDTH)
        assert.equal(cardWidth(2, "TB"), NODE_WIDTH)
        assert.equal(cardWidth(2, "LR"), NODE_WIDTH + PORT_COLUMN)
    })

    it("knows a diamond and where a port sits", () => {
        assert.equal(isDiamond(decision), true)
        assert.equal(isDiamond({ ...decision, container: { childIds: [] } }), false)
        assert.equal(portSide(true, "LR", 7), "EAST")
        assert.equal(portSide(false, "TB", 3), "SOUTH")
    })
})

describe("derived states", () => {
    const frame = (kids: readonly FlowNode[]): FlowNode[] => [{ id: "f", label: "Frame", status: "todo", container: { childIds: kids.map((kid) => kid.id) } }, ...kids]
    const stateOf = (kids: readonly FlowNode[]): string | undefined => resolveFlow(frame(kids), [], "TB").statuses.get("f")

    it("makes a container what its children are: error, running, wait, done, in progress, skipped, not run", () => {
        assert.equal(stateOf([{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "error" }]), "error")
        assert.equal(stateOf([{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "running" }]), "running")
        assert.equal(stateOf([{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "wait" }]), "wait")
        assert.equal(stateOf([{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "skipped" }]), "done")
        assert.equal(stateOf([{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "todo" }]), "running")
        assert.equal(stateOf([{ id: "a", label: "A", status: "skipped" }]), "skipped")
        assert.equal(stateOf([{ id: "a", label: "A", status: "todo" }]), "todo")
    })

    it("flows into a container that is running", () => {
        const list: FlowNode[] = [{ id: "s", label: "S", status: "done" }, ...frame([{ id: "a", label: "A", status: "running" }])]
        assert.equal(resolveFlow(list, [{ source: "s", target: "f" }], "TB").edges[0]?.style, "running")
    })

    it("reads a node that says what it waits for as waiting, not running", () => {
        const waiting: FlowNode = { id: "w", label: "W", status: "running", wait: { kind: "time", label: "Chờ giờ", detail: "còn 42 phút" } }
        assert.equal(resolveFlow([waiting], [], "TB").statuses.get("w"), "wait")
        assert.equal(resolveFlow([{ ...waiting, status: "todo" }], [], "TB").statuses.get("w"), "todo")
    })
})

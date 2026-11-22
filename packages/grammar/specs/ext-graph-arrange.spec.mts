import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { separateLabels, symmetrise, type MutableRoute } from "../src/core/ext/graph/arrange.ts"
import { layoutFlow } from "../src/core/ext/graph/layout.ts"
import { resolveFlow } from "../src/core/ext/graph/model.ts"
import type { FlowNode, GraphEdge } from "../src/core/ext/graph/types.ts"

const decision = (id: string): FlowNode => ({ id, label: id, shape: "diamond", kind: "condition", outputs: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] })
const step = (id: string): FlowNode => ({ id, label: id })
const edge = (source: string, target: string, sourcePort?: string): GraphEdge => ({ source, target, ...(sourcePort === undefined ? {} : { sourcePort }) })

const nested = async (): Promise<{ centre: (id: string) => number; routes: Awaited<ReturnType<typeof layoutFlow>>["routes"] }> => {
    const nodes = [step("start"), decision("paid"), decision("stock"), step("ship"), step("back"), step("remind"), step("log"), step("end")]
    const edges = [edge("start", "paid"), edge("paid", "stock", "yes"), edge("paid", "remind", "no"), edge("stock", "ship", "yes"), edge("stock", "back", "no"), edge("ship", "log"), edge("back", "log"), edge("remind", "log"), edge("log", "end")]
    const model = resolveFlow(nodes, edges, "TB")
    const out = await layoutFlow(model.sizes, model.links, { direction: "TB" })
    return { centre: (id) => (out.positions[id]?.x ?? 0) + (out.boxes[id]?.width ?? 0) / 2, routes: out.routes }
}

describe("symmetrise", () => {
    it("makes every decision symmetric, the inner one first, and keeps the spine on one x", async () => {
        const { centre } = await nested()
        assert.ok(Math.abs(centre("paid") - centre("stock") - (centre("remind") - centre("paid"))) <= 1)
        assert.ok(Math.abs(centre("stock") - centre("ship") - (centre("back") - centre("stock"))) <= 1)
        assert.deepEqual(new Set(["start", "paid", "log", "end"].map((id) => Math.round(centre(id)))).size, 1)
    })

    it("gives the same coordinates every time and routes the edges of what moved from their ports to their targets", async () => {
        const first = await nested()
        const second = await nested()
        assert.deepEqual(first.routes, second.routes)
        const route = first.routes["paid->stock"]
        assert.ok(route)
        const last = route.points[route.points.length - 1]
        assert.ok(last)
        assert.ok(Math.abs(last[0] - first.centre("stock")) <= 1)
    })

    it("leaves a graph with no decision alone", () => {
        const positions = { a: { x: 0, y: 0 }, b: { x: 10, y: 80 } }
        symmetrise({ island: ["a", "b"], links: [{ source: "a", target: "b", id: "a->b" }], sides: new Map(), positions, boxes: { a: { width: 100, height: 40 }, b: { width: 100, height: 40 } }, routes: {} })
        assert.deepEqual(positions, { a: { x: 0, y: 0 }, b: { x: 10, y: 80 } })
    })
})

describe("separateLabels", () => {
    it("slides a label that sits too near another of the same source along its own edge", () => {
        const routes: Record<string, MutableRoute> = {
            one: { points: [[0, 0], [0, 100]], label: { x: 6, y: 10, width: 40, height: 22 } },
            two: { points: [[20, 0], [20, 100]], label: { x: 26, y: 10, width: 40, height: 22 } },
            three: { points: [[200, 0], [200, 100]], label: { x: 206, y: 10, width: 40, height: 22 } },
        }
        separateLabels(
            [
                { source: "s", target: "a", id: "one" },
                { source: "s", target: "b", id: "two" },
                { source: "t", target: "c", id: "three" },
                { source: "t", target: "d" },
            ],
            routes,
            8,
        )
        assert.equal(routes.one?.label?.y, 10)
        assert.ok((routes.two?.label?.y ?? 0) >= 10 + 22 + 8)
        assert.equal(routes.three?.label?.y, 10)
    })

    it("slides sideways along a sideways run, and leaves a label with no room where it is", () => {
        const routes: Record<string, MutableRoute> = {
            one: { points: [[0, 50], [100, 50]], label: { x: 10, y: 20, width: 40, height: 22 } },
            two: { points: [[0, 50], [10, 50]], label: { x: 12, y: 20, width: 40, height: 22 } },
        }
        separateLabels([{ source: "s", target: "a", id: "one" }, { source: "s", target: "b", id: "two" }], routes, 8)
        assert.equal(routes.one?.label?.x, 10)
        assert.ok((routes.two?.label?.x ?? 0) >= 12)
    })
})

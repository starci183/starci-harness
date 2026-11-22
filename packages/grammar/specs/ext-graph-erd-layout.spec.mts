import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { erdBounds, layoutErd } from "../src/core/ext/graph/erd/layout.ts"
import { ERD_WIDTH, erdPortY, resolveErd } from "../src/core/ext/graph/erd/model.ts"
import type { ErdEntity, ErdRelation } from "../src/core/ext/graph/erd/types.ts"

const field = (id: string) => ({ id, label: id })
const entities: ErdEntity[] = [
    { id: "customer", label: "Khách hàng", fields: [field("name")] },
    { id: "order", label: "Đơn hàng", fields: [field("code"), field("buyer")] },
    { id: "line", label: "Dòng đơn", fields: [field("order"), field("item")] },
    { id: "item", label: "Sản phẩm", fields: [field("name")] },
    { id: "staff", label: "Nhân viên", fields: [field("name"), field("boss")] },
]
const relations: ErdRelation[] = [
    { source: "order", field: "buyer", target: "customer", label: "1 khách · nhiều đơn" },
    { source: "line", field: "order", target: "order", label: "1 đơn · nhiều dòng" },
    { source: "line", field: "item", target: "item" },
    { source: "staff", field: "boss", target: "staff", label: "1 quản lý · nhiều người" },
]
const model = resolveErd(entities, relations)

const at = (layout: Awaited<ReturnType<typeof layoutErd>>, id: string): { x: number; y: number } => {
    const found = layout.positions[id]
    assert.ok(found)
    return found
}

describe("layoutErd", () => {
    it("gives the same coordinates for the same input, every time", async () => {
        assert.deepEqual(await layoutErd(model), await layoutErd(resolveErd([...entities], [...relations])))
    })

    it("stands what is pointed at left of what points, in columns", async () => {
        const layout = await layoutErd(model)
        assert.ok(at(layout, "customer").x + ERD_WIDTH < at(layout, "order").x)
        assert.ok(at(layout, "order").x + ERD_WIDTH < at(layout, "line").x)
        assert.ok(at(layout, "item").x + ERD_WIDTH < at(layout, "line").x)
    })

    it("routes a line from the middle of its field row to the middle of the head it points at, on the box borders", async () => {
        const layout = await layoutErd(model)
        const route = layout.routes["order.buyer>customer"]
        assert.ok(route)
        const first = route.points[0]
        const last = route.points[route.points.length - 1]
        assert.deepEqual(first, [at(layout, "order").x, at(layout, "order").y + erdPortY(1)])
        assert.deepEqual(last, [at(layout, "customer").x + ERD_WIDTH, at(layout, "customer").y + erdPortY("head")])
        assert.equal(route.fromSide, "L")
        assert.equal(route.toSide, "R")
        assert.ok(route.label)
    })

    it("draws a relation to its own entity beside the box, outside ELK, with its words clear of it", async () => {
        const layout = await layoutErd(model)
        const route = layout.routes["staff.boss>staff"]
        assert.ok(route)
        const x = at(layout, "staff").x + ERD_WIDTH
        assert.deepEqual(route.points.map((p) => p[0]), [x, x + 40, x + 40, x])
        assert.equal(route.points[0]?.[1], at(layout, "staff").y + erdPortY(1))
        assert.equal(route.points[3]?.[1], at(layout, "staff").y + erdPortY("head"))
        assert.ok((route.label?.x ?? 0) >= x + 40 + 8)
    })

    it("bounds every box, line and label", async () => {
        const layout = await layoutErd(model)
        const bounds = erdBounds(model, layout)
        for (const node of model.nodes) {
            const p = at(layout, node.id)
            assert.ok(p.x >= bounds.x && p.x + ERD_WIDTH <= bounds.x + bounds.width && p.y >= bounds.y && p.y + node.height <= bounds.y + bounds.height)
        }
        assert.deepEqual(erdBounds(resolveErd([], []), { positions: {}, routes: {} }), { x: 0, y: 0, width: 0, height: 0 })
    })
})

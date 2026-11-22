import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MARK_REACH, MARK_RING, endMarker, markerAngle, unitFrom } from "../src/core/ext/graph/erd/markers.ts"

describe("endMarker", () => {
    it("draws a crow's foot for many: three prongs from one point on the line to the box", () => {
        const marker = endMarker(true, false)
        assert.equal(marker.segments.length, 3)
        for (const [x1, , x2] of marker.segments) {
            assert.equal(x1, MARK_REACH)
            assert.equal(x2, 0)
        }
        assert.deepEqual(marker.segments.map((s) => s[3]).sort((a, b) => a - b), [-6, 0, 6])
        assert.equal(marker.ring, undefined)
        assert.equal(marker.length, MARK_REACH)
    })

    it("draws two bars across the line for one", () => {
        const marker = endMarker(false, false)
        assert.equal(marker.segments.length, 2)
        for (const [x1, y1, x2, y2] of marker.segments) {
            assert.equal(x1, x2)
            assert.equal(y1, -y2)
        }
        assert.ok(marker.segments.every((s) => s[0] > 0 && s[0] < MARK_REACH))
    })

    it("puts a ring beyond the foot or the bars when the end may be empty", () => {
        for (const many of [true, false]) {
            const marker = endMarker(many, true)
            assert.ok(marker.ring)
            assert.ok(marker.ring.x - marker.ring.r > MARK_REACH)
            assert.equal(marker.ring.x + marker.ring.r, MARK_RING)
            assert.equal(marker.length, MARK_RING)
        }
    })
})

describe("markerAngle and unitFrom", () => {
    it("turns the marker along the line away from its box", () => {
        assert.equal(markerAngle(1, 0), 0)
        assert.equal(markerAngle(0, 1), 90)
        assert.equal(markerAngle(-1, 0), 180)
        assert.equal(markerAngle(0, -1), -90)
    })

    it("gives the unit direction, or nothing for one point", () => {
        assert.deepEqual(unitFrom([0, 0], [0, 5]), [0, 1])
        assert.deepEqual(unitFrom([3, 3], [-1, 3]), [-1, 0])
        assert.equal(unitFrom([2, 2], [2, 2]), undefined)
    })
})

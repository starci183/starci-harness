/**
 * The first view of a lesson diagram (owner 2026-11-23: QA at 390px, a sequence opened at about 0.5 with labels of 7px): it is the whole drawing when
 * that stays readable, never under the readable floor, from the drawing's start when it does not fit, and the floor holds on a phone.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-graph-diagram-open.spec.mts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CONTROLS_ROW, INSETS, LEAST_OPEN_ZOOM, READABLE_ZOOM, canvasHeight, openFloor, openView, openZoom } from "../src/core/ext/graph/diagram/open.ts"

const PHONE = { width: 390, height: 480 }
const DESKTOP = { width: 820, height: 480 }
const WIDE_SEQUENCE = { width: 700, height: 520 }

describe("the readable floor of the first view", () => {
    it("is 0.85, so caption words (13px) stay at 11px or more", () => {
        assert.equal(READABLE_ZOOM, 0.85)
        assert.ok(13 * READABLE_ZOOM >= 11)
        assert.equal(openFloor("sequence"), READABLE_ZOOM)
        assert.equal(openFloor("graph"), READABLE_ZOOM)
        assert.equal(openFloor("other"), LEAST_OPEN_ZOOM)
    })

    it("opens a sequence too wide for a phone at the floor, not fitted at about 0.5", () => {
        const fitted = openZoom(PHONE, WIDE_SEQUENCE)
        assert.ok(fitted < 0.6)
        assert.equal(openZoom(PHONE, WIDE_SEQUENCE, READABLE_ZOOM), READABLE_ZOOM)
    })

    it("fits the whole drawing, centred, when it stays at or over the floor", () => {
        const drawing = { width: 300, height: 200 }
        const view = openView(PHONE, drawing, READABLE_ZOOM)
        assert.equal(view.zoom, 1)
        assert.equal(view.x, INSETS.left + (PHONE.width - INSETS.left - INSETS.right - drawing.width) / 2)
        assert.equal(view.y, INSETS.top + (PHONE.height - INSETS.top - INSETS.bottom - drawing.height) / 2)
        const wide = openView(DESKTOP, { width: 640, height: 300 }, READABLE_ZOOM)
        assert.ok(wide.zoom >= READABLE_ZOOM && wide.zoom <= 1)
    })

    it("never goes over 100%", () => {
        assert.equal(openZoom({ width: 2000, height: 2000 }, { width: 100, height: 100 }, READABLE_ZOOM), 1)
    })

    it("anchors a drawing that does not fit at its top left, first participant and first message", () => {
        const view = openView(PHONE, { width: 700, height: 900 }, READABLE_ZOOM)
        assert.equal(view.zoom, READABLE_ZOOM)
        assert.equal(view.x, INSETS.left)
        assert.equal(view.y, INSETS.top)
    })

    it("keeps a flowchart's entry node in view when the drawing is wider than the room", () => {
        const drawing = { width: 900, height: 300 }
        // Top-down: the entry node stands in the middle of a wide drawing; it is brought to the middle of the room.
        const entry = { x: 400, y: 0, width: 100, height: 40 }
        const view = openView(PHONE, drawing, READABLE_ZOOM, entry)
        assert.equal(view.zoom, READABLE_ZOOM)
        const room = PHONE.width - INSETS.left - INSETS.right
        const middle = view.x + (entry.x + entry.width / 2) * view.zoom
        assert.ok(Math.abs(middle - (INSETS.left + room / 2)) < 0.001)
        // Across: the entry node on the left edge keeps the drawing at its left inset.
        const across = openView(PHONE, drawing, READABLE_ZOOM, { x: 0, y: 130, width: 100, height: 40 })
        assert.equal(across.x, INSETS.left)
    })

    it("slides a tall drawing's start into view on the other axis", () => {
        const view = openView({ width: 390, height: 480 }, { width: 300, height: 2000 }, READABLE_ZOOM, { x: 100, y: 1400, width: 100, height: 40 })
        const room = 480 - INSETS.top - INSETS.bottom
        assert.ok(Math.abs(view.y + 1420 * view.zoom - (INSETS.top + room / 2)) < 0.001)
        assert.equal(view.y, INSETS.top + room / 2 - 1420 * view.zoom)
    })
})

describe("the canvas height at the floor", () => {
    it("grows to hold the whole drawing at the floor, so a top-down flowchart of 330 x 540 shows every node on a phone", () => {
        const drawing = { width: 330, height: 540 }
        const height = canvasHeight(390, drawing, 512, READABLE_ZOOM)
        assert.ok(height >= Math.round(drawing.height * READABLE_ZOOM + INSETS.top + INSETS.bottom + CONTROLS_ROW))
        const room = { width: 390, height: height - CONTROLS_ROW }
        const view = openView(room, drawing, READABLE_ZOOM)
        assert.ok(view.zoom >= READABLE_ZOOM)
        // Nothing is cut: the drawing at that zoom stands inside the room.
        assert.ok(view.y >= INSETS.top && view.y + drawing.height * view.zoom <= room.height - INSETS.bottom + 0.001)
        assert.ok(view.x >= INSETS.left && view.x + drawing.width * view.zoom <= room.width - INSETS.right + 0.001)
    })

    it("sizes the canvas for the floor zoom, between the reserved box and the tallest", () => {
        const drawing = { width: 700, height: 300 }
        const height = canvasHeight(390, drawing, 256, READABLE_ZOOM)
        assert.equal(height, Math.round(drawing.height * READABLE_ZOOM + INSETS.top + INSETS.bottom + CONTROLS_ROW))
        assert.ok(height >= 256)
    })

    it("stops at 40rem on a phone and 45rem elsewhere", () => {
        assert.equal(canvasHeight(390, { width: 300, height: 4000 }, 256, READABLE_ZOOM), 640)
        assert.equal(canvasHeight(820, { width: 300, height: 4000 }, 256, READABLE_ZOOM), 720)
    })
})

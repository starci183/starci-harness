/**
 * The first view of a lesson diagram, the fit rule (open.ts; Next UI audit round 3, 2026-11-25): the whole drawing is always in view, contain-fitted at
 * 100% or less and centred, clear of the controls row; the canvas grows for a tall drawing first (45rem, 35rem on a phone); a graph too wide to read
 * across is laid out top-down when that opens it larger; what still needs a zoom under 0.85 opens whole and small and the reader zooms in.
 *
 *   node --import ./specs/support/register.mts --test specs/ext-graph-diagram-open.spec.mts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    INSETS,
    READABLE_ZOOM,
    TALLEST,
    TALLEST_ON_PHONE,
    betterTopDown,
    canvasHeight,
    fittedZoom,
    needsTopDown,
    openView,
    openZoom,
    type Size,
} from "../src/core/ext/graph/diagram/open.ts"

const PHONE = { width: 390, height: 480 }
const DESKTOP = { width: 820, height: 480 }
const WIDE_SEQUENCE = { width: 700, height: 520 }

/** Every side of the drawing at the view stands inside the room: the frame less the insets, the bottom one the controls row. */
const assertWhole = (frame: Size, drawing: Size, view: { readonly x: number; readonly y: number; readonly zoom: number }): void => {
    const e = 0.001
    assert.ok(view.x >= INSETS.left - e, `left edge cut: ${String(view.x)}`)
    assert.ok(view.y >= INSETS.top - e, `top edge cut: ${String(view.y)}`)
    assert.ok(view.x + drawing.width * view.zoom <= frame.width - INSETS.right + e, "right edge cut")
    assert.ok(view.y + drawing.height * view.zoom <= frame.height - INSETS.bottom + e, "bottom edge cut or under the controls row")
}

/** The first view a drawing gets in a frame of this width: the canvas grown for it, then the view in that canvas. */
const firstView = (frameWidth: number, drawing: Size, reserved = 256) => {
    const frame = { width: frameWidth, height: canvasHeight(frameWidth, drawing, reserved) }
    return { frame, view: openView(frame, drawing) }
}

describe("the first view is contain-fit", () => {
    it("keeps 0.85 as the readable zoom, where caption words (13px) stay at 11px or more", () => {
        assert.equal(READABLE_ZOOM, 0.85)
        assert.ok(13 * READABLE_ZOOM >= 11)
    })

    it("is min(1, room width / width, room height / height)", () => {
        const room = { width: PHONE.width - INSETS.left - INSETS.right, height: PHONE.height - INSETS.top - INSETS.bottom }
        assert.equal(openZoom(PHONE, WIDE_SEQUENCE), Math.min(room.width / WIDE_SEQUENCE.width, room.height / WIDE_SEQUENCE.height))
        assert.equal(openZoom({ width: 2000, height: 2000 }, { width: 100, height: 100 }), 1)
    })

    it("centres a drawing that fits at 100%", () => {
        const drawing = { width: 300, height: 200 }
        const view = openView(PHONE, drawing)
        assert.equal(view.zoom, 1)
        assert.equal(view.x, INSETS.left + (PHONE.width - INSETS.left - INSETS.right - drawing.width) / 2)
        assert.equal(view.y, INSETS.top + (PHONE.height - INSETS.top - INSETS.bottom - drawing.height) / 2)
    })

    it("opens a sequence too wide for a phone whole, under the readable zoom, not cut at the floor", () => {
        const view = openView(PHONE, WIDE_SEQUENCE)
        assert.ok(view.zoom < READABLE_ZOOM)
        assertWhole(PHONE, WIDE_SEQUENCE, view)
    })

    it("never cuts a drawing on any side, whatever its shape, in any frame", () => {
        for (const frame of [PHONE, DESKTOP, { width: 358, height: 560 }, { width: 580, height: 720 }])
            for (const drawing of [{ width: 100, height: 3000 }, { width: 3000, height: 100 }, { width: 900, height: 900 }, { width: 40, height: 40 }]) assertWhole(frame, drawing, openView(frame, drawing))
    })
})

describe("a tall drawing (audit round 3: the last node cut by the frame and under the controls row)", () => {
    // The lesson question at 390px: five nodes top-down, about 330 wide and 540 tall; it opened at 100% in a 480px canvas, "Loyalty" cut in half.
    const QUESTION = { width: 330, height: 540 }

    it("grows the phone canvas for it, so it opens whole and readable", () => {
        const { frame, view } = firstView(390, QUESTION)
        assert.ok(frame.height > 480 && frame.height <= TALLEST_ON_PHONE)
        assert.ok(view.zoom >= READABLE_ZOOM)
        assertWhole(frame, QUESTION, view)
    })

    it("keeps the bottom node above the controls row", () => {
        const { frame, view } = firstView(390, QUESTION)
        assert.ok(view.y + QUESTION.height * view.zoom <= frame.height - INSETS.bottom + 0.001)
    })

    it("shrinks a drawing taller than the tallest canvas to fit it, never cutting it (lesson reading at 1440, Hình 1)", () => {
        const drawing = { width: 520, height: 1400 }
        const { frame, view } = firstView(820, drawing)
        assert.equal(frame.height, TALLEST)
        assert.equal(view.zoom, (TALLEST - INSETS.top - INSETS.bottom) / drawing.height)
        assertWhole(frame, drawing, view)
    })
})

describe("a wide drawing (audit round 3: nodes cut at the right edge, a connector off the left)", () => {
    it("fits the width of a drawing wider than the room, centred, on a phone (Essentials v2 lesson at 390px)", () => {
        // Laid out top-down it is still about 520 wide: stock :4003 was clipped and notify :4004 outside the frame.
        const drawing = { width: 520, height: 420 }
        const { frame, view } = firstView(390, drawing)
        assert.equal(view.zoom, (390 - INSETS.left - INSETS.right) / drawing.width)
        assertWhole(frame, drawing, view)
    })

    it("fits a drawing wider than a desktop column (lesson reading at 1440, section 6)", () => {
        const drawing = { width: 760, height: 1100 }
        const { frame, view } = firstView(580, drawing)
        assertWhole(frame, drawing, view)
        assert.ok(view.zoom <= (580 - INSETS.left - INSETS.right) / drawing.width)
    })

    it("tries a top-down layout only when the width does not fit the frame at the readable zoom", () => {
        assert.equal(needsTopDown(820, { width: 640, height: 300 }), false)
        assert.equal(needsTopDown(820, { width: 1200, height: 300 }), true)
        assert.equal(needsTopDown(390, { width: 460, height: 300 }), true)
    })

    it("keeps the top-down layout only when it opens larger than across", () => {
        // Across 1400 x 200 at 820: about 0.56. Top-down 500 x 700: the canvas grows to hold it at 1.
        assert.equal(betterTopDown(820, { width: 1400, height: 200 }, { width: 500, height: 700 }), true)
        // Top-down taller than the tallest canvas can hold larger than across: stay across.
        assert.equal(betterTopDown(820, { width: 1000, height: 200 }, { width: 300, height: 6000 }), false)
        // Across already readable: stay across.
        assert.equal(betterTopDown(820, { width: 700, height: 200 }, { width: 300, height: 600 }), false)
    })
})

describe("the canvas height", () => {
    it("holds the drawing at its width fit, between the reserved box and the tallest", () => {
        const drawing = { width: 700, height: 300 }
        const zoom = (390 - INSETS.left - INSETS.right) / drawing.width
        assert.equal(canvasHeight(390, drawing, 100), Math.ceil(drawing.height * zoom + INSETS.top + INSETS.bottom))
        assert.equal(canvasHeight(390, drawing, 400), 400)
    })

    it("stops at 35rem on a phone and 45rem elsewhere", () => {
        assert.equal(TALLEST_ON_PHONE, 560)
        assert.equal(TALLEST, 720)
        assert.equal(canvasHeight(390, { width: 300, height: 4000 }, 256), TALLEST_ON_PHONE)
        assert.equal(canvasHeight(820, { width: 300, height: 4000 }, 256), TALLEST)
    })

    it("gives the zoom the first view opens at once the canvas has grown", () => {
        assert.equal(fittedZoom(820, { width: 400, height: 300 }), 1)
        assert.equal(fittedZoom(390, { width: 716, height: 200 }), 0.5)
    })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { FADE_SHARE, TERMINAL_FALL, advance, isVisible, launch, opacityOf } from "./physics.ts"
import type { Random } from "../core/overlay.ts"
import type { ConfettiBurst } from "./physics.ts"
import { PRESETS } from "./presets.ts"

/** A seeded random source (mulberry32), so every run launches the same pieces. */
export const seeded = (seed: number): Random => {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const VIEWPORT = { width: 1000, height: 800 }
const UP: ConfettiBurst = { origin: { x: 0.5, y: 1 }, angle: 90, spread: 0, count: 40, velocity: 1000 }

describe("launch", () => {
    it("throws count pieces from the origin, in the given colours", () => {
        const pieces = launch(UP, VIEWPORT, ["red", "blue"], seeded(1))
        assert.equal(pieces.length, 40)
        for (const piece of pieces) {
            assert.equal(piece.x, 500)
            assert.equal(piece.y, 800)
            assert.ok(["red", "blue"].includes(piece.color))
            assert.ok(piece.vy < 0, "a shot aimed up moves up")
            assert.ok(Math.abs(piece.vx) < 1e-6, "no spread keeps it vertical")
        }
        assert.ok(pieces.some((piece) => piece.shape === "dot"))
        assert.ok(pieces.some((piece) => piece.shape === "strip"))
    })

    it("aims the corner cannons of celebrate across the middle", () => {
        const [left, right] = PRESETS.celebrate
        assert.ok(left !== undefined && right !== undefined)
        assert.ok(launch(left, VIEWPORT, ["a"], seeded(2)).every((piece) => piece.vx > 0))
        assert.ok(launch(right, VIEWPORT, ["a"], seeded(2)).every((piece) => piece.vx < 0))
    })

    it("refuses an empty palette", () => {
        assert.throws(() => launch(UP, VIEWPORT, [], seeded(3)), /at least one colour/)
    })
})

describe("advance", () => {
    it("slows the climb, then lets the piece fall no faster than paper", () => {
        const [piece] = launch(UP, VIEWPORT, ["a"], seeded(4))
        assert.ok(piece !== undefined)
        const startY = piece.y
        advance(piece, 0.05)
        assert.ok(piece.y < startY, "it climbs first")
        for (let index = 0; index < 100; index += 1) advance(piece, 0.05)
        assert.ok(piece.vy > 0 && piece.vy <= TERMINAL_FALL)
        assert.ok(Math.abs(piece.age - 5.05) < 1e-9)
    })
})

describe("opacityOf and isVisible", () => {
    it("holds a piece whole, fades it over the last part of its life, then hides it", () => {
        const [piece] = launch(UP, VIEWPORT, ["a"], seeded(5))
        assert.ok(piece !== undefined)
        assert.equal(opacityOf(piece), 1)
        piece.age = piece.life * (1 - FADE_SHARE / 2)
        assert.ok(opacityOf(piece) > 0.4 && opacityOf(piece) < 0.6)
        assert.equal(isVisible(piece, VIEWPORT), true)
        piece.age = piece.life
        assert.equal(opacityOf(piece), 0)
        assert.equal(isVisible(piece, VIEWPORT), false)
    })

    it("hides a piece that fell below the bottom edge", () => {
        const [piece] = launch(UP, VIEWPORT, ["a"], seeded(6))
        assert.ok(piece !== undefined)
        piece.y = VIEWPORT.height + 100
        assert.equal(isVisible(piece, VIEWPORT), false)
    })
})

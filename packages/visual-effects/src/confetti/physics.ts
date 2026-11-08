import type { Random, Viewport } from "../core/overlay.ts"

/** The shape a confetti piece is drawn as: a paper strip that tumbles, or a round dot. */
export type PieceShape = "strip" | "dot"

/** One cannon shot: where it fires from, where it aims, and how many pieces it throws how hard. */
export interface ConfettiBurst {
    /** The origin as a fraction of the viewport, 0 to 1 on each axis (0.5, 0.6 is a little below the centre). */
    readonly origin: { readonly x: number; readonly y: number }
    /** The aim in degrees: 90 is straight up, 60 up and to the right, 120 up and to the left. */
    readonly angle: number
    /** The cone the pieces scatter in, in degrees around the aim. */
    readonly spread: number
    /** How many pieces the shot throws. */
    readonly count: number
    /** The launch speed in pixels per second; each piece takes 55 to 100% of it. */
    readonly velocity: number
}

/** One piece in flight. Positions are pixels, velocities pixels per second, angles radians. */
export interface Piece {
    x: number
    y: number
    vx: number
    vy: number
    rotation: number
    spin: number
    /** The tumble phase: a strip's apparent height is its height times |cos(tilt)|. */
    tilt: number
    tiltSpeed: number
    readonly width: number
    readonly height: number
    readonly color: string
    readonly shape: PieceShape
    /** Seconds since launch; the piece fades over the last part of `life`. */
    age: number
    readonly life: number
}

/** Downward pull in pixels per second squared. */
export const GRAVITY = 1100
/** The share of speed a piece keeps per second against the air (paper slows fast, then flutters down). */
export const DRAG_PER_SECOND = 0.3
/** The fall speed paper settles at, in pixels per second. */
export const TERMINAL_FALL = 240
/** The part of its life over which a piece fades out. */
export const FADE_SHARE = 0.25

const DEGREE = Math.PI / 180

/** Picks one entry of a non-empty list. */
const pick = <T>(items: readonly T[], random: Random): T => {
    const item = items[Math.floor(random() * items.length) % items.length]
    if (item === undefined) throw new Error("pick needs a non-empty list")
    return item
}

/** Launches the pieces of one burst from its origin in the viewport, each in a colour of `colors`. */
export const launch = (burst: ConfettiBurst, viewport: Viewport, colors: readonly string[], random: Random): Piece[] => {
    if (colors.length === 0) throw new Error("confetti needs at least one colour")
    const pieces: Piece[] = []
    for (let index = 0; index < burst.count; index += 1) {
        const direction = (burst.angle + (random() - 0.5) * burst.spread) * DEGREE
        const speed = burst.velocity * (0.55 + random() * 0.45)
        const shape: PieceShape = random() < 0.8 ? "strip" : "dot"
        const size = 6 + random() * 6
        pieces.push({
            x: burst.origin.x * viewport.width,
            y: burst.origin.y * viewport.height,
            vx: Math.cos(direction) * speed,
            vy: -Math.sin(direction) * speed,
            rotation: random() * Math.PI * 2,
            spin: (random() - 0.5) * 12,
            tilt: random() * Math.PI * 2,
            tiltSpeed: 4 + random() * 8,
            width: shape === "dot" ? size * 0.7 : size,
            height: shape === "dot" ? size * 0.7 : size * 0.45,
            color: pick(colors, random),
            shape,
            age: 0,
            life: 2.4 + random() * 1.4,
        })
    }
    return pieces
}

/** Advances one piece by `seconds`: gravity, air drag, a capped fall, and the spin and tumble. */
export const advance = (piece: Piece, seconds: number): void => {
    const keep = Math.pow(DRAG_PER_SECOND, seconds)
    piece.vx *= keep
    piece.vy = Math.min(piece.vy * keep + GRAVITY * seconds, TERMINAL_FALL)
    piece.x += piece.vx * seconds
    piece.y += piece.vy * seconds
    piece.rotation += piece.spin * seconds
    piece.tilt += piece.tiltSpeed * seconds
    piece.age += seconds
}

/** How opaque a piece is now: whole until the last FADE_SHARE of its life, then down to 0. */
export const opacityOf = (piece: Piece): number => {
    const fadeFrom = piece.life * (1 - FADE_SHARE)
    if (piece.age <= fadeFrom) return 1
    return Math.max(0, 1 - (piece.age - fadeFrom) / (piece.life - fadeFrom))
}

/** Whether a piece still shows: alive and not yet below the bottom edge. */
export const isVisible = (piece: Piece, viewport: Viewport): boolean => piece.age < piece.life && piece.y < viewport.height + piece.width * 2

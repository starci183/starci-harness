import type { ConfettiBurst } from "./physics.ts"

/** The named shots: `celebrate` for a finished purchase or set-up, `burst` for a smaller win. */
export type ConfettiPreset = "celebrate" | "burst"

/**
 * `celebrate`: two cannons from the bottom corners crossing over the middle, then a burst from the centre.
 * `burst`: one burst from a little below the centre.
 */
export const PRESETS: Readonly<Record<ConfettiPreset, readonly ConfettiBurst[]>> = {
    celebrate: [
        { origin: { x: 0, y: 0.9 }, angle: 60, spread: 40, count: 90, velocity: 1700 },
        { origin: { x: 1, y: 0.9 }, angle: 120, spread: 40, count: 90, velocity: 1700 },
        { origin: { x: 0.5, y: 0.45 }, angle: 90, spread: 360, count: 70, velocity: 900 },
    ],
    burst: [{ origin: { x: 0.5, y: 0.6 }, angle: 90, spread: 70, count: 80, velocity: 1300 }],
}

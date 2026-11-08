import type { ConfettiBurst } from "./physics.ts"

/** The named shots: `celebrate` for a finished purchase or set-up, `burst` for a smaller win. */
export type ConfettiPreset = "celebrate" | "burst"

/**
 * `celebrate`: two cannons from the bottom corners crossing over the middle, then a burst from the centre.
 * `burst`: one burst from a little below the centre.
 */
export const PRESETS: Readonly<Record<ConfettiPreset, readonly ConfettiBurst[]>> = {
    celebrate: [
        { origin: { x: 0, y: 1 }, angle: 62, spread: 34, count: 110, velocity: 2600 },
        { origin: { x: 1, y: 1 }, angle: 118, spread: 34, count: 110, velocity: 2600 },
        { origin: { x: 0.5, y: 0.35 }, angle: 90, spread: 360, count: 80, velocity: 1100 },
    ],
    burst: [{ origin: { x: 0.5, y: 0.6 }, angle: 90, spread: 70, count: 90, velocity: 1800 }],
}

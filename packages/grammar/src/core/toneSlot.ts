import type { CSSProperties } from "react"

/**
 * A TONE SLOT (0.55.1, owner 2026-11-23 "Chuyển về NIVO"): an app's own soft pair, handed to a mark the way an icon is, so an app keeps its own
 * identity palette (which colour a team, a room or an agent wears) and the Grammar owns none of it. `soft` paints the plate and `ink` the letters or
 * the glyph on it: two CSS colours, or `var()` refs of the app's own tokens so its light and dark themes follow. The contrast of the pair is the
 * caller's: give an ink that reads on its plate (4.5:1) in both themes.
 */
export type ToneSlot = {
    /** The plate: a CSS colour or a `var(--app-token)` ref. */
    readonly soft: string
    /** The letters or the glyph on the plate: a CSS colour or a `var(--app-token)` ref. */
    readonly ink: string
}

/** Whether a tone prop is a slot (an object) rather than one of a component's named tones (a word). */
export const isToneSlot = (tone: unknown): tone is ToneSlot =>
    typeof tone === "object" && tone !== null && typeof (tone as ToneSlot).soft === "string" && typeof (tone as ToneSlot).ink === "string"

/** The two variables a slot paints through; one rule per component reads them (`--grammar-tone-slot-soft`, `--grammar-tone-slot-ink`). */
export const toneSlotStyle = (slot: ToneSlot): CSSProperties => ({ "--grammar-tone-slot-soft": slot.soft, "--grammar-tone-slot-ink": slot.ink }) as CSSProperties

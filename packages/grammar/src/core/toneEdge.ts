/**
 * THE TONE EDGE (0.55.0): one rule for a card face that waits on the reader ("card chờ duyệt có viền vàng" is `warning`). The face keeps its own 1px
 * edge and fill; only the edge's colour becomes the tone's standard `--<tone>-border` (common/tones-border.css). `SurfaceCard tone` and
 * `MessageBubble content="card" tone` both put `toneEdgeProps` on the element that draws the edge, and `.starci-core-*` never restyle it again.
 */
export const TONE_EDGES = Object.freeze(["neutral", "accent", "info", "success", "warning", "danger"] as const)
export type ToneEdge = (typeof TONE_EDGES)[number]

/** The attribute the one CSS rule reads (`[data-grammar-tone-edge]` in common/styles.css). */
export const toneEdgeProps = (tone: ToneEdge | undefined): { readonly "data-grammar-tone-edge"?: ToneEdge } =>
    tone === undefined ? {} : { "data-grammar-tone-edge": tone }

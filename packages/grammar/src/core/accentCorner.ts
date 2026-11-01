/**
 * One logical corner of the viewport that takes the family's accent radius (`--grammar-accent-corner`). Logical, so it follows
 * the writing direction. A leaf names it without importing a frame.
 */
export type AccentCorner = "start-start" | "start-end" | "end-start" | "end-end"

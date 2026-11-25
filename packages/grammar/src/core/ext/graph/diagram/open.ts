/**
 * The first view of a diagram (pure): the whole drawing when it fits at a readable zoom, else the drawing at that floor, anchored at its start so the
 * reader pans on. The floor is the zoom under which the caption-role words of a node or a message drop under 11px (13px x 0.85), so a sequence or a
 * flowchart never opens smaller; only a kind drawn as Mermaid's own SVG (its words are not ours) keeps the canvas's least zoom.
 */

export interface Size {
    readonly width: number
    readonly height: number
}

export interface Box extends Size {
    readonly x: number
    readonly y: number
}

/** The room round the drawing at the first view: the controls row along the bottom (40 + 2 x 8). */
export const INSETS = { top: 16, right: 16, bottom: 64, left: 16 } as const

/** The least zoom of the canvas, the floor of a kind whose words are not ours to size. */
export const LEAST_OPEN_ZOOM = 0.2

/** The zoom under which caption-role words (13px) fall under 11px: the floor of a sequence and of a flowchart or state diagram. */
export const READABLE_ZOOM = 0.85

/** The tallest the canvas grows to fit a drawing, and on a phone (a finger on it pans, so the page must stay in reach past it). */
export const TALLEST = 720
export const TALLEST_ON_PHONE = 480

/** The floor of the first view for a drawing kind. */
export const openFloor = (kind: "graph" | "sequence" | "other"): number => (kind === "other" ? LEAST_OPEN_ZOOM : READABLE_ZOOM)

const roomOf = (frame: Size): Size => ({ width: frame.width - INSETS.left - INSETS.right, height: frame.height - INSETS.top - INSETS.bottom })

/**
 * The zoom of the first view in a frame: the whole drawing when it fits at 100% or less and stays at or over `floor`; else the drawing FITTED TO THE
 * WIDTH when that stays at or over `floor` (Next v0.0.10 audit: a wide flowchart opened at the floor and cut its last node off the canvas although its
 * whole width fitted readably; a drawing taller than the room pans down instead); else `floor`, anchored at the start.
 */
export const openZoom = (frame: Size, drawing: Size, floor: number = LEAST_OPEN_ZOOM): number => {
    const room = roomOf(frame)
    const widthFit = room.width / Math.max(1, drawing.width)
    const fit = Math.min(widthFit, room.height / Math.max(1, drawing.height))
    if (fit >= floor) return Math.min(1, fit)
    if (widthFit >= floor) return Math.min(1, widthFit)
    return floor
}

/**
 * Whether a graph laid out left to right is laid out again top-down for its frame: its width does not fit the room at the readable zoom, so across it
 * would open cut at the floor (Next v0.0.10 audit). A phone lays every graph out top-down already.
 */
export const needsTopDown = (frameWidth: number, drawing: Size, floor: number = READABLE_ZOOM): boolean =>
    (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width) < floor

/** The canvas height for a frame width: the drawing as large as the width lets it (never under `floor`), between the reserved box and the tallest. */
export const canvasHeight = (frameWidth: number, drawing: Size, reserved: number, floor: number = LEAST_OPEN_ZOOM): number => {
    const zoom = Math.max(floor, Math.min(1, (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width)))
    const tallest = frameWidth < 480 ? TALLEST_ON_PHONE : TALLEST
    return Math.round(Math.max(reserved, Math.min(Math.max(reserved, tallest), drawing.height * zoom + INSETS.top + INSETS.bottom)))
}

/**
 * Where the drawing's origin stands in the frame at the first view, per axis: centred where the drawing fits, else from its start. The start is the
 * drawing's top left (a sequence: its first participant and first message), or `start`'s box (a flowchart's entry node) kept in view: the drawing
 * slides only as far as the entry node's middle needs to stand in the middle of the room.
 */
export const openView = (frame: Size, drawing: Size, floor: number = LEAST_OPEN_ZOOM, start?: Box): { readonly x: number; readonly y: number; readonly zoom: number } => {
    const zoom = openZoom(frame, drawing, floor)
    const room = roomOf(frame)
    const axis = (inset: number, space: number, length: number, at: number | undefined): number => {
        if (length * zoom <= space) return inset + (space - length * zoom) / 2
        return at === undefined ? inset : inset + Math.min(0, space / 2 - at * zoom)
    }
    return {
        zoom,
        x: axis(INSETS.left, room.width, drawing.width, start === undefined ? undefined : start.x + start.width / 2),
        y: axis(INSETS.top, room.height, drawing.height, start === undefined ? undefined : start.y + start.height / 2),
    }
}

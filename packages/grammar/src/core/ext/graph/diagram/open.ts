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

/** The room round the drawing at the first view. The zoom controls are a row of their own under the canvas, never over the drawing. */
export const INSETS = { top: 16, right: 16, bottom: 16, left: 16 } as const

/** The controls row under the canvas: the 40px buttons and 8px above and below. */
export const CONTROLS_ROW = 56

/** The least zoom of the canvas, the floor of a kind whose words are not ours to size. */
export const LEAST_OPEN_ZOOM = 0.2

/** The zoom under which caption-role words (13px) fall under 11px: the floor of a sequence and of a flowchart or state diagram. */
export const READABLE_ZOOM = 0.85

/** The tallest the canvas grows to hold the WHOLE drawing at its open zoom (owner 2026-11-23): 45rem, and 40rem on a phone. A taller drawing opens at the floor from its start. */
export const TALLEST = 720
export const TALLEST_ON_PHONE = 640

/** The floor of the first view for a drawing kind. */
export const openFloor = (kind: "graph" | "sequence" | "other"): number => (kind === "other" ? LEAST_OPEN_ZOOM : READABLE_ZOOM)

const roomOf = (frame: Size): Size => ({ width: frame.width - INSETS.left - INSETS.right, height: frame.height - INSETS.top - INSETS.bottom })

/** The zoom of the first view in a frame: the whole drawing when it fits at 100% or less, never under `floor`. */
export const openZoom = (frame: Size, drawing: Size, floor: number = LEAST_OPEN_ZOOM): number => {
    const room = roomOf(frame)
    const fit = Math.min(room.width / Math.max(1, drawing.width), room.height / Math.max(1, drawing.height))
    return Math.max(floor, Math.min(1, fit))
}

/** The canvas height for a frame width: the drawing as large as the width lets it (never under `floor`), between the reserved box and the tallest. */
export const canvasHeight = (frameWidth: number, drawing: Size, reserved: number, floor: number = LEAST_OPEN_ZOOM): number => {
    const zoom = Math.max(floor, Math.min(1, (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width)))
    const tallest = frameWidth < 480 ? TALLEST_ON_PHONE : TALLEST
    return Math.round(Math.max(reserved, Math.min(Math.max(reserved, tallest), drawing.height * zoom + INSETS.top + INSETS.bottom + CONTROLS_ROW)))
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

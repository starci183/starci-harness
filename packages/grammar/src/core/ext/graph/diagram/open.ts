/**
 * The first view of a diagram (pure). The fit rule (Next UI audit round 3, 2026-11-25: a tall drawing opened at 100% with its last node cut by the frame
 * and under the controls row; a wide one opened at the readable floor cut on both sides):
 *
 * 1. The whole drawing is always in view at the first view: CONTAIN-FIT, zoom = min(1, roomWidth / width, roomHeight / height), centred in the room. No
 *    node is cut on any side, and the room leaves the controls row (`INSETS.bottom`) clear, so the buttons never stand over the drawing.
 * 2. Height is bought first: the canvas grows to hold the drawing at its WIDTH fit (`canvasHeight`), up to `TALLEST` (45rem) or `TALLEST_ON_PHONE`
 *    (35rem, so a finger still reaches the page past it). A tall drawing therefore shrinks only when even the tallest canvas cannot hold it.
 * 3. Width is bought by the layout: a flowchart or state diagram is laid out top-down on a phone, and elsewhere when that opens it larger than across
 *    (`betterTopDown`).
 * 4. What still needs a zoom under `READABLE_ZOOM` (0.85, caption words under 11px) opens whole and small: the reader zooms in with +, pinch or a double
 *    tap, and reset (0) returns to this view. A cut first view hides a part the reader cannot know is there; a small one only asks for a zoom.
 */

export interface Size {
    readonly width: number
    readonly height: number
}

export interface Box extends Size {
    readonly x: number
    readonly y: number
}

/** The room round the drawing at the first view: the controls row along the bottom (40 + 2 x 8) stays clear of the drawing. */
export const INSETS = { top: 16, right: 16, bottom: 64, left: 16 } as const

/** The least zoom the canvas offers to the reader's zoom out; a first view that needs less (a very large drawing) lowers it to its own zoom. */
export const LEAST_OPEN_ZOOM = 0.2

/** The zoom under which caption-role words (13px) fall under 11px: the readable zoom a layout aims for (a flowchart turned top-down to reach it). */
export const READABLE_ZOOM = 0.85

/** The tallest the canvas grows to fit a drawing (45rem), and on a phone (35rem: a finger on it pans, so the page must stay in reach past it). */
export const TALLEST = 720
export const TALLEST_ON_PHONE = 560

/** The frame width under which the canvas keeps to the phone's tallest. */
const PHONE_FRAME = 480

const roomOf = (frame: Size): Size => ({ width: frame.width - INSETS.left - INSETS.right, height: frame.height - INSETS.top - INSETS.bottom })

/** The zoom that fits the drawing's width in a frame of that width, at 100% or less. */
const widthFit = (frameWidth: number, drawing: Size): number => Math.min(1, (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width))

/** The zoom of the first view in a frame: contain-fit, the whole drawing at 100% or less, whatever that zoom is (rule 1). */
export const openZoom = (frame: Size, drawing: Size): number => {
    const room = roomOf(frame)
    return Math.max(0.01, Math.min(1, room.width / Math.max(1, drawing.width), room.height / Math.max(1, drawing.height)))
}

/** The canvas height for a frame width: the drawing at its width fit plus the insets, between the reserved box and the tallest (rule 2). */
export const canvasHeight = (frameWidth: number, drawing: Size, reserved: number): number => {
    const tallest = frameWidth < PHONE_FRAME ? TALLEST_ON_PHONE : TALLEST
    // Rounded up: a canvas rounded down would leave the height fit a hair under the width fit.
    return Math.ceil(Math.max(reserved, Math.min(Math.max(reserved, tallest), drawing.height * widthFit(frameWidth, drawing) + INSETS.top + INSETS.bottom)))
}

/** The zoom a drawing opens at in a frame of that width, once the canvas has grown for it (rules 1 and 2). */
export const fittedZoom = (frameWidth: number, drawing: Size, reserved = 0): number =>
    openZoom({ width: frameWidth, height: canvasHeight(frameWidth, drawing, reserved) }, drawing)

/**
 * Whether a graph laid out left to right is better laid out top-down for its frame (rule 3): across it would open under the readable zoom, and top-down it
 * opens larger. A phone lays every graph out top-down already.
 */
export const betterTopDown = (frameWidth: number, across: Size, down: Size): boolean => {
    const acrossZoom = fittedZoom(frameWidth, across)
    return acrossZoom < READABLE_ZOOM && fittedZoom(frameWidth, down) > acrossZoom
}

/** Whether a graph laid out left to right needs a top-down layout tried: its width does not fit the room at the readable zoom. */
export const needsTopDown = (frameWidth: number, drawing: Size): boolean => (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width) < READABLE_ZOOM

/** The first view in a frame: the contain-fit zoom, the drawing centred in the room on both axes. */
export const openView = (frame: Size, drawing: Size): { readonly x: number; readonly y: number; readonly zoom: number } => {
    const zoom = openZoom(frame, drawing)
    const room = roomOf(frame)
    return {
        zoom,
        x: INSETS.left + (room.width - drawing.width * zoom) / 2,
        y: INSETS.top + (room.height - drawing.height * zoom) / 2,
    }
}

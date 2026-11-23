/**
 * The first view of every graph mode, on every screen alike (owner: "Chốt", the routing law, rule 4): fitted. The whole graph is visible, centred in the frame
 * inside the insets (the zoom buttons' room), at 100% or less, never enlarged. Only a graph that would need less than `LEAST_FIT` is shown at that zoom, centred on
 * its focus (the running step, the heaviest bubble or the app's `focusId`; none: its start), its start never further in than the inset.
 */

/** The least zoom the first view fits to (xyflow's own least zoom of the graphs). */
export const LEAST_FIT = 0.1

/** A box in graph units. */
export interface ViewRect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** The room kept round the graph at the first view: on the left the 40px zoom buttons (16 + 40 + 16). */
export interface ViewInsets {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
}

export interface OpenView {
    readonly x: number
    readonly y: number
    readonly zoom: number
}

/** One axis: the translation that puts `[start, start + size]` (the graph) in `[lead, frame - trail]`, or centres `centre` there when the graph does not fit. */
const axis = (frame: number, lead: number, trail: number, start: number, size: number, centre: number | undefined): number => {
    const room = frame - lead - trail
    if (size <= room || centre === undefined) return size <= room ? lead + (room - size) / 2 - start : lead - start
    const wanted = lead + room / 2 - centre
    // The graph's start never further in than `lead` (no empty canvas before it). Its end is not held: pulling a last step to the end would push the steps
    // before it under the zoom buttons.
    return Math.min(lead - start, wanted)
}

/** The fitted view of `bounds` in a `frame` (screen pixels): the whole graph, centred, at 100% or less; centred on `focus` only below `LEAST_FIT`. */
export const openView = (frame: { readonly width: number; readonly height: number }, bounds: ViewRect, focus: ViewRect | undefined, insets: ViewInsets): OpenView => {
    const fit = Math.min((frame.width - insets.left - insets.right) / Math.max(1, bounds.width), (frame.height - insets.top - insets.bottom) / Math.max(1, bounds.height))
    const zoom = Math.max(LEAST_FIT, Math.min(1, fit))
    const scaled = (value: number): number => value * zoom
    return {
        x: axis(frame.width, insets.left, insets.right, scaled(bounds.x), scaled(bounds.width), focus === undefined ? undefined : scaled(focus.x + focus.width / 2)),
        y: axis(frame.height, insets.top, insets.bottom, scaled(bounds.y), scaled(bounds.height), focus === undefined ? undefined : scaled(focus.y + focus.height / 2)),
        zoom,
    }
}

/** The gap kept between a step and the zoom buttons. */
const CONTROLS_GAP = 8

const meets = (a: ViewRect, b: ViewRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * The first view moved so the zoom buttons (`controls`, in frame pixels) cover no step (`steps`, in graph units), the focus staying wholly in the frame: the
 * covered steps go off the start edge (a shift toward the start) or below the bottom edge (a shift down), whichever keeps the focus in view; else the view is kept.
 */
export const clearOfControls = (first: OpenView, frame: { readonly width: number; readonly height: number }, steps: readonly ViewRect[], focus: ViewRect, controls: ViewRect): OpenView => {
    const guard = { x: controls.x - CONTROLS_GAP, y: controls.y - CONTROLS_GAP, width: controls.width + 2 * CONTROLS_GAP, height: controls.height + 2 * CONTROLS_GAP }
    const at = (v: OpenView, r: ViewRect): ViewRect => ({ x: r.x + v.x, y: r.y + v.y, width: r.width, height: r.height })
    const covered = (v: OpenView): ViewRect[] => steps.map((step) => at(v, step)).filter((step) => meets(step, guard))
    const fits = (v: OpenView): boolean => {
        const f = at(v, focus)
        return f.x >= 0 && f.y >= 0 && f.x + f.width <= frame.width && f.y + f.height <= frame.height && !meets(f, guard)
    }
    let view = first
    let hit = covered(view)
    for (let pass = 0; pass < 4 && hit.length > 0; pass += 1) {
        const left = { ...view, x: view.x - (Math.max(...hit.map((step) => step.x + step.width)) - guard.x) }
        const down = { ...view, y: view.y + (frame.height - Math.min(...hit.map((step) => step.y))) }
        const next = [left, down].filter(fits).sort((a, b) => covered(a).length - covered(b).length)[0]
        if (next === undefined) return first
        view = next
        hit = covered(view)
    }
    return hit.length === 0 ? view : first
}

/** The views of a screen: the design alone, the comparison of design and shot (side by side, a slider, an onion skin, a difference), the shot alone. */
export type View = "design" | "side" | "slider" | "onion" | "diff" | "shot"
export const COMPARE_VIEWS: readonly View[] = ["side", "slider", "onion", "diff"]
export const VIEWS: readonly View[] = ["design", "side", "slider", "onion", "diff", "shot"]

/** The view to draw: the one asked for, or the side that exists when the screen has only a design or only a shot at this width (a comparison needs both). */
export function effectiveView(asked: View, hasDesign: boolean, hasShot: boolean): View {
    if (hasDesign && hasShot) return asked
    if (hasDesign) return "design"
    if (hasShot) return "shot"
    return asked
}

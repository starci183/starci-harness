import { createElement, type ComponentType, type ReactElement, type SVGProps } from "react"
import { glyphSource, type GlyphName } from "./glyphs.js"

/**
 * An outline glyph of the closed vocabulary as a bare element, for the slots of a vendor component that clones its child (a Select indicator, a number
 * stepper, a search icon, an alert indicator): the vendor's defaults are filled glyphs, and Grammar's icons are outline only. Every glyph is sized by the Icon usage
 * box (`.starci-core-icon[data-usage]`, 16 at `chip`) and carries width and height 16 as a floor, so a slot with no size rule never stretches it to its container (0.37.5).
 */
export const inlineGlyph = (name: GlyphName, extra: SVGProps<SVGSVGElement> = {}, usage: "heading" | "leading" | "chip" = "chip"): ReactElement =>
    createElement(glyphSource(name) as ComponentType<SVGProps<SVGSVGElement>>, { "aria-hidden": true, focusable: "false", className: "starci-core-icon", "data-usage": usage, width: 16, height: 16, ...extra } as SVGProps<SVGSVGElement>)

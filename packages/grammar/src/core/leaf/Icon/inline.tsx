import { createElement, type ComponentType, type ReactElement, type SVGProps } from "react"
import { glyphSource, type GlyphName } from "./glyphs.js"

/**
 * An outline glyph of the closed vocabulary as a bare element, for the slots of a vendor component that clones its child (a Select indicator, a number
 * stepper, a search icon, an alert indicator): the vendor's defaults are filled glyphs, and Grammar's icons are outline only.
 */
export const inlineGlyph = (name: GlyphName, extra: SVGProps<SVGSVGElement> = {}): ReactElement =>
    createElement(glyphSource(name) as ComponentType<SVGProps<SVGSVGElement>>, { "aria-hidden": true, focusable: "false", ...extra })

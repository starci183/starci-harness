/**
 * `starci/spacing-scale` (HFS R350 `FE_SPACING_OFF_SCALE`): a padding, margin, gap or scroll inset takes a step of
 * the Grammar's spacing scale, 0 4 8 12 24 32 (`@starci/grammar` `src/common/spacing.ts`), and never a fluid value.
 *
 * The scale is the one source of every distance: a 6px meter gap or a 3px body offset is a second, private scale,
 * and `clamp(1rem, 3vw, 2rem)` is a value no breakpoint owns. A length is judged in `rem` (0.25, 0.5, 0.75, 1.5, 2) or
 * in `px` at 16px to the rem (4, 8, 12, 24, 32), either sign, wherever it is written: the value, a `var()` fallback, a
 * `calc()` term. A hairline or stroke of 1px or 2px is a line, not a step, and passes. `em` and `%` are relative to the
 * box's own font or size and are not spacing steps. Viewport units and `clamp()` are refused in a spacing property.
 */
import valueParser from "postcss-value-parser"
import { makeRule } from "./lib/make-rule.ts"

/** The scale in rem (at 16px to the rem), the zero step included. */
export const SPACING_SCALE_REM: readonly number[] = [0, 0.25, 0.5, 0.75, 1.5, 2]
/** Lines, not steps: a hairline seam or a stroke width. */
const STROKES_PX: readonly number[] = [1, 2]

/** The properties that place content off an edge or apart from a sibling, and custom properties that carry one. */
const SPACING_PROPERTY = /^(?:padding|margin|scroll-padding|scroll-margin)(?:-[a-z-]+)?$|^(?:gap|row-gap|column-gap)$/
const SPACING_TOKEN = /^--[\w-]*(?:gap|inset|padding|gutter)[\w-]*$/
const VIEWPORT = new Set(["vw", "vh", "vi", "vb", "vmin", "vmax", "svw", "svh", "lvw", "lvh", "dvw", "dvh"])

const onScale = (amount: number, unit: string): boolean => {
  const size = Math.abs(amount)
  if (unit === "px") return STROKES_PX.includes(size) || SPACING_SCALE_REM.some((step) => Math.abs(step * 16 - size) < 0.001)
  return SPACING_SCALE_REM.some((step) => Math.abs(step - size) < 0.0005)
}

/** True when the property places spacing (its custom-property carriers included). */
export const isSpacingProperty = (prop: string): boolean => SPACING_PROPERTY.test(prop.toLowerCase()) || SPACING_TOKEN.test(prop)

export const spacingScale = makeRule(
  "spacing-scale",
  {
    off: (prop: string, length: string) =>
      `\`${prop}: ${length}\` is not a step of the spacing scale (0 4 8 12 24 32). Name the step by its role through a Grammar token.`,
    fluid: (prop: string, what: string) =>
      `\`${prop}\` is fluid (\`${what}\`). A spacing value steps by breakpoint; it never follows the viewport.`,
  },
  ({ root, report }) => {
    root.walkDecls((decl) => {
      if (!isSpacingProperty(decl.prop)) return
      valueParser(decl.value).walk((node) => {
        if (node.type === "function" && node.value.toLowerCase() === "clamp") {
          report(decl, "fluid", [decl.prop, "clamp()"], { word: "clamp" })
          return
        }
        if (node.type !== "word") return
        const parsed = valueParser.unit(node.value)
        if (parsed === false) return
        const unit = parsed.unit.toLowerCase()
        const amount = Number.parseFloat(parsed.number)
        if (VIEWPORT.has(unit)) report(decl, "fluid", [decl.prop, node.value], { word: node.value })
        else if ((unit === "px" || unit === "rem") && !onScale(amount, unit)) report(decl, "off", [decl.prop, node.value], { word: node.value })
      })
    })
  },
)

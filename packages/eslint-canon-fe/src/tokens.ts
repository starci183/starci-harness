/** Universal closed-token discipline, independent of a Grammar scale. */
import { classTextVisitors } from "./lib/class-text.ts"
import { defineRule, type Recommended, type Rules } from "./lib/rule.ts"

/** A bracketed length: a value chosen once, for one screen, findable by nobody. */
const ARBITRARY_LENGTH =
  /\b(?:gap|gap-x|gap-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-x|space-y|size|w|h|min-w|min-h|max-w|max-h)-\[[^\]]+\]/

/** A raw colour, which escapes the semantic palette even when it matches it today. */
const RAW_COLOUR = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|decoration)-\[#[0-9a-fA-F]/

/** An arbitrary value escapes the system, whatever it happens to evaluate to. */
export const noArbitraryValue = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Bracketed lengths and raw colours escape the closed vocabulary." },
    schema: [],
    messages: {
      length:
        "`{{cls}}` is a value chosen once, for one screen. Even where it happens to equal a rung, nobody searching the scale can find it and it does not move when the scale moves. Use a member of the vocabulary, or add one deliberately.",
      colour:
        "`{{cls}}` is a raw colour, outside the semantic palette. A colour named for what it MEANS follows the theme; one named for what it is stays the same in a theme where it is wrong.",
    },
  },
  create(context) {
    return classTextVisitors(context, (node, text) => {
      if (!text) return
      const length = text.match(ARBITRARY_LENGTH)
      if (length) context.report({ node, messageId: "length", data: { cls: length[0] } })
      const colour = text.match(RAW_COLOUR)
      if (colour) context.report({ node, messageId: "colour", data: { cls: colour[0] } })
    })
  },
})

/** Rules of universal token discipline. */
export const rules = { "no-arbitrary-value": noArbitraryValue } satisfies Rules

/** Every token-discipline rule is mandatory. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))

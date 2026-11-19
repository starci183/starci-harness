/**
 * The type-scale law (owner 2026-11-19, `_TYPOGRAPHY.md`): an app never sets a font size, weight, style or case itself.
 *
 * Grammar owns the console scale (title 18, heading 16, label 16, body 14, meta 12; weights 400 and 500) and exposes it through
 * its components (`Text`, `Heading`, `Section`, row and list parts). A raw `text-[15px]`, `text-lg`, `font-bold`, `italic` or
 * `uppercase` utility, or an inline `fontSize` / `fontWeight` / `fontFamily` / `fontStyle` / `lineHeight` / `letterSpacing` /
 * `textTransform` style, is a typography decision that skipped the scale: it does not move with the grammar, drifts from the
 * other screens and breaks the label / content hierarchy.
 *
 * WHAT IT DELIBERATELY LEAVES ALONE: text colour utilities (`text-foreground`, `text-muted`), alignment (`text-center`),
 * wrapping and truncation (`truncate`, `line-clamp-2`, `whitespace-*`), and monospace (`font-mono`, used by code surfaces).
 */

import type { TSESTree } from "@typescript-eslint/utils"
import { isContentFile } from "./comments.ts"
import { defineRule, type Node, type Recommended, type Rules } from "./lib/rule.ts"
import { exemptFreestyle } from "./lib/freestyle.ts"

/** A Tailwind utility that sets a size, weight, style, case, leading or tracking (with any variant prefix). */
const RAW_FONT_UTILITY =
  /(?:^|\s)(?:[\w-]+:)*(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*\d[^\]]*\])|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]]+\])|italic|not-italic|uppercase|lowercase|capitalize|normal-case|leading-[\w[\]./-]+|tracking-[\w[\]./-]+)(?=\s|$)/

/** Style properties that carry typography. */
const FONT_KEYS = new Set(["fontSize", "fontWeight", "fontFamily", "fontStyle", "lineHeight", "letterSpacing", "textTransform"])

/** Calls whose string arguments are class lists. */
const CLASS_CALLS = new Set(["cn", "clsx", "cva", "twMerge", "classNames"])

const isClassAttribute = (node: Node): boolean =>
  node.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && (node.name.name === "className" || node.name.name === "class")

/** No raw font utility or inline font style in app code. */
export const noRawFont = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "Typography comes from the grammar's scale; no raw font utility or inline font style." },
    schema: [],
    messages: {
      utility:
        "A raw type utility (`{{value}}`). Size, weight, style and case are the grammar's: use `Text`, `Heading` or a Section, list or row part, which carry the console scale (title 18, heading 16, label 16, body 14, meta 12; weights 400 and 500).",
      style:
        "An inline `{{key}}`. Typography is the grammar's scale, never a style on a component: use `Text`, `Heading` or a Section, list or row part.",
    },
  },
  create(context) {
    if (isContentFile(context)) return {}
    const source = context.sourceCode || context.getSourceCode()
    const inClassList = (node: Node): boolean =>
      source.getAncestors(node).some(
        (ancestor) =>
          isClassAttribute(ancestor) ||
          (ancestor.type === "CallExpression" && ancestor.callee.type === "Identifier" && CLASS_CALLS.has(ancestor.callee.name)),
      )
    const scan = (node: Node, text: unknown): void => {
      if (typeof text !== "string" || !inClassList(node)) return
      const hit = RAW_FONT_UTILITY.exec(text)
      if (hit) context.report({ node, messageId: "utility", data: { value: hit[0].trim() } })
    }
    return {
      Literal(node: TSESTree.Literal) {
        scan(node, node.value)
      },
      TemplateElement(node: TSESTree.TemplateElement) {
        scan(node, node.value && node.value.cooked)
      },
      Property(node: TSESTree.Property) {
        if (node.computed || node.key.type !== "Identifier" || !FONT_KEYS.has(node.key.name)) return
        const inStyle = source
          .getAncestors(node)
          .some((ancestor) => ancestor.type === "JSXAttribute" && ancestor.name.type === "JSXIdentifier" && ancestor.name.name === "style")
        if (inStyle) context.report({ node, messageId: "style", data: { key: node.key.name } })
      },
    }
  },
}))

/** The rules this law contributes to the plugin. */
export const rules = {
  "no-raw-font": noRawFont,
} satisfies Rules

/** Every rule is an error. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))

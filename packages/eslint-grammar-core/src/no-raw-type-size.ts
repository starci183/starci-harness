import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { classTextVisitors } from "@starci/eslint-canon-fe/lib/class-text.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule, exemptFreestyle } from "./lib/rule-contract.ts"
import type { ReaderContext } from "./lib/types.ts"

/**
 * THE TYPE ROLES (TYPE-ROLES). Type in an app is a role the Grammar draws: `<Text role="label.item">`, or the
 * public class of the role (`starci-type-label-item`) on an element of the app's own. A raw size is a second type scale.
 *
 * WHAT IT READS, in product source (Grammar's own sources are not product source):
 *   - a class string (`className`, a class constant, a `classes` array) that holds a Tailwind text-size utility: `text-xs`, `text-sm`,
 *     `text-base`, `text-lg`, `text-xl`, `text-2xl` and larger, an arbitrary length (`text-[13px]`, `text-[0.8rem]`), with any variant
 *     prefix or line-height suffix (`md:text-sm/6`);
 *   - a `fontSize` key of an object (a JSX `style`, a style constant, a chart option) and a `fontSize` JSX attribute (SVG text);
 *   - a CSS `font-size` declaration written in a string or template literal (CSS-in-JS).
 *
 * WHAT IT LEAVES ALONE. A colour utility (`text-muted`, `text-[var(--accent)]`), the role classes, the theme layer of the app
 * (`modules/brand/`, where the tokens live), Freestyle regions, Fragment regions and non-product source.
 *
 * It is a counting rule (`COUNTING` in index.ts): reported and counted at warn until both apps have migrated, then blocking.
 * The CSS half is the stylesheet canon: `starci/token-only` refuses a `font-size` that is not a token in an app stylesheet, and
 * `starci/no-grammar-private-token` the Grammar's private type tokens.
 */

/** A Tailwind text-size utility: the named steps and an arbitrary length, any variant prefix, an optional `/leading` suffix. */
export const TEXT_SIZE_UTILITY = /(?<![\w-])(?:[\w[\]&>*:.-]+:)?!?text-(?:xs|sm|base|lg|[2-9]?xl|\[\d*\.?\d+(?:px|rem|em|pt|%|vw|vh)\])(?:\/[\w.[\]-]+)?!?(?![\w-])/

/** A CSS `font-size` declaration inside a string. */
const CSS_FONT_SIZE = /(?:^|[\s;{])font-size\s*:/

/** The theme layer of an app: its tokens, never judged here. */
const TOKEN_FILE = /(?:^|\/)modules\/brand\//

const ROLES = "figure, title.page, title.section, label.item, body, label.field, label.group, caption, badge, code (the public site also has display.hero, display.section, display.figure, lead, title.card)"

const isTokenFile = (context: ReaderContext): boolean => TOKEN_FILE.test(context.filename.replaceAll("\\", "/"))

const keyName = (node: TSESTree.Property): string | null => {
  if (node.computed) return null
  if (node.key.type === "Identifier") return node.key.name
  return node.key.type === "Literal" && typeof node.key.value === "string" ? node.key.value : null
}

/** No raw type size in app source: a text role (`<Text role>` or `starci-type-<role>`) carries every size. */
export const noRawTypeSize: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "TYPE-ROLES: type is a Grammar role (`<Text role>`, `starci-type-<role>`); no text-size utility, fontSize or font-size in app source." },
    schema: [],
    messages: {
      utility: "`{{token}}` sets a type size the Grammar owns. Use the role: `<Text role=\"…\">` or the class `starci-type-<role>` (dots as dashes, e.g. `starci-type-label-item`). Roles: " + ROLES + ".",
      fontSize: "`fontSize` sets a type size the Grammar owns. Use `<Text role=\"…\">` or the class `starci-type-<role>`. Roles: " + ROLES + ".",
      css: "A `font-size` declaration sets a type size the Grammar owns. Use the class `starci-type-<role>` on the element. Roles: " + ROLES + ".",
    },
  },
  create(context) {
    if (!isProductSource(context) || isTokenFile(context)) return {}
    const reported = new Set<TSESTree.Node>()
    const report = (node: TSESTree.Node, messageId: "utility" | "fontSize" | "css", token?: string): void => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node: node as never, messageId, data: token === undefined ? {} : { token } })
    }
    const classes = classTextVisitors(context, (node, text) => {
      if (!text) return
      const found = TEXT_SIZE_UTILITY.exec(text)
      if (found !== null) report(node, "utility", found[0])
    })
    const strings = (node: TSESTree.Node, text: string): void => {
      if (CSS_FONT_SIZE.test(text)) report(node, "css")
    }
    return {
      ...classes,
      Property(node: TSESTree.Property) {
        classes.Property?.(node)
        const name = keyName(node)
        if (name === "fontSize" || name === "font-size") report(node, "fontSize")
      },
      JSXAttribute(node: TSESTree.JSXAttribute) {
        classes.JSXAttribute?.(node)
        if (node.name.type !== "JSXIdentifier") return
        if (node.name.name === "fontSize") report(node, "fontSize")
        // A class expression the static reader cannot follow (`cn("flex", big && "text-sm")`) is read as its source text.
        if ((node.name.name === "className" || node.name.name === "class") && node.value !== null) {
          const found = TEXT_SIZE_UTILITY.exec(context.sourceCode.getText(node.value as never))
          if (found !== null) report(node, "utility", found[0])
        }
      },
      Literal(node: TSESTree.Literal) {
        if (typeof node.value === "string") strings(node, node.value)
      },
      TemplateElement(node: TSESTree.TemplateElement) {
        strings(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}))

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-raw-type-size": noRawTypeSize,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#TYPE-ROLES")

/** The rule runs in the counting cohort (index.ts `COUNTING`): a warning until both apps migrate. */
export const recommended: Record<string, "warn"> = { "starci-grammar/no-raw-type-size": "warn" }

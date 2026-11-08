import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { FORM_CONTROLS, attributeOf, elementNameOf, grammarName, nameOf, renderedChildren } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Node } from "./lib/types.ts"
/**
 * The field label law (owner, 2026-11-09, FIELD-LABEL): a control is labelled by its own `label` prop. The Field
 * contract spaces label to control 8, control to help 4, and field to field 24 (the Form or the field stack sets that
 * last one). A `Text` placed beside the control as its label is spaced by whoever placed it, and the rhythm drifts.
 *
 * WHAT IT READS. In one element's rendered children (looked through fragments, `cond && <x/>`, `cond ? <x/> : null` and
 * `.map`), a hand-made label standing as the sibling IMMEDIATELY BEFORE a Grammar form control (Input, Select, Textarea,
 * NumberField, ComboBox, Autocomplete, CheckboxGroup, RadioGroup, ChoiceChips, Switch, DatePicker, DateField,
 * TimeField, SearchField, Slider, CopyField) that carries no `label` prop (a control that has only an `aria-label`
 * included). A hand-made label is a Grammar `Text` or a `Label`, or a plain `<label>` or `<span>` whose children are
 * literal text.
 *
 * WHAT IT LEAVES ALONE. A control with a `label` prop, a control with a JSX spread (the label may arrive through it), a
 * `Text` that is not immediately before a control, and any text beside a control that is not a Grammar form control.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** Plain elements that read as a label when their children are literal text. */
const PLAIN_LABELS = new Set(["label", "span"])

/** True when every rendered child is literal text and there is some. */
const literalText = (element: TSESTree.JSXElement): boolean => {
  const children = renderedChildren(element.children)
  return children.length > 0 && children.every((child) => child.type === "JSXText" || (child.type === "Literal" && typeof child.value === "string"))
}

/** True when a rendered child is a hand-made label. */
const isHandLabel = (context: Parameters<typeof grammarName>[0], node: Node): boolean => {
  if (node.type !== "JSXElement") return false
  const name = nameOf(node.openingElement.name)
  if (name === null) return false
  if (name === "Text" || name === "Label") return grammarName(context, node.openingElement) !== null
  return PLAIN_LABELS.has(name) && node.openingElement.name.type === "JSXIdentifier" && literalText(node)
}

/** A control is labelled by its own `label` prop, never by a Text standing beside it. */
export const fieldLabel: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FIELD-LABEL: a form control is labelled by its own label prop, never by a Text, Label, label or span placed before it." },
    schema: [],
    messages: {
      handMade:
        "This text is a hand-made label for `{{control}}`: use the control's `label` prop instead. The Field contract spaces label to control 8 and control to help 4, and the Form or the field stack sets field to field 24, so a label placed beside the control re-decides that rhythm.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set<Node>()
    const judge = (children: readonly TSESTree.JSXChild[]): void => {
      const flat = renderedChildren(children)
      flat.forEach((node, index) => {
        if (node.type !== "JSXElement" || index === 0) return
        const control = grammarName(context, node.openingElement)
        if (control === null || !FORM_CONTROLS.has(control)) return
        const opening = node.openingElement
        if (attributeOf(opening, "label") !== undefined || opening.attributes.some((entry) => entry.type === "JSXSpreadAttribute")) return
        const previous = flat[index - 1]
        if (previous === undefined || !isHandLabel(context, previous) || reported.has(previous)) return
        reported.add(previous)
        context.report({ node: previous, messageId: "handMade", data: { control: elementNameOf(node) ?? control } })
      })
    }
    return {
      JSXElement(element) { judge(element.children) },
      JSXFragment(fragment) { judge(fragment.children) },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "field-label": fieldLabel,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#FIELD-LABEL")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, elementNameOf, grammarName, hasSpread, nameOf, renderedChildren, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"
/**
 * A card is one object (CARD-OBJECT): a customer, an agent, a provider, a plan, a message, an approval, a dialog or an overlay. A collection (a list, a
 * table, facts, figures, disclosures, a choice), a form and a placeholder stand flat, in a `Section` or on their own, never in a card.
 *
 * WHAT IT READS. In product source, a Grammar `SurfaceCard` of the body kind (no `kind`, or `kind="body"`) whose ONLY content is one of:
 *   - a table: `DataTable`
 *   - a section: `Section` of any kind (a list, a region or a figures ribbon)
 *   - rows: `DescriptionList`, `DisclosureList`, `Accordion`
 *   - a form or a lone field: `Form`, `Fieldset`, `Input`, `Textarea`, `Select`, `ComboBox`, `SearchField`, `NumberField`, `RadioGroup`, `CheckboxGroup`
 *   - a placeholder: `EmptyNotice`
 *   - markdown: `Markdown`, `MarkdownArticle`
 *   - a chart: `BarChart`, `LineChart`, `Sparkline`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`
 * The body is read through fragments, `cond && <x/>`, `cond ? <x/> : <y/>` and `.map`, and through the layout wrappers `Stack`, `Cluster`, `Inline`, `Grid`
 * and a plain `div` that hold that one content.
 *
 * WHAT IT LEAVES ALONE. A card with `measure="formCompact"` (the sign-in form with no page around it), a `kind="tile"` card, a body card with more than one
 * content (an object's name or facts beside a control is an object), a card with a JSX spread, a non-Grammar `SurfaceCard`, and non-product source.
 *
 * NO AUTOFIX. The move changes the structure (the card's `label` becomes the `Section` title), which the author reads.
 */

/** The layout wrappers read through, so a card holding one `Stack` of one table is a card holding a table. */
const WRAPPERS: ReadonlySet<string> = new Set(["Stack", "Cluster", "Inline", "Grid"])

type Replacement = { readonly content: string; readonly fix: string }

const TABLE: Replacement = {
  content: "a `DataTable`",
  fix: "Put the table flat under its Section (`<Section title ...><DataTable .../></Section>`).",
}
const FORM: Replacement = {
  content: "a form",
  fix: "Put the form flat under a Section (`<Section title ...><Form .../></Section>`); a sign-in form with no page around it keeps `measure=\"formCompact\"`.",
}
const FIELD: Replacement = {
  content: "one field",
  fix: "Put the field in a Section (`<Section title ...><Form><Input .../></Form></Section>`); a sign-in form with no page around it keeps `measure=\"formCompact\"`.",
}
const CHART: Replacement = {
  content: "a chart",
  fix: "Put the chart flat under a Section (`<Section title ...><BarChart .../></Section>`).",
}
const DISCLOSURES: Replacement = {
  content: "disclosures",
  fix: "Put the disclosures flat under a Section (`<Section title ...><DisclosureList items={...} /></Section>`).",
}

/** What each lone content is, in the words the message uses, and where it stands instead. */
const CONTENT: ReadonlyMap<string, Replacement> = new Map<string, Replacement>([
  ["DataTable", TABLE],
  ["DescriptionList", { content: "a `DescriptionList`", fix: "Put the facts flat under a Section (`<Section title ...><DescriptionList isDivided items={...} /></Section>`); the facts of ONE object stay in that object's card beside its name or a control." }],
  ["DisclosureList", DISCLOSURES],
  ["Accordion", DISCLOSURES],
  ["Form", FORM],
  ["Fieldset", FORM],
  ["Input", FIELD],
  ["Textarea", FIELD],
  ["Select", FIELD],
  ["ComboBox", FIELD],
  ["SearchField", FIELD],
  ["NumberField", FIELD],
  ["RadioGroup", FIELD],
  ["CheckboxGroup", FIELD],
  ["EmptyNotice", { content: "an `EmptyNotice`", fix: "An empty state stands on its own: drop the card and keep the `EmptyNotice`." }],
  ["Markdown", { content: "`Markdown`", fix: "Put the text flat under a Section (`<Section title ...><Markdown .../></Section>`)." }],
  ["MarkdownArticle", { content: "`MarkdownArticle`", fix: "Put the text flat under a Section (`<Section title ...><MarkdownArticle .../></Section>`)." }],
  ["BarChart", CHART],
  ["LineChart", CHART],
  ["Sparkline", CHART],
  ["ProportionBar", CHART],
  ["BubbleMap", CHART],
  ["FlowGraph", CHART],
  ["MermaidDiagram", CHART],
])

/** What a `Section` of this kind is and where it stands instead. */
const sectionContent = (kind: string | null): Replacement => {
  if (kind === "list") return { content: "a `Section kind=\"list\"`", fix: "A list is flat: drop the card and keep `<Section kind=\"list\" title ... items={...} />`, which titles itself." }
  if (kind === "figures") return { content: "a `Section kind=\"figures\"`", fix: "A ribbon is flat: drop the card and keep `<Section kind=\"figures\" items={...} />`." }
  return { content: "a `Section`", fix: "A section stands flat on the page: drop the card and keep the `Section`; its title is the card's `label`." }
}

/** True when the card is a body card: no `kind`, or `kind="body"`. A `kind` that is not a literal is left to the compiler. */
const isBodyCard = (opening: TSESTree.JSXOpeningElement): boolean => {
  const attribute = attributeOf(opening, "kind")
  return attribute === undefined || stringProp(opening, "kind") === "body"
}

/** The one content a list of rendered children holds, looked through the layout wrappers, or null when it holds none or more than one. */
const loneContent = (context: Context, children: readonly Node[]): Replacement | null => {
  if (children.length !== 1) return null
  const child = children[0]
  if (child === undefined || child.type !== "JSXElement") return null
  const opening = child.openingElement
  if (elementNameOf(child) === null || hasSpread(opening)) return null
  const grammar = grammarName(context, opening)
  if (grammar === "Section") return sectionContent(stringProp(opening, "kind"))
  if (grammar !== null && WRAPPERS.has(grammar)) return loneContent(context, renderedChildren(child.children))
  if (opening.name.type === "JSXIdentifier" && opening.name.name === "div") return loneContent(context, renderedChildren(child.children))
  if (grammar === null) return null
  return CONTENT.get(nameOf(opening.name) ?? "") ?? null
}

/** A card is one object: a collection, a form or a placeholder is never its only content. */
export const cardIsObject: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "CARD-OBJECT: a body SurfaceCard is one object; a card whose only content is a table, a list, facts, disclosures, a form, a field, an empty notice, markdown or a chart is refused." },
    schema: [],
    messages: {
      collection: "SurfaceCard holds only {{content}}: a card is one object (a customer, an agent, a plan, a message). {{fix}}",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element) {
        const opening = element.openingElement
        if (grammarName(context, opening) !== "SurfaceCard" || hasSpread(opening) || !isBodyCard(opening)) return
        if (stringProp(opening, "measure") === "formCompact") return
        const found = loneContent(context, renderedChildren(element.children))
        if (found === null) return
        context.report({ node: opening, messageId: "collection", data: { content: found.content, fix: found.fix } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "card-is-object": cardIsObject,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#CARD-OBJECT")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { FORM_CONTROLS, attributeOf, elementNameOf, grammarName, isFragmentElement, renderedChildren, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"
/**
 * The proximity law (owner, 2026-11-09, GAP-PROXIMITY): inside any container, its children stand at least ONE step
 * closer than the container stands to its siblings. The gap roles rise strictly: identity 4 < inline 8 < row 12 <
 * section 24 < region 32. A layout element whose role is the same as, or wider than, its parent's makes the child's
 * parts read as far apart as the parent's siblings, so the grouping disappears.
 *
 * WHAT IT READS. A Grammar layout element (imported from `@starci/grammar`) nested DIRECTLY in another: through plain
 * fragments, `{cond ? <x/> : null}`, `{cond && <x/>}` and `{items.map(() => <x/>)}`, never through another element.
 * Roles: `Stack` and `Cluster` are their `gap` literal (a non-literal gap has no role and is skipped); `PaneSection` is
 * its `gap`, default `inline`; `Section` is `row` (its head, filter and body stand 12 apart); `Grid` by kind (`cards`,
 * `week`, `week-summary` inline; `sections`, `pair`, `featured`, `form` section; `main-rail` region); `Form` and
 * `Fieldset` are section (their fields stand 24 apart).
 *
 * WHAT IT LEAVES ALONE.
 * - A `SurfaceCard`, `Drawer`, `Dialog`, `AlertDialog` or `Popover` is a reset: a surface is its own edge, so what
 *   stands inside it is not compared with anything outside it.
 * - A field stack: a `Stack gap="section"` whose children are all form controls (Input, Select, Textarea, NumberField,
 *   ComboBox, Autocomplete, CheckboxGroup, RadioGroup, ChoiceChips, Switch, DatePicker, DateField, TimeField,
 *   SearchField, Slider, CopyField, Fieldset, Field), directly inside a `Form` or a `Fieldset` (a Drawer body is
 *   a reset already). Fields stand 24 apart; that is the Field rule's own rhythm.
 * - `Grid kind="main-rail"`: nothing in it is compared with it, and it is not compared with a region parent. It fixes
 *   its own role and region is the top of the scale, so there is nothing to step down to.
 * - The props of a Grid (`main`, `rail`, `featured`...) are not children.
 *
 * Region is the top of the scale: any other region child in a region parent is still reported (the app steps it down).
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The gap roles, narrowest first. */
const ROLES = ["identity", "inline", "row", "section", "region"] as const
type RoleName = (typeof ROLES)[number]
const PIXELS: Readonly<Record<RoleName, number>> = { identity: 4, inline: 8, row: 12, section: 24, region: 32 }

/** The layout elements whose gap is a role. */
const LAYOUTS = new Set(["Stack", "Cluster", "PaneSection", "Section", "Grid", "Form", "Fieldset"])
/** The elements that are a surface of their own: nothing inside is compared with anything outside. */
const RESETS = new Set(["SurfaceCard", "Drawer", "Dialog", "AlertDialog", "Popover"])
/** What a field stack holds. */
const FIELD_CHILDREN: ReadonlySet<string> = new Set([...FORM_CONTROLS, "Fieldset", "Field"])

const GRID_ROLES: Readonly<Record<string, RoleName>> = {
  cards: "inline", week: "inline", "week-summary": "inline", sections: "section", pair: "section", featured: "section", form: "section", "main-rail": "region",
}

/** A layout element's gap role, and whether the app can step it (a `gap` prop) or the Grammar fixes it. */
interface Role {
  readonly name: string
  readonly role: RoleName
  readonly steppable: boolean
}

const isRole = (value: string | null): value is RoleName => value !== null && (ROLES as readonly string[]).includes(value)

/** The role of a layout element, or null when it is not a layout element or states no literal role. */
const roleOf = (context: Context, element: TSESTree.JSXElement): Role | null => {
  const opening = element.openingElement
  const name = grammarName(context, opening)
  if (name === null || !LAYOUTS.has(name)) return null
  if (name === "Stack" || name === "Cluster") {
    const gap = stringProp(opening, "gap")
    return isRole(gap) ? { name, role: gap, steppable: true } : null
  }
  if (name === "PaneSection") {
    if (attributeOf(opening, "gap") === undefined) return { name, role: "inline", steppable: true }
    const gap = stringProp(opening, "gap")
    return isRole(gap) ? { name, role: gap, steppable: true } : null
  }
  if (name === "Section") return { name, role: "row", steppable: false }
  if (name === "Grid") {
    const kind = stringProp(opening, "kind")
    const role = kind === null ? undefined : GRID_ROLES[kind]
    return role === undefined || kind === null ? null : { name: `${name} kind="${kind}"`, role, steppable: false }
  }
  return { name, role: "section", steppable: false }
}

/** True when the `.map` call-back is a function passed to a `.map` call. */
const isMapCallback = (fn: Node): boolean => {
  const call = fn.parent
  if (call?.type !== "CallExpression" || call.arguments[0] !== fn) return false
  const callee = call.callee
  return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "map"
}

/** The element a node is a rendered child of, looking through fragments, conditions, `&&` and `.map`; null when it is not a child (an attribute, a call argument). */
const parentElement = (node: Node): TSESTree.JSXElement | null => {
  let child: Node = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    switch (parent.type) {
      case "JSXElement":
        if (isFragmentElement(parent)) continue
        return parent
      case "JSXFragment":
      case "JSXExpressionContainer":
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "ArrayExpression":
        continue
      case "ConditionalExpression":
        if (parent.test === child) return null
        continue
      case "LogicalExpression":
        if (parent.right !== child) return null
        continue
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        if (!isMapCallback(parent)) return null
        continue
      case "ReturnStatement":
        continue
      case "BlockStatement":
        if (parent.parent?.type === "ArrowFunctionExpression" || parent.parent?.type === "FunctionExpression") continue
        return null
      case "CallExpression":
        if (parent.arguments[0] !== child || !isMapCallback(child)) return null
        continue
      default:
        return null
    }
  }
  return null
}

/** True when every child a `Stack gap="section"` renders is a form control (and it renders at least one). */
const holdsOnlyFields = (context: Context, stack: TSESTree.JSXElement): boolean => {
  const children = renderedChildren(stack.children)
  return children.length > 0 && children.every((child) => {
    if (child.type !== "JSXElement") return false
    const name = elementNameOf(child)
    return name !== null && FIELD_CHILDREN.has(name) && grammarName(context, child.openingElement) !== null
  })
}

/** The right role for the child: one step below the parent's. */
const below = (parent: RoleName): RoleName | null => ROLES[ROLES.indexOf(parent) - 1] ?? null

/** A layout element nests at least one step tighter than its layout parent. */
export const gapProximity: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "GAP-PROXIMITY: a Grammar layout element stands at least one gap step closer than the layout element that contains it." },
    schema: [],
    messages: {
      wide:
        "`{{child}}` ({{childRole}}, {{childPixels}}px) stands directly in `{{parent}}` ({{parentRole}}, {{parentPixels}}px): the children of a container stand at least one step closer than the container stands to its siblings, or the grouping disappears (identity 4 < inline 8 < row 12 < section 24 < region 32). {{advice}}",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element) {
        const child = roleOf(context, element)
        if (child === null) return
        const container = parentElement(element)
        if (container === null) return
        const containerName = grammarName(context, container.openingElement)
        if (containerName === null || RESETS.has(containerName)) return
        const parent = roleOf(context, container)
        if (parent === null) return
        if (ROLES.indexOf(child.role) < ROLES.indexOf(parent.role)) return
        // A main-rail grid fixes its own role and region is the top of the scale: nothing is compared with it, in either direction.
        if (parent.name === 'Grid kind="main-rail"' || child.name === 'Grid kind="main-rail"') return
        // A field stack (fields 24 apart) is the Field rule's own rhythm inside a Form or a Fieldset.
        if (child.name === "Stack" && child.role === "section" && (containerName === "Form" || containerName === "Fieldset") && holdsOnlyFields(context, element)) return
        const target = below(parent.role)
        const advice = target === null
          ? `\`${parent.name}\` is the narrowest role: split the parent instead of nesting inside it.`
          : child.steppable
            ? `Give it gap="${target}" (one step below the parent), or step the parent up.`
            : `\`${child.name}\` fixes its own gap role (${child.role}), so step the parent up (a ${ROLES[ROLES.indexOf(child.role) + 1] ?? "wider"} gap) or do not nest ${child.name.split(" ")[0] ?? child.name} there.`
        context.report({
          node: element.openingElement,
          messageId: "wide",
          data: {
            child: child.name, childRole: child.role, childPixels: PIXELS[child.role],
            parent: parent.name, parentRole: parent.role, parentPixels: PIXELS[parent.role],
            advice,
          },
        })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "gap-proximity": gapProximity,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#GAP-PROXIMITY")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

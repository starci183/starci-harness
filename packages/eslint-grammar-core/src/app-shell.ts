import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/** FE-APP-SHELL-1..5: static app-frame and visible navbar composition from the UI canon. */
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName, isBarControl, propOf, resolveLocal, textProp } from "./lib/app-shell.ts"
import { isAppBar, isAppShell, isNavigationDrawer } from "./lib/app-shell-scope.ts"
import { visitVisible } from "./lib/app-shell-visible.ts"
import type { Visit } from "./lib/app-shell-visible.ts"
import type { ReaderContext, Resolved } from "./lib/types.ts"

const CANON = "knowledge/ui/composition/app-shell.yaml"

const meta = (code: string, description: string, messages: Record<string, string>): Rule.RuleMetaData => ({
  type: "problem",
  docs: { description: `${code}: ${description}`, url: CANON },
  schema: [],
  messages,
})

/** Resolve constants and require every possible conditional value to prove the slot contract. */
const everyValue = (context: ReaderContext, expression: Resolved | null | undefined, proves: (value: Resolved) => boolean, seen: Set<Resolved> = new Set()): boolean => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return false
  if (node.type !== "ConditionalExpression") return proves(node)
  const visited = new Set(seen).add(node)
  return [node.consequent, node.alternate].every((branch) => everyValue(context, branch, proves, visited))
}

const visitBar = (context: ReaderContext, node: TSESTree.JSXOpeningElement, visit: Visit): void => {
  const name = grammarName(context, node)
  if (name === "WorkspaceShell" && isAppShell(context, node)) {
    for (const slot of ["header", "compactHeader"]) visitVisible(context, propOf(context, node, slot).value, visit)
  } else if (isAppBar(context, node)) {
    visitVisible(context, node.parent, visit)
  } else if (isNavigationDrawer(context, node)) {
    visitVisible(context, propOf(context, node, "trigger").value, visit)
  }
}

/** Whether every value a prop can take is one of the given string literals. */
const everyLiteral = (context: ReaderContext, expression: Resolved | null | undefined, allowed: ReadonlySet<string>): boolean =>
  everyValue(context, expression, (value) => value.type === "Literal" && typeof value.value === "string" && allowed.has(value.value))

const TOGGLE: ReadonlySet<string> = new Set(["toggle"])
const SWITCH_KINDS: ReadonlySet<string> = new Set(["toggle", "compact"])

/**
 * A bar control's height comes from its published API. Buttons and the AvatarButton publish the shared 40px height as `md` (their default). A `Switch` publishes it
 * as `kind="toggle"`: a stated `kind` wins and the Grammar ignores `size` beside it, so the kind alone decides, and a Switch with no `kind` is
 * the toggle unless `size` says `md` or `lg`. The other bar controls publish `control`.
 */
const barControlHeight = (context: ReaderContext, control: TSESTree.JSXOpeningElement, name: string | null): "control" | "compact" | "other" => {
  if (name === "Switch") {
    const kind = propOf(context, control, "kind")
    if (kind.known && kind.value !== null && everyLiteral(context, kind.value, SWITCH_KINDS)) return everyLiteral(context, kind.value, TOGGLE) ? "control" : "compact"
    if (!kind.known || kind.value !== null) return "other"
  }
  const size = propOf(context, control, "size")
  if (!size.known) return "other"
  if ((name === "Button" || name === "IconButton" || name === "Switch" || name === "AvatarButton") && size.value === null) return "control"
  // An AvatarButton's md is the 40px round mark, the control height (round marks are sm 24 or md 40).
  if ((name === "Button" || name === "IconButton" || name === "AvatarButton") && everyLiteral(context, size.value, new Set(["md"]))) return "control"
  return textProp(context, control, "size") === "control" ? "control" : "other"
}

/** Every visible control in a navbar band uses the shared control height through its published size API. */
export const navbarControlSize: Rule.RuleModule = defineRule({
  meta: meta("FE_NAVBAR_CONTROL_SIZE", "FE-APP-SHELL-2 requires the shared control height on bar controls.", {
    control: "FE_NAVBAR_CONTROL_SIZE: {{name}} in the navbar band needs Grammar's shared control height: omit size or use md for Button/IconButton/AvatarButton, kind=\"toggle\" (or no kind and no size) for Switch, and size=\"control\" for the other bar controls.",
    compact: "FE_NAVBAR_CONTROL_SIZE: a Switch kind=\"compact\" (32x18, no thumb glyph) in the navbar band breaks the bar's one 40px height; the bar's switch is kind=\"toggle\" (72x40, the theme switch). Compact is for a setting in a row, a list, a table cell or a toolbar.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set<TSESTree.JSXOpeningElement>()
    return { JSXOpeningElement(node) {
      visitBar(context, node, (control, name) => {
        if (!isBarControl(context, control, name) || reported.has(control)) return
        const height = barControlHeight(context, control, name)
        if (height === "control") return
        reported.add(control)
        context.report({ node: control, messageId: height === "compact" ? "compact" : "control", data: { name } })
      })
    } }
  },
})

/** Every app-shell enforcer is gathered into the ordinary FE lint and gate path. */
export const rules: Record<string, Rule.RuleModule> = {
  "navbar-control-size": navbarControlSize,
}

defineFamilyRules(rules, "knowledge/ui/composition/app-shell.yaml")

/** Every rule is mandatory. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
/** FE-APP-SHELL-1..5: static app-frame and visible navbar composition from the UI canon. */
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { grammarName, isBarControl, propOf, resolveLocal, semanticText, textProp } from "./lib/app-shell.ts"
import { appBarOpenings, isAppBar, isAppShell, isNavigationDrawer, ownsAppFrame } from "./lib/app-shell-scope.ts"
import { visitVisible } from "./lib/app-shell-visible.ts"
import type { Visit } from "./lib/app-shell-visible.ts"
import { clusterAlternatives } from "./lib/app-shell-cluster.ts"
import { isCreateAction, menuHasCreate } from "./lib/app-shell-create.ts"
import { provesImportedBar, provesNavigationOpener } from "./lib/app-shell-owner.ts"
import { variableOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { walk } from "@starci/eslint-canon-fe/lib/ast.mjs"
import type { Node, ReaderContext, Resolved } from "./lib/types.ts"

const CANON = "knowledge/ui/composition/app-shell.yaml"
const BOTTOM_TABS = /^(?:BottomNavigation|BottomTabBar|MobileBottomNav|MobileTabBar|BottomNav)$/
const EXPECTED_CLUSTER = ["language:IconButton", "theme:Switch", "notifications:IconButton", "account:AvatarButton"]
/** The cluster of a shell with no notification source (a platform-admin shell with no workspace): notifications are required only where a read feeds them, so a shell without one may omit them. */
const NO_SOURCE_CLUSTER = EXPECTED_CLUSTER.filter((kind) => !kind.startsWith("notifications:"))
/** A notification source: a call of a hook that reads notifications (`useNotifications`, `useWorkspaceNotificationFeed`). */
const NOTIFICATION_READ = /use\w*Notification\w*\s*\(/

const meta = (code: string, description: string, messages: Record<string, string>): Rule.RuleMetaData => ({
  type: "problem",
  docs: { description: `${code}: ${description}`, url: CANON },
  schema: [],
  messages,
})

/** Whether a slot is present; unknown spreads do not prove either presence or absence. */
const slotPresence = (context: ReaderContext, opening: TSESTree.JSXOpeningElement, name: string): boolean | null => {
  const prop = propOf(context, opening, name)
  if (!prop.known) return null
  const value = resolveLocal(context, prop.value)
  if (value === null || value === undefined || value.type === "Literal" && (value.value == null || value.value === false)) return false
  return !(value.type === "Identifier" && value.name === "undefined" && !variableOf(context, value)?.defs.length)
}

/** Resolve constants and require every possible conditional value to prove the slot contract. */
const everyValue = (context: ReaderContext, expression: Resolved | null | undefined, proves: (value: Resolved) => boolean, seen: Set<Resolved> = new Set()): boolean => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return false
  if (node.type !== "ConditionalExpression") return proves(node)
  const visited = new Set(seen).add(node)
  return [node.consequent, node.alternate].every((branch) => everyValue(context, branch, proves, visited))
}

const hasMobileNavigation = (context: ReaderContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const drawerProp = propOf(context, opening, "navigationDrawer")
  const drawer = drawerProp.known && everyValue(context, drawerProp.value, (value) => value.type === "ObjectExpression")
  const opener = drawer || provesNavigationOpener(context, propOf(context, opening, "compactHeader").value)
  const visibility = propOf(context, opening, "navigationVisibility")
  const defaultsWide = opener && visibility.known && slotPresence(context, opening, "navigationVisibility") === false
  if (!defaultsWide && (!visibility.known || !everyValue(context, visibility.value, (value) => value.type === "Literal" && value.value === "wide"))) return false
  return opener
}

/** App-owned tab names count only in a frame owner or a shell's rendered slots. */
const visibleFromShell = (context: ReaderContext, target: TSESTree.JSXOpeningElement): boolean => {
  let visible = false
  walk(context.sourceCode, context.sourceCode.ast, (node) => {
    if (node.type !== "JSXOpeningElement" || !isAppShell(context, node)) return
    const inspect: Visit = (opening) => { if (opening === target) visible = true }
    for (const slot of ["header", "compactHeader", "navigation", "primary", "floatingLayer", "compactNavigation"]) visitVisible(context, propOf(context, node, slot).value, inspect)
    for (const child of node.parent.children) visitVisible(context, child, inspect)
  })
  return visible
}

/** The app frame is the fixed-viewport Grammar shell; hand-written frame landmarks are rejected. */
export const appShellFrame: Rule.RuleModule = defineRule({
  meta: meta("FE_APP_SHELL_FRAME", "FE-APP-SHELL-1 uses WorkspaceShell viewport=fixed.", {
    frame: "FE_APP_SHELL_FRAME: compose the app frame with WorkspaceShell viewport=\"fixed\"; navigation must resolve to navigationVisibility=\"wide\" and have navigationDrawer or a compactHeader with a left Drawer containing Sidebar presentation=\"drawer\". Grammar owns its header, navigation and independent scroll regions.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    return { JSXOpeningElement(node) {
      const shell = isAppShell(context, node)
      const wrongViewport = shell && textProp(context, node, "viewport") !== "fixed"
      const missingVisibility = shell && slotPresence(context, node, "navigation") !== false && !hasMobileNavigation(context, node)
      const handFrame = ownsAppFrame(context, node) && (node.name.type === "JSXIdentifier" && ["header", "nav", "main"].includes(node.name.name) || isAppBar(context, node) && !appBarOpenings(context).has(node))
      if (wrongViewport || missingVisibility || handFrame) {
        context.report({ node, messageId: "frame" })
      }
    } }
  },
})

/**
 * FE-APP-SHELL-4: the one bottom bar is the Grammar `BottomNav`, and only as the `compactNavigation` of a `WorkspaceShell` (the phone slot). A hand-rolled bottom
 * tab bar, any other `compactNavigation` and a `BottomNav` anywhere else are refused.
 */
export const noShellBottomTabs: Rule.RuleModule = defineRule({
  meta: meta("FE_APP_SHELL_BOTTOM_TABS", "FE-APP-SHELL-4 keeps mobile navigation in the sidebar drawer; the Grammar BottomNav stands only as the compactNavigation of a WorkspaceShell.", {
    bottom: "FE_APP_SHELL_BOTTOM_TABS: the app shell uses a mobile subnav opener and Sidebar drawer. Remove the hand-made bottom tab bar; a BottomNav stands only as the compactNavigation of a WorkspaceShell, and compactNavigation holds nothing else.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    /** The Grammar `BottomNav` openings seen, and those a shell holds as its `compactNavigation`. */
    const bottomNavs: TSESTree.JSXOpeningElement[] = []
    const inShellSlot = new Set<string>()
    const keyOf = (opening: TSESTree.JSXOpeningElement): string => `${opening.range[0]}:${opening.range[1]}`
    const isBottomNav = (value: Resolved | null | undefined): value is TSESTree.JSXElement => value?.type === "JSXElement" && grammarName(context, value.openingElement) === "BottomNav"
    return {
      JSXOpeningElement(node) {
        const name = grammarName(context, node)
        if (name === "BottomNav") bottomNavs.push(node)
        const appTab = name === null && node.name.type === "JSXIdentifier" && BOTTOM_TABS.test(node.name.name) && (ownsAppFrame(context, node) || visibleFromShell(context, node))
        const compact = name === "WorkspaceShell" ? propOf(context, node, "compactNavigation") : null
        const value = compact ? resolveLocal(context, compact.value) : null
        const absent = value?.type === "Identifier" && value.name === "undefined" && !variableOf(context, value)?.defs.length
        if (compact && compact.known && isBottomNav(value)) {
          inShellSlot.add(keyOf(value.openingElement))
          return
        }
        if (name !== "BottomNav" && BOTTOM_TABS.test(name ?? "") || appTab || compact && !absent && (!compact.known || compact.value !== null || compact.present)) context.report({ node, messageId: "bottom" })
      },
      "Program:exit"() {
        for (const opening of bottomNavs) if (!inShellSlot.has(keyOf(opening))) context.report({ node: opening, messageId: "bottom" })
      },
    }
  },
})

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

const delegatesImportedBar = (context: ReaderContext, expression: Node | null): boolean => {
  let imported = false
  let controls = false
  let unknown = false
  visitVisible(context, expression, (opening, name) => {
    if (isBarControl(context, opening, name)) controls = true
    if (name !== null) return
    const proof = provesImportedBar(context, opening)
    if (proof === true) imported = true
    if (proof === false) unknown = true
  })
  return imported && !controls && !unknown
}

/** Whether every value a prop can take is one of the given string literals. */
const everyLiteral = (context: ReaderContext, expression: Resolved | null | undefined, allowed: ReadonlySet<string>): boolean =>
  everyValue(context, expression, (value) => value.type === "Literal" && typeof value.value === "string" && allowed.has(value.value))

const TOGGLE: ReadonlySet<string> = new Set(["toggle"])
const SWITCH_KINDS: ReadonlySet<string> = new Set(["toggle", "compact"])

/**
 * A bar control's height comes from its published API. Buttons publish the shared 40px height as `md` (their default). A `Switch` publishes it
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
  if ((name === "Button" || name === "IconButton" || name === "Switch") && size.value === null) return "control"
  if ((name === "Button" || name === "IconButton") && everyLiteral(context, size.value, new Set(["md"]))) return "control"
  return textProp(context, control, "size") === "control" ? "control" : "other"
}

/** Every visible control in a navbar band uses the shared control height through its published size API. */
export const navbarControlSize: Rule.RuleModule = defineRule({
  meta: meta("FE_NAVBAR_CONTROL_SIZE", "FE-APP-SHELL-2 requires the shared control height on bar controls.", {
    control: "FE_NAVBAR_CONTROL_SIZE: {{name}} in the navbar band needs Grammar's shared control height: omit size or use md for Button/IconButton, kind=\"toggle\" (or no kind and no size) for Switch, and size=\"control\" for the other bar controls.",
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

/** The right cluster is checked at the bar's actions composition, in visual source order. */
export const navbarCluster: Rule.RuleModule = defineRule({
  meta: meta("FE_NAVBAR_CLUSTER", "FE-APP-SHELL-3 fixes navbar action kinds and order.", {
    cluster: "FE_NAVBAR_CLUSTER: navbar actions must be a tertiary Language IconButton in DropdownMenu, theme Switch, notification IconButton in Popover, account AvatarButton in DropdownMenu, in that order. Mobile retains notifications then account and moves language/theme into the drawer.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    return { JSXOpeningElement(node) {
      const name = grammarName(context, node)
      if (!isAppShell(context, node) && !isAppBar(context, node)) return
      const shellHeader = name === "WorkspaceShell"
      const actions = propOf(context, node, shellHeader ? "header" : "actions")
      const { alternatives, ownsBar } = clusterAlternatives(context, actions.value, shellHeader)
      if (ownsBar) return
      if (shellHeader && delegatesImportedBar(context, actions.value)) return
      const shapes = [EXPECTED_CLUSTER, ...(NOTIFICATION_READ.test(context.sourceCode.text) ? [] : [NO_SOURCE_CLUSTER])]
      const sequences = alternatives.map((sequence) => sequence.join("|"))
      const desktop = shapes.map((shape) => shape.join("|"))
      const mobile = shapes.map((shape) => shape.slice(2).join("|"))
      if (!sequences.some((sequence) => desktop.includes(sequence)) || sequences.some((sequence) => !desktop.includes(sequence) && !mobile.includes(sequence))) context.report({ node, messageId: "cluster" })
    } }
  },
})

/** Creation belongs to its page, never to the global app bar. */
export const noNavbarCreate: Rule.RuleModule = defineRule({
  meta: meta("FE_NAVBAR_CREATE", "FE-APP-SHELL-5 keeps create actions on pages.", {
    create: "FE_NAVBAR_CREATE: move this create action from the navbar to its page.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set<TSESTree.JSXOpeningElement>()
    const report = (node: TSESTree.JSXOpeningElement): void => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: "create" })
    }
    const inspect: Visit = (control, name) => {
      if (name === "DropdownMenu" || name === "Popover") {
        if (["entries", "items", "sections"].some((slot) => menuHasCreate(context, propOf(context, control, slot).value))) report(control)
        visitVisible(context, propOf(context, control, "content").value, inspect)
        for (const child of control.parent.children) visitVisible(context, child, inspect)
      }
      if (!isBarControl(context, control, name) || reported.has(control)) return
      const text = `${semanticText(context, control)} ${control.parent.children.map((child) => context.sourceCode.getText(child)).join(" ")}`
      if (isCreateAction(text)) report(control)
    }
    return { JSXOpeningElement(node) {
      visitBar(context, node, inspect)
    } }
  },
})

/** Every app-shell enforcer is gathered into the ordinary FE lint and gate path. */
export const rules: Record<string, Rule.RuleModule> = {
  "app-shell-frame": appShellFrame,
  "no-shell-bottom-tabs": noShellBottomTabs,
  "navbar-control-size": navbarControlSize,
  "navbar-cluster": navbarCluster,
  "no-navbar-create": noNavbarCreate,
}

defineFamilyRules(rules, "knowledge/ui/composition/app-shell.yaml")

/** Every rule is mandatory. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

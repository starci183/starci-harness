/** FE-APP-SHELL-1..5: static app-frame and visible navbar composition from the UI canon. */
import { isProductSource } from "./lib/scope.mjs"
import { grammarName, isBarControl, propOf, resolveLocal, semanticText, textProp } from "./lib/app-shell.mjs"
import { appBarOpenings, isAppBar, isAppShell, isNavigationDrawer, ownsAppFrame } from "./lib/app-shell-scope.mjs"
import { visitVisible } from "./lib/app-shell-visible.mjs"
import { clusterAlternatives } from "./lib/app-shell-cluster.mjs"
import { isCreateAction, menuHasCreate } from "./lib/app-shell-create.mjs"
import { provesImportedBar } from "./lib/app-shell-owner.mjs"
import { variableOf } from "./lib/bindings.mjs"

const CANON = "knowledge/ui/composition/app-shell.yaml"
const BOTTOM_TABS = /^(?:BottomNav|BottomNavigation|BottomTabBar|MobileBottomNav|MobileTabBar)$/
const EXPECTED_CLUSTER = ["language:IconButton", "theme:Switch", "notifications:IconButton", "account:AvatarButton"]

const meta = (code, description, messages) => ({
  type: "problem",
  docs: { description: `${code}: ${description}`, url: CANON },
  schema: [],
  messages,
})

/** The app frame is the fixed-viewport Grammar shell; hand-written frame landmarks are rejected. */
export const appShellFrame = {
  meta: meta("FE_APP_SHELL_FRAME", "FE-APP-SHELL-1 uses WorkspaceShell viewport=fixed.", {
    frame: "FE_APP_SHELL_FRAME: compose the app frame with WorkspaceShell viewport=\"fixed\"; Grammar owns its header, navigation and independent scroll regions.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    return { JSXOpeningElement(node) {
      const wrongViewport = isAppShell(context, node) && textProp(context, node, "viewport") !== "fixed"
      const handFrame = ownsAppFrame(context, node) && (node.name.type === "JSXIdentifier" && ["header", "nav", "main"].includes(node.name.name) || isAppBar(context, node) && !appBarOpenings(context).has(node))
      if (wrongViewport || handFrame) {
        context.report({ node, messageId: "frame" })
      }
    } }
  },
}

/** Bottom navigation is not an alternative compact app-shell frame. */
export const noShellBottomTabs = {
  meta: meta("FE_APP_SHELL_BOTTOM_TABS", "FE-APP-SHELL-4 keeps mobile navigation in the sidebar drawer.", {
    bottom: "FE_APP_SHELL_BOTTOM_TABS: the app shell uses a mobile subnav opener and Sidebar drawer. Remove bottom tab navigation and WorkspaceShell compactNavigation.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    return { JSXOpeningElement(node) {
      const name = grammarName(context, node)
      const compact = name === "WorkspaceShell" && propOf(context, node, "compactNavigation")
      const value = compact && resolveLocal(context, compact.value)
      const absent = value?.type === "Identifier" && value.name === "undefined" && !variableOf(context, value)?.defs.length
      if (BOTTOM_TABS.test(name ?? "") || compact && !absent && (!compact.known || compact.value !== null || compact.present)) context.report({ node, messageId: "bottom" })
    } }
  },
}

const visitBar = (context, node, visit) => {
  const name = grammarName(context, node)
  if (name === "WorkspaceShell" && isAppShell(context, node)) {
    for (const slot of ["header", "compactHeader"]) visitVisible(context, propOf(context, node, slot).value, visit)
  } else if (isAppBar(context, node)) {
    visitVisible(context, node.parent, visit)
  } else if (isNavigationDrawer(context, node)) {
    visitVisible(context, propOf(context, node, "trigger").value, visit)
  }
}

const delegatesImportedBar = (context, expression) => {
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

/** Every visible control in a navbar band uses the shared control size. */
export const navbarControlSize = {
  meta: meta("FE_NAVBAR_CONTROL_SIZE", "FE-APP-SHELL-2 requires size=control on bar controls.", {
    control: "FE_NAVBAR_CONTROL_SIZE: {{name}} in the navbar band needs size=\"control\" so every bar control shares Grammar's control height.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set()
    return { JSXOpeningElement(node) {
      visitBar(context, node, (control, name) => {
        if (!isBarControl(context, control, name) || textProp(context, control, "size") === "control" || reported.has(control)) return
        reported.add(control)
        context.report({ node: control, messageId: "control", data: { name } })
      })
    } }
  },
}

/** The right cluster is checked at the bar's actions composition, in visual source order. */
export const navbarCluster = {
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
      const desktop = EXPECTED_CLUSTER.join("|")
      const mobile = EXPECTED_CLUSTER.slice(2).join("|")
      const sequences = alternatives.map((sequence) => sequence.join("|"))
      if (!sequences.includes(desktop) || sequences.some((sequence) => sequence !== desktop && sequence !== mobile)) context.report({ node, messageId: "cluster" })
    } }
  },
}

/** Creation belongs to its page, never to the global app bar. */
export const noNavbarCreate = {
  meta: meta("FE_NAVBAR_CREATE", "FE-APP-SHELL-5 keeps create actions on pages.", {
    create: "FE_NAVBAR_CREATE: move this create action from the navbar to its page.",
  }),
  create(context) {
    if (!isProductSource(context)) return {}
    const reported = new Set()
    const report = (node) => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: "create" })
    }
    const inspect = (control, name) => {
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
}

/** Every app-shell enforcer is gathered into the ordinary FE lint and gate path. */
export const rules = {
  "app-shell-frame": appShellFrame,
  "no-shell-bottom-tabs": noShellBottomTabs,
  "navbar-control-size": navbarControlSize,
  "navbar-cluster": navbarCluster,
  "no-navbar-create": noNavbarCreate,
}

/** Every rule is mandatory. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))

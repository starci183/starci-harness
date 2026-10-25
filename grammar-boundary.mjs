/**
 * The boundary between product code and `@starci/grammar`.
 *
 * Grammar is a business-neutral HeroUI-backed component package. Product code composes its components with ordinary React
 * children and typed props. A page's structure and text are made of those components, not of raw HTML: a raw `<section>`, `<p>`
 * or `<ul>` carries no density, no focus or landmark contract and no dark value from the design system, and the class names
 * written by hand to compensate are where a second visual language starts.
 *
 * Which tags are refused is decided by the package: a tag is in the list only when `@starci/grammar` exports a component that
 * renders it (`GRAMMAR_OWNERS` below, each entry verified against the package source by the twin test). A tag the grammar has no
 * component for (`div`, `br`, `aside`, `article`) is not refused: there is nothing to compose instead, and refusing it would
 * demand a workaround. When the grammar gains a component for one, the tag joins the list.
 *
 * WHERE IT APPLIES. App source that composes the grammar (slots `fe.feature`, `fe.components`, `fe.route`, `fe.hooks`) and any
 * workspace package except the `<family>-ui` package (`fe.package.ui`), whose components are the renderers and are the one place
 * a raw tag belongs. Spec files render raw HTML as a harness and are not judged. A file no slot owns is not judged either: the
 * rule refuses to guess a scope.
 */

import { walk } from "./lib/ast.mjs"
import { functionOf, isFn, unwrap, variableOf } from "./lib/bindings.mjs"
import { hfsOf } from "./lib/hfs.mjs"
import { isProductSource } from "./lib/scope.mjs"

/**
 * The intrinsic elements of page structure and text, each with the grammar components that render it.
 * Read against packages/grammar/src (`export const <Component>`); `grammar-boundary.spec.mjs` fails when one is not exported.
 */
export const GRAMMAR_OWNERS = Object.freeze({
  h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading",
  p: "Text", span: "Text",
  hr: "Divider",
  label: "Label",
  form: "Form",
  fieldset: "Fieldset",
  dl: "DescriptionList", dt: "DescriptionList", dd: "DescriptionList",
  table: "DataTable", thead: "DataTable", tbody: "DataTable", tr: "DataTable", td: "DataTable", th: "DataTable",
  ul: "List, SurfaceListCard or StaticStateRow", ol: "List, SurfaceListCard or StaticStateRow", li: "ListItem, SurfaceListCard or StaticStateRow",
  header: "SectionHeader or TopBar",
  footer: "Footer",
  nav: "NavLandmark, Subnav, Breadcrumbs or NavigationFeatureNav",
  section: "Region or SurfaceCard",
  main: "WorkspaceShell",
  figure: "MediaFrame", figcaption: "MediaFrame",
})

/** The slots of app source that compose the grammar: features, components, routes and hooks. */
const APP_SLOTS = new Set(["fe.feature", "fe.components", "fe.route", "fe.hooks"])

/** The slot of the package whose leaves ARE the renderers: the only place raw structural tags belong. */
const RENDERER_SLOT = "fe.package.ui"

/**
 * True for a file that composes the grammar: app source (`fe.feature`, `fe.components`, `fe.route`, `fe.hooks`) and any
 * workspace package but the `<family>-ui` package, whose components are the renderers.
 */
const composesGrammar = (context, file) => {
  const hfs = hfsOf(context)
  const slot = hfs.slotOf(file)
  if (slot === null || slot === RENDERER_SLOT) return false
  return APP_SLOTS.has(slot) || hfs.tierOf(file) === "package"
}

/** No raw structural or text element in app source or in a package that composes the grammar. */
export const noRawStructuralElement = {
  meta: {
    type: "problem",
    docs: { description: "Page structure and text are grammar components, not raw `div`-family HTML; only `fe.package.ui` renderers draw raw tags." },
    schema: [],
    messages: {
      raw:
        "A raw `<{{tag}}>`. Page structure and text are composed from the grammar (`@starci/grammar`, or the repository's `<family>-ui` package): use {{owner}}. A raw tag brings none of the design system's density, landmark and state contract, and the class names written to make up for it start a second visual language. If the grammar cannot express this structure, add the component to the grammar or the ui package rather than drawing it here.",
    },
  },
  create(context) {
    const file = context.filename || context.getFilename()
    if (!composesGrammar(context, file)) return {}
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return
        const owner = Object.hasOwn(GRAMMAR_OWNERS, node.name.name) ? GRAMMAR_OWNERS[node.name.name] : null
        if (owner !== null) context.report({ node, messageId: "raw", data: { tag: node.name.name, owner: `\`${owner}\`` } })
      },
    }
  },
}

/** The static property name of an access or destructured property. */
const propertyName = (node) => {
  const key = node.property ?? node.key
  if (!node.computed && key?.type === "Identifier") return key.name
  return key?.type === "Literal" && typeof key.value === "string" ? key.value : null
}

/** The platform member a local destructured binding selects. */
const destructuredPath = (context, declarator, local, seen) => {
  if (declarator.id.type !== "ObjectPattern") return null
  const property = declarator.id.properties.find((entry) => entry.type === "Property" && entry.value.type === "Identifier" && entry.value.name === local)
  const name = property && propertyName(property)
  const object = platformPath(context, declarator.init, seen)
  return object && name ? [...object, name] : null
}

/** A platform path, following local aliases and destructuring while refusing shadowed globals. */
const platformPath = (context, node, seen = new Set()) => {
  const inner = unwrap(node)
  if (!inner || seen.has(inner)) return null
  seen.add(inner)
  if (inner.type === "MemberExpression") {
    const object = platformPath(context, inner.object, seen)
    const name = propertyName(inner)
    return object && name ? [...object, name] : null
  }
  if (inner.type !== "Identifier") return null
  const variable = variableOf(context, inner)
  if (!variable || variable.defs.length === 0) return [inner.name]
  for (const definition of variable.defs) {
    if (definition.type !== "Variable" || !definition.node.init) continue
    const declarator = definition.node
    if (declarator.id.type === "Identifier") return platformPath(context, declarator.init, seen)
    return destructuredPath(context, declarator, inner.name, seen)
  }
  return null
}

/** A platform API spelling with the optional global-object prefix removed. */
const platformName = (context, node) => {
  const parts = platformPath(context, node)
  if (!parts) return null
  if (["window", "globalThis", "self"].includes(parts[0])) parts.shift()
  return parts.join(".")
}

/** A wall-clock read: Date.now(), Date(), zero-argument new Date(), or performance.now(). */
const readsClock = (context, root, seen = new Set()) => {
  if (!root || seen.has(root)) return false
  seen.add(root)
  let found = false
  walk(context.sourceCode, root, (node) => {
    if (found) return false
    if (node.type === "NewExpression" && node.arguments.length === 0 && platformName(context, node.callee) === "Date") found = true
    if (node.type !== "CallExpression") return undefined
    if (["Date", "Date.now", "performance.now"].includes(platformName(context, node.callee))) found = true
    const helper = functionOf(context, node.callee)
    if (helper && readsClock(context, helper.body, seen)) found = true
    return undefined
  })
  return found
}

/** Whether a timer callback runs its enclosing function again, directly or through a same-file helper. */
const callsFunction = (context, root, target, seen = new Set()) => {
  if (!root || seen.has(root)) return false
  if (root === target) return true
  seen.add(root)
  let found = false
  walk(context.sourceCode, root.body ?? root, (node) => {
    if (found) return false
    if (node.type !== "CallExpression") return undefined
    const called = functionOf(context, node.callee)
    if (called === target || called && callsFunction(context, called, target, seen)) found = true
    return undefined
  })
  return found
}

/** Grammar owns the shared clock for live time labels; product components and hooks only pass instants. */
export const noAppRelativeClock = {
  meta: {
    type: "problem",
    docs: { description: "Live relative time and countdowns use Grammar's shared clock rather than a product-owned ticker." },
    schema: [],
    messages: {
      clock: "This recurring timer reads the clock. Render RelativeTime with dateTime, locale and mode; digital countdowns support format=\"digital\", expiredLabel and a serializable template containing {time}. Grammar owns its single shared ticker and server-safe first render. Product components and hooks pass the target instant and never start another clock for time labels.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      CallExpression(node) {
        const timer = platformName(context, node.callee)
        if (timer !== "setInterval" && timer !== "setTimeout") return
        const callback = functionOf(context, node.arguments[0])
        if (!callback) return
        let owner = node.parent
        while (owner && !isFn(owner)) owner = owner.parent
        const repeats = timer === "setInterval" || owner && callsFunction(context, callback, owner)
        if (repeats && (readsClock(context, callback.body) || timer === "setTimeout" && readsClock(context, owner.body))) {
          context.report({ node, messageId: "clock" })
        }
      },
    }
  },
}

/** The rules this law contributes to the plugin. */
export const rules = {
  "no-raw-structural-element": noRawStructuralElement,
  "no-app-relative-clock": noAppRelativeClock,
}

/** Every rule is an error. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))

/**
 * The rules that hold `next-conventions.md` (HFS `FE_NEXT_CONVENTIONS`, with the lead's locale
 * decision: ONE locale pattern everywhere - `next-intl`, a `[locale]` segment, default `vi`,
 * `localePrefix: "as-needed"`, and `proxy.ts` on Next 16).
 *
 * WHY ONE PATTERN. Three repositories held three spellings of the same thing: a `[lang]` segment in
 * the standard's own example, two i18n stacks in one app so that `/` redirected into a 404, and a
 * `middleware.ts` that Next 16 no longer accepts under that name. Each is invisible to a type
 * check and each is found by a reader hitting the wrong page. The rules below hold the spellings a
 * single file can show; whether `routing.ts` carries `localePrefix: "as-needed"` is the
 * architecture machine's read of `modules/i18n`.
 */

import { attribute, attributeValue, calleeName, leadingTextOf, stringOf } from "./lib/ast.ts"
import { variableOf } from "./lib/bindings.ts"
import { forbiddingConcern } from "./lib/fe-stack.ts"
import { hfsOf } from "./lib/hfs.ts"
import { baseName, classOf, classifyImport, fileOf, inSlot, roleOfFile, slotOfFile } from "./lib/scope.ts"

/** Another i18n stack: a second place that decides which language a reader sees (one the fe-stack catalog forbids by name is fe-stack-import's finding). */
const OTHER_I18N = /^(?:react-i18next|i18next|next-i18next|react-intl|next-translate|typesafe-i18n|rosetta)(?:\/.*)?$|^@lingui\/.+$/

// -- FE-NEXT-1 -------------------------------------------------------------------------------------

/** Next 16 names the request interceptor `proxy.ts`; `middleware.ts` is forbidden. */
export const noMiddlewareFile = {
  meta: {
    type: "problem",
    docs: { description: "`middleware.ts` is forbidden: the request interceptor is `proxy.ts` and exports `proxy`." },
    schema: [],
    messages: {
      file:
        "`{{name}}` is not the request interceptor file: Next 16 reads `proxy.ts`. Rename the file and export the handler as `proxy`.",
      export:
        "The handler in `proxy.ts` is exported as `middleware`, but Next 16 reads `proxy`. Export it as `proxy`.",
    },
  },
  create(context) {
    const file = fileOf(context)
    // `middleware.ts` has a slot of its own (`fe.source-root-middleware`, forbidden); the interceptor is the `proxy` role of `fe.source-root-pinned`.
    if (inSlot(context, "fe.source-root-middleware")) {
      return { Program: (node) => context.report({ node, messageId: "file", data: { name: baseName(file) } }) }
    }
    if (!inSlot(context, "fe.source-root-pinned") || roleOfFile(context) !== "proxy") return {}
    const check = (node) => {
      const names = []
      const declaration = node.declaration
      if (declaration && declaration.id) names.push(declaration.id.name)
      if (declaration && declaration.type === "VariableDeclaration") {
        for (const d of declaration.declarations) if (d.id.type === "Identifier") names.push(d.id.name)
      }
      for (const specifier of node.specifiers ?? []) names.push(specifier.exported.name)
      if (names.includes("middleware")) context.report({ node, messageId: "export" })
    }
    return { ExportNamedDeclaration: check, ExportDefaultDeclaration: check }
  },
}

// -- FE-NEXT-2 -------------------------------------------------------------------------------------

/** The locale segment is `[locale]`. */
export const localeSegmentIsLocale = {
  meta: {
    type: "problem",
    docs: { description: "The locale route segment is `[locale]`, never `[lang]`." },
    schema: [],
    messages: {
      segment:
        "This file sits under a `[{{name}}]` segment. The one locale pattern is `[locale]` (next-intl, default `vi`, `localePrefix: \"as-needed\"`); a second spelling means a second routing table.",
    },
  },
  create(context) {
    // A route folder is a segment of slot `fe.route`; the locale one is `[locale]`, never another spelling.
    if (!inSlot(context, "fe.route")) return {}
    const hfs = hfsOf(context)
    const file = fileOf(context)
    const below = hfs.relative(file).slice(classOf(context).root.length + 1).split("/")
    const name = below.slice(0, -1).map((segment) => /^\[(lang|lng|language|i18n)\]$/.exec(segment)).find(Boolean)?.[1]
    if (!name) return {}
    return { Program: (node) => context.report({ node, messageId: "segment", data: { name } }) }
  },
}

// -- FE-NEXT-3 -------------------------------------------------------------------------------------

/** Exactly one i18n stack: next-intl. */
export const noSecondI18nStack = {
  meta: {
    type: "problem",
    docs: { description: "`next-intl` is the only i18n library." },
    schema: [],
    messages: {
      stack:
        "`{{name}}` is a second i18n stack. Two stacks decide the language twice and disagree at the edges (one app redirected `/` into a 404 that way). Use `next-intl` through `modules/i18n`.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = String(node.source.value)
        if (OTHER_I18N.test(source) && !forbiddingConcern(source)) context.report({ node, messageId: "stack", data: { name: source } })
      },
    }
  },
}

// -- FE-NEXT-4 -------------------------------------------------------------------------------------

/** `<html lang>` follows the `[locale]` segment. */
export const htmlLangFromLocale = {
  meta: {
    type: "problem",
    docs: { description: "`<html lang>` is taken from the `[locale]` segment, never a literal." },
    schema: [],
    messages: {
      lang:
        "`<html lang=\"...\">` is a literal. A Vietnamese product that ships `lang=\"en\"` mislabels every page for screen readers, translation prompts and search engines. Set it from the `[locale]` param: `lang={locale}`.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "html") return
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.name !== "lang" || !attribute.value) continue
          const value = attribute.value
          const literal =
            value.type === "Literal" ||
            (value.type === "JSXExpressionContainer" &&
              (value.expression.type === "Literal" ||
                (value.expression.type === "TemplateLiteral" && value.expression.expressions.length === 0)))
          if (literal) context.report({ node: attribute, messageId: "lang" })
        }
      },
    }
  },
}

// -- FE-NEXT-5 -------------------------------------------------------------------------------------

/** The names one named-export statement introduces. */
const statementExportNames = (statement) => {
  if (statement.type !== "ExportNamedDeclaration") return []
  const declaration = statement.declaration
  const names = (statement.specifiers ?? []).map((specifier) => specifier.exported.name)
  if (declaration?.id) names.push(declaration.id.name)
  if (declaration?.type === "VariableDeclaration") {
    for (const entry of declaration.declarations) {
      if (entry.id.type === "Identifier") names.push(entry.id.name)
    }
  }
  return names
}

/** The names a module exports, from declarations and specifiers. */
const exportedNames = (program) => new Set(program.body.flatMap(statementExportNames))

/** Every page names itself: `metadata` or `generateMetadata`. */
export const pageExportsMetadata = {
  meta: {
    type: "problem",
    docs: { description: "Every `page.tsx` exports `metadata` or `generateMetadata`." },
    schema: [],
    messages: {
      metadata:
        "This page exports neither `metadata` nor `generateMetadata`, so it ships with whatever title its layout happens to have: every page of the section is called the same in the tab, in the history, in a shared link and in a search result. Export `metadata` (or `generateMetadata` when the title comes from data), with the title and description taken from the message catalogue.",
    },
  },
  create(context) {
    // A page is the file the slot gives the role `page` (spec files carry no role).
    if (!inSlot(context, "fe.route") || roleOfFile(context) !== "page") return {}
    return {
      "Program:exit"(program) {
        const names = exportedNames(program)
        if (!names.has("metadata") && !names.has("generateMetadata")) context.report({ node: program, messageId: "metadata" })
      },
    }
  },
}

// -- FE-NEXT-6 -------------------------------------------------------------------------------------

/** A Suspense boundary shows something while it waits. */
export const noNullSuspenseFallback = {
  meta: {
    type: "problem",
    docs: { description: "`<Suspense>` has a fallback that renders something; `fallback={null}` is forbidden." },
    schema: [],
    messages: {
      nullFallback:
        "`<Suspense>` with a `null` (or missing) fallback: while the subtree loads the reader sees a hole where content will jump in, with no sign anything is happening. Render the loading state of the thing that is loading (the block's skeleton).",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name
        const isSuspense =
          (name.type === "JSXIdentifier" && name.name === "Suspense") ||
          (name.type === "JSXMemberExpression" && name.property.name === "Suspense")
        if (!isSuspense) return
        const fallback = attribute(node, "fallback")
        const value = attributeValue(fallback)
        const empty =
          !fallback ||
          !value ||
          (value.type === "Literal" && value.value === null) ||
          (value.type === "Identifier" && value.name === "undefined")
        if (empty) context.report({ node, messageId: "nullFallback" })
      },
    }
  },
}

// -- FE-NEXT-7 -------------------------------------------------------------------------------------

/** The locale-aware navigation owner and framework boundaries outside its provider. */
const isNavigationOwner = (context) =>
  inSlot(context, "fe.package.i18n") ||
  (inSlot(context, "fe.modules.routes") && hfsOf(context).apps.length === 1) ||
  (inSlot(context, "fe.source-root-pinned") && roleOfFile(context) === "proxy") ||
  (inSlot(context, "fe.route") && roleOfFile(context) === "global-error")

/** The router helpers that are locale-blind in `next/navigation`. */
const LOCALE_BLIND = new Set(["useRouter", "usePathname", "redirect", "permanentRedirect"])

/** Navigation helpers come from the locale-aware public routes or shared i18n entry. */
export const navigationFromIntl = {
  meta: {
    type: "problem",
    docs: { description: "`Link`, `useRouter`, `usePathname` and `redirect` come from the locale-aware routes or shared i18n public entry, not from Next." },
    schema: [],
    messages: {
      link:
        "`next/link` does not know the locale: a link built with it drops the `[locale]` prefix. Import Link from the locale-aware public routes entry or shared i18n package, built from the one routing configuration.",
      helper:
        "`{{name}}` from `next/navigation` does not know the locale. Import it from the locale-aware public routes entry or shared i18n package, built from the one routing configuration.",
    },
  },
  create(context) {
    if (isNavigationOwner(context)) return {}
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return
        const source = String(node.source.value)
        if (source === "next/link") return context.report({ node, messageId: "link" })
        if (source !== "next/navigation") return
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type" && LOCALE_BLIND.has(specifier.imported.name)) {
            context.report({ node: specifier, messageId: "helper", data: { name: specifier.imported.name } })
          }
        }
      },
    }
  },
}

// -- FE-NEXT-8 -------------------------------------------------------------------------------------

/** An href that leaves the app: a scheme, a protocol-relative URL, or an in-page anchor. */
const isExternalHref = (text) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(text)

/** No hand-drawn `<a>` for an internal route; an external one opens safely. */
export const noNativeAnchor = {
  meta: {
    type: "problem",
    docs: { description: "An internal link uses the locale-aware public navigation entry; an external `_blank` link carries `rel`." },
    schema: [],
    messages: {
      internal:
        "`<a href=\"{{href}}\">` for a route of this app reloads the page, skips prefetch and drops the locale prefix. Use the locale-aware Link with an href built by modules/routes.",
      rel:
        "`target=\"_blank\"` with no `rel`. The opened page can reach back through `window.opener`. Add `rel=\"noopener noreferrer\"`.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "a") return
        const href = stringOf(attributeValue(attribute(node, "href")))
        if (href !== null && href !== "" && !isExternalHref(href)) context.report({ node, messageId: "internal", data: { href } })
        const target = stringOf(attributeValue(attribute(node, "target")))
        const rel = attribute(node, "rel")
        if (target === "_blank" && !rel) context.report({ node, messageId: "rel" })
      },
    }
  },
}

// -- FE-NEXT-9 -------------------------------------------------------------------------------------

/** The functions whose first argument is a route: the router's methods and the two redirects. */
const isNavigation = (name) =>
  name === "redirect" || name === "permanentRedirect" || /(?:^|\.)router\.(?:push|replace|prefetch)$/.test(name)

/** True for `/x`, `/x/y`; false for `//host` and for `/` alone, which every app owns. */
const isInternalPath = (text) => text.startsWith("/") && !text.startsWith("//") && text.length > 1

/** The places that may write a route: the routes module (`fe.modules.routes`) and the i18n module (`fe.modules.i18n`). */
const isRoutesModule = (context) => inSlot(context, "fe.modules.routes", "fe.modules.i18n")

/** No route written by hand outside `modules/routes`. */
export const noHardcodedRoute = {
  meta: {
    type: "problem",
    docs: { description: "A route path is built by `modules/routes`, never written as a literal at a link or a navigation call." },
    schema: [],
    messages: {
      route:
        "`{{path}}` is a route written by hand. When the route moves, every copy of it silently points at a 404, and nothing type-checks the difference. Build it with the href builder in `modules/routes` and use that one function everywhere.",
    },
  },
  create(context) {
    if (isRoutesModule(context)) return {}
    const source = context.sourceCode ?? context.getSourceCode()
    const report = (node, text) => context.report({ node, messageId: "route", data: { path: text } })
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "href") return
        const value = attributeValue(node)
        const lead = leadingTextOf(value)
        if (lead !== null && isInternalPath(lead)) report(node, source.getText(value))
      },
      CallExpression(node) {
        const name = calleeName(node.callee)
        if (!name || !isNavigation(name)) return
        const first = node.arguments[0]
        const lead = leadingTextOf(first)
        if (lead !== null && isInternalPath(lead)) report(first, source.getText(first))
      },
    }
  },
}

// -- FE-NEXT-10 -----------------------------------------------------------------------------------

/** The next-intl stack factories: module specifier -> the export that builds one layer of the stack (`default` for a default export). */
const STACK_FACTORIES = new Map([
  ["next-intl/routing", new Set(["defineRouting"])],
  ["next-intl/navigation", new Set(["createNavigation"])],
  ["next-intl/server", new Set(["getRequestConfig"])],
  ["next-intl/middleware", new Set(["default"])],
])

/** The public name selected by a named or default import. */
const importedName = (specifier) => {
  if (specifier.type === "ImportSpecifier") return specifier.imported.name ?? specifier.imported.value
  if (specifier.type === "ImportDefaultSpecifier") return "default"
  return null
}

/** The known next-intl factory selected from an import. */
const stackFactory = (definition, exported) => {
  const source = String(definition.parent.source.value)
  if (!STACK_FACTORIES.get(source)?.has(exported)) return null
  return { source, name: exported === "default" ? "createMiddleware" : exported }
}

/** A factory called through a namespace import, else null. */
const namespaceFactory = (context, callee) => {
  if (callee.type !== "MemberExpression" || callee.computed || callee.object.type !== "Identifier" || callee.property.type !== "Identifier") return null
  const definition = variableOf(context, callee.object)?.defs[0] ?? null
  if (definition?.type !== "ImportBinding" || definition.node.type !== "ImportNamespaceSpecifier") return null
  return stackFactory(definition, callee.property.name)
}

/** The name a stack factory has where the call reads it: "defineRouting" (next-intl/routing), else null. */
const stackFactoryOf = (context, callee) => {
  if (callee.type !== "Identifier") return namespaceFactory(context, callee)
  const definition = variableOf(context, callee)?.defs[0] ?? null
  if (definition?.type !== "ImportBinding") return null
  return stackFactory(definition, importedName(definition.node))
}

/**
 * The next-intl stack is written once per repository.
 *
 * `defineRouting` (`next-intl/routing`), `createNavigation` (`next-intl/navigation`), `getRequestConfig` (`next-intl/server`) and
 * `createMiddleware` (`next-intl/middleware`), resolved by the import that binds the called name (a renamed import or a namespace
 * member counts), have one owner. A shared i18n package owns its stack. In a one-app repository, routing and request
 * config belong to modules/i18n while createNavigation belongs to modules/routes. The proxy imports routing without
 * evaluating navigation: next-intl's navigation module selects React runtime exports unavailable in the proxy.
 *
 * It does not replace `no-second-i18n-stack`: that rule refuses another i18n LIBRARY at its import, this one refuses a second copy of
 * next-intl's own stack. Different evidence, different remedy.
 */
export const i18nStackInOneModule = {
  meta: {
    type: "problem",
    docs: { description: "A shared i18n package owns the stack; one app keeps routing/request config in i18n and navigation in routes, with a routing-only proxy entry." },
    schema: [],
    messages: {
      stack:
        "`{{name}}` builds the next-intl stack outside its owner. Keep {{where}} and import the owned result through its public entry.",
      proxyNavigation:
        "The proxy imports navigation runtime through {{source}}. Import routing from the i18n public entry, or use the shared package's routing-only proxy export; the proxy must not evaluate the routes/navigation barrel.",
    },
  },
  create(context) {
    const hfs = hfsOf(context)
    const slot = slotOfFile(context)
    const single = hfs.apps.length === 1
    const proxy = single && slot === "fe.source-root-pinned" && roleOfFile(context) === "proxy"
    const proxyFile = slot === "fe.source-root-pinned" && roleOfFile(context) === "proxy"
    const where = single ? "routing/request config in modules/i18n and navigation in modules/routes" : "the stack in the shared i18n package that every app calls"
    const safeProxyImport = (node) => {
      if (!proxyFile || !node.source || node.importKind === "type" || node.exportKind === "type") return
      if (node.specifiers?.length && node.specifiers.every((entry) => entry.importKind === "type" || entry.exportKind === "type")) return
      const source = String(node.source.value)
      if (source === "next-intl/navigation" || classifyImport(context, source)?.slot === "fe.modules.routes") {
        context.report({ node, messageId: "proxyNavigation", data: { source } })
      }
    }
    return {
      ImportDeclaration: safeProxyImport,
      ExportNamedDeclaration: safeProxyImport,
      ExportAllDeclaration: safeProxyImport,
      CallExpression(node) {
        const factory = stackFactoryOf(context, node.callee)
        // In a one-app repository the proxy (role `proxy`) mounts the locale middleware built from the one routing; a shared repository
        // builds it in the i18n package and the proxy re-exports it.
        if (factory?.name === "createMiddleware" && proxy) return
        if (slot === "fe.package.i18n") return
        if (single && factory?.name === "createNavigation" && slot === "fe.modules.routes") return
        if (single && factory?.name !== "createNavigation" && slot === "fe.modules.i18n") return
        if (factory) context.report({ node, messageId: "stack", data: { name: factory.name, where } })
      },
    }
  },
}

/** The rules this law contributes to the plugin. */
export const rules = {
  "no-middleware-file": noMiddlewareFile,
  "locale-segment-is-locale": localeSegmentIsLocale,
  "no-second-i18n-stack": noSecondI18nStack,
  "html-lang-from-locale": htmlLangFromLocale,
  "page-exports-metadata": pageExportsMetadata,
  "no-null-suspense-fallback": noNullSuspenseFallback,
  "navigation-from-intl": navigationFromIntl,
  "no-native-anchor": noNativeAnchor,
  "no-hardcoded-route": noHardcodedRoute,
  "i18n-stack-in-one-module": i18nStackInOneModule,
}

/** Every rule is an error. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))

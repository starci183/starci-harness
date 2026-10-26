/**
 * The rule that holds `grammar-shim.md` (HFS R321, `FE_GRAMMAR_SHIM`).
 *
 * An app never re-exports a Grammar export under its own name. A shim, a file whose job is to hand a Grammar component
 * on from an app path (often behind a directive the Grammar forgot), makes the app green while the defect stays in the
 * Grammar for every other app; the defect is reported to the Grammar instead. Importing a Grammar component to render
 * it, wrapping it in an app component and type-only re-exports are not shims. Source inside the Grammar package itself
 * is out of scope: its entries re-export its components by design.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { unwrap, variableOf } from "./lib/bindings.mjs"

/** Every published entry of the Grammar package, the root and each subpath. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/|$)/
/** The Grammar package's own manifest name; its source re-exports by design. */
const GRAMMAR_PACKAGE = "@starci/grammar"

/** The manifest name of the package owning each directory, read once per directory. */
const packageNames = new Map()

/** The `name` of the nearest `package.json` that declares one, or null at the filesystem root. */
const packageNameOf = (directory) => {
  if (packageNames.has(directory)) return packageNames.get(directory)
  const parent = dirname(directory)
  const manifest = resolve(directory, "package.json")
  let name = null
  if (existsSync(manifest)) {
    try {
      const declared = JSON.parse(readFileSync(manifest, "utf8")).name
      if (typeof declared === "string") name = declared
    } catch {
      name = null
    }
  }
  if (name === null && parent !== directory) name = packageNameOf(parent)
  packageNames.set(directory, name)
  return name
}

/** True for a type-only import or export, declaration-wide or per specifier; a type is no component to shim. */
const typeOnly = (...nodes) => nodes.some((node) => node.importKind === "type" || node.exportKind === "type")

/** The Grammar import an identifier binds, `{ source, name }`, or null for a local, foreign or type-only binding. */
const grammarImportOf = (context, identifier) => {
  const definition = variableOf(context, identifier)?.defs.find((entry) => entry.type === "ImportBinding")
  if (!definition) return null
  const source = String(definition.parent.source.value)
  if (!GRAMMAR_SOURCE.test(source) || typeOnly(definition.parent, definition.node)) return null
  const specifier = definition.node
  const name = specifier.type === "ImportSpecifier" ? specifier.imported.name ?? String(specifier.imported.value) : identifier.name
  return { source, name }
}

/** The Grammar import an exported value is exactly (`X`, `G.X`), or null for anything computed or wrapped. */
const grammarValueOf = (context, expression) => {
  let node = unwrap(expression)
  const path = []
  while (node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    path.unshift(node.property.name)
    node = unwrap(node.object)
  }
  if (node?.type !== "Identifier") return null
  const imported = grammarImportOf(context, node)
  if (imported === null) return null
  return path.length === 0 ? imported : { source: imported.source, name: path.join(".") }
}

/** The name an export specifier spells, identifier or string literal. */
const spelled = (node) => node.name ?? String(node.value)

const grammarShim = {
  meta: {
    type: "problem",
    docs: { description: "R321: an app never re-exports a Grammar export under its own name; a Grammar defect is reported to the Grammar, not shimmed in the app." },
    schema: [],
    messages: {
      FE_GRAMMAR_SHIM: "FE_GRAMMAR_SHIM: this file re-exports {{name}} of {{source}} under the app's own name. A defect in a Grammar component belongs to the Grammar: report it (the op files `blocked` naming the package, the component and the error), never shim it in the app; import the component from {{source}} where it is rendered.",
    },
  },
  create(context) {
    const filename = resolve(context.cwd, context.physicalFilename)
    if (packageNameOf(dirname(filename)) === GRAMMAR_PACKAGE) return {}
    const report = (node, name, source) => context.report({ node, messageId: "FE_GRAMMAR_SHIM", data: { name: name === null ? "every export" : `\`${name}\``, source } })
    return {
      ExportAllDeclaration(node) {
        const source = String(node.source.value)
        if (!GRAMMAR_SOURCE.test(source) || typeOnly(node)) return
        report(node, node.exported ? spelled(node.exported) : null, source)
      },
      ExportNamedDeclaration(node) {
        if (typeOnly(node)) return
        if (node.source) {
          const source = String(node.source.value)
          if (!GRAMMAR_SOURCE.test(source)) return
          for (const specifier of node.specifiers) {
            if (!typeOnly(specifier)) report(specifier, spelled(specifier.local), source)
          }
          return
        }
        for (const specifier of node.specifiers) {
          const imported = typeOnly(specifier) || specifier.local.type !== "Identifier" ? null : grammarImportOf(context, specifier.local)
          if (imported) report(specifier, imported.name, imported.source)
        }
        if (node.declaration?.type !== "VariableDeclaration") return
        for (const declarator of node.declaration.declarations) {
          const imported = declarator.init ? grammarValueOf(context, declarator.init) : null
          if (imported) report(declarator, imported.name, imported.source)
        }
      },
      ExportDefaultDeclaration(node) {
        const imported = grammarValueOf(context, node.declaration)
        if (imported) report(node, imported.name, imported.source)
      },
    }
  },
}

/** The one rule of the law. */
export const rules = { "no-grammar-shim": grammarShim }

/** The rule reaches consumers at error. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))

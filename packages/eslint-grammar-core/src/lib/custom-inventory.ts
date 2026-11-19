/**
 * The Custom inventory: a report of every `<Custom reason="...">` region an app holds, so each use can be audited. It is information,
 * never a finding: it lists, it does not fail, and the CLI that prints it always exits 0 (a `<Custom>` with no reason is listed as
 * such; the `custom-has-reason` rule is the one that fails it).
 *
 * A use is the file and position of the element, the element it renders (`as`, `div` by default), its reason and the third-party
 * libraries its subtree names (the modules the file imports, other than the Grammar and relative paths, whose bindings the region uses).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { parseForESLint } from "@typescript-eslint/parser"
import type { TSESTree } from "@typescript-eslint/types"

/** One `<Custom>` region. */
export interface CustomUse {
  /** The file, relative to the scanned root, with forward slashes. */
  readonly file: string
  readonly line: number
  readonly column: number
  /** The element the region renders: the literal `as`, or `div`. */
  readonly as: string
  /** The literal `reason`, or null when it is missing or computed. */
  readonly reason: string | null
  /** The third-party modules the region's subtree uses. */
  readonly libraries: readonly string[]
}

/** The Grammar package entries a component can be imported from. */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/

/** The folders no source of the app lives in. */
const SKIPPED = new Set(["node_modules", "dist", ".next", ".git", ".turbo", "coverage", "storybook-static", ".runtime"])

const isNode = (value: unknown): value is TSESTree.Node => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"

/** The text of a string-literal attribute value, or null when it is absent or computed. */
const literalText = (attribute: TSESTree.JSXAttribute | undefined): string | null => {
  const value = attribute?.value
  if (value === undefined || value === null) return null
  const node = value.type === "JSXExpressionContainer" ? value.expression : value
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : null
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null
  return null
}

const attributeOf = (opening: TSESTree.JSXOpeningElement, name: string): TSESTree.JSXAttribute | undefined =>
  opening.attributes.find((entry): entry is TSESTree.JSXAttribute => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === name)

/**
 * The `<Custom>` regions of one source text.
 *
 * @param source - The text of a `.tsx` or `.jsx` file.
 * @param file - The path to report the uses under.
 * @returns The regions in source order; none when the file does not import `Custom` from the Grammar.
 */
export const customUsesOf = (source: string, file: string): CustomUse[] => {
  if (!source.includes("Custom")) return []
  const { ast, visitorKeys } = parseForESLint(source, { ecmaFeatures: { jsx: true }, sourceType: "module", range: true, loc: true })
  const custom = new Set<string>()
  const namespaces = new Set<string>()
  const modules = new Map<string, string>()
  for (const statement of ast.body) {
    if (statement.type !== "ImportDeclaration") continue
    const from = String(statement.source.value)
    const grammar = GRAMMAR_SOURCE.test(from)
    for (const specifier of statement.specifiers) {
      if (grammar && specifier.type === "ImportSpecifier" && (specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value)) === "Custom") custom.add(specifier.local.name)
      else if (grammar && specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name)
      else if (!grammar && !from.startsWith(".") && !from.startsWith("/") && !from.startsWith("node:") && statement.importKind !== "type") modules.set(specifier.local.name, from)
    }
  }
  if (custom.size === 0 && namespaces.size === 0) return []
  const found: CustomUse[] = []
  const namesIn = (node: TSESTree.Node, into: Set<string>): void => {
    if (node.type === "Identifier" || node.type === "JSXIdentifier") into.add(node.name)
    for (const key of visitorKeys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key)
      if (Array.isArray(value)) for (const item of value) { if (isNode(item)) namesIn(item, into) }
      else if (isNode(value)) namesIn(value, into)
    }
  }
  const isCustom = (name: TSESTree.JSXTagNameExpression): boolean => {
    if (name.type === "JSXIdentifier") return custom.has(name.name)
    return name.type === "JSXMemberExpression" && name.property.name === "Custom" && name.object.type === "JSXIdentifier" && namespaces.has(name.object.name)
  }
  const visit = (node: TSESTree.Node): void => {
    if (node.type === "JSXElement" && isCustom(node.openingElement.name)) {
      const names = new Set<string>()
      namesIn(node, names)
      found.push({
        file,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        as: literalText(attributeOf(node.openingElement, "as")) ?? "div",
        reason: literalText(attributeOf(node.openingElement, "reason")),
        libraries: [...new Set([...names].flatMap((name) => modules.get(name) ?? []))].sort(),
      })
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key)
      if (Array.isArray(value)) for (const item of value) { if (isNode(item)) visit(item) }
      else if (isNode(value)) visit(value)
    }
  }
  visit(ast)
  return found
}

/** The `.tsx` and `.jsx` files under a folder, skipping dependency, build, spec and story files. */
const sourcesUnder = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sourcesUnder(join(folder, entry.name))
    return /\.[jt]sx$/u.test(entry.name) && !/\.(?:spec|test|stories)\.[jt]sx$/u.test(entry.name) ? [join(folder, entry.name)] : []
  })

/**
 * Every `<Custom>` region under a folder.
 *
 * @param root - The folder to scan (an app root, or its `src/`).
 * @returns The regions, by file then position.
 */
export const customInventory = (root: string): CustomUse[] =>
  sourcesUnder(root)
    .sort()
    .flatMap((path) => customUsesOf(readFileSync(path, "utf8"), relative(root, path).split(sep).join("/")))

/**
 * The inventory as text: a header with the counts, then one line per region. Information only.
 *
 * @param uses - The regions.
 * @returns The report.
 */
export const formatCustomInventory = (uses: readonly CustomUse[]): string => {
  const files = new Set(uses.map((use) => use.file)).size
  const lines = [`Custom inventory: ${uses.length} region${uses.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} (information, not findings)`]
  for (const use of uses) {
    const libraries = use.libraries.length > 0 ? `  [${use.libraries.join(", ")}]` : ""
    lines.push(`${use.file}:${use.line}:${use.column}  <${use.as}>  ${use.reason === null ? "(no reason: custom-has-reason fails it)" : JSON.stringify(use.reason)}${libraries}`)
  }
  return lines.join("\n")
}

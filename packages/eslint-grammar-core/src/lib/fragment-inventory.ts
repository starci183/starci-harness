/**
 * The Fragment inventory: a report of every `<Fragment reason="...">` region an app holds, so each use can be audited. It is information,
 * never a finding: it lists, it does not fail, and the CLI that prints it always exits 0 (a `<Fragment>` with no reason is listed as
 * such; the `fragment-has-reason` rule is the one that fails it).
 *
 * A use is the file and position of the element, its reason and the third-party
 * libraries its subtree names (the modules the file imports, other than the Grammar and relative paths, whose bindings the region uses).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { parseForESLint } from "@typescript-eslint/parser"
import type { TSESTree } from "@typescript-eslint/types"

/** One `<Fragment>` region. */
export interface FragmentUse {
  /** The file, relative to the scanned root, with forward slashes. */
  readonly file: string
  readonly line: number
  readonly column: number
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
 * The `<Fragment>` regions of one source text.
 *
 * @param source - The text of a `.tsx` or `.jsx` file.
 * @param file - The path to report the uses under.
 * @returns The regions in source order; none when the file does not import `Fragment` from the Grammar.
 */
export const fragmentUsesOf = (source: string, file: string): FragmentUse[] => {
  if (!source.includes("Fragment")) return []
  const { ast, visitorKeys } = parseForESLint(source, { ecmaFeatures: { jsx: true }, sourceType: "module", range: true, loc: true })
  const fragment = new Set<string>()
  const namespaces = new Set<string>()
  const modules = new Map<string, string>()
  for (const statement of ast.body) {
    if (statement.type !== "ImportDeclaration") continue
    const from = String(statement.source.value)
    const grammar = GRAMMAR_SOURCE.test(from)
    for (const specifier of statement.specifiers) {
      if (grammar && specifier.type === "ImportSpecifier" && (specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value)) === "Fragment") fragment.add(specifier.local.name)
      else if (grammar && specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name)
      else if (!grammar && !from.startsWith(".") && !from.startsWith("/") && !from.startsWith("node:") && statement.importKind !== "type") modules.set(specifier.local.name, from)
    }
  }
  if (fragment.size === 0 && namespaces.size === 0) return []
  const found: FragmentUse[] = []
  const namesIn = (node: TSESTree.Node, into: Set<string>): void => {
    if (node.type === "Identifier" || node.type === "JSXIdentifier") into.add(node.name)
    for (const key of visitorKeys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key)
      if (Array.isArray(value)) for (const item of value) { if (isNode(item)) namesIn(item, into) }
      else if (isNode(value)) namesIn(value, into)
    }
  }
  const isFragment = (name: TSESTree.JSXTagNameExpression): boolean => {
    if (name.type === "JSXIdentifier") return fragment.has(name.name)
    return name.type === "JSXMemberExpression" && name.property.name === "Fragment" && name.object.type === "JSXIdentifier" && namespaces.has(name.object.name)
  }
  const visit = (node: TSESTree.Node): void => {
    if (node.type === "JSXElement" && isFragment(node.openingElement.name)) {
      const names = new Set<string>()
      namesIn(node, names)
      found.push({
        file,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
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
 * Every `<Fragment>` region under a folder.
 *
 * @param root - The folder to scan (an app root, or its `src/`).
 * @returns The regions, by file then position.
 */
export const fragmentInventory = (root: string): FragmentUse[] =>
  sourcesUnder(root)
    .sort()
    .flatMap((path) => fragmentUsesOf(readFileSync(path, "utf8"), relative(root, path).split(sep).join("/")))

/**
 * The inventory as text: a header with the counts, then one line per region. Information only.
 *
 * @param uses - The regions.
 * @returns The report.
 */
export const formatFragmentInventory = (uses: readonly FragmentUse[]): string => {
  const files = new Set(uses.map((use) => use.file)).size
  const lines = [`Fragment inventory: ${uses.length} region${uses.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} (information, not findings)`]
  for (const use of uses) {
    const libraries = use.libraries.length > 0 ? `  [${use.libraries.join(", ")}]` : ""
    lines.push(`${use.file}:${use.line}:${use.column}  ${use.reason === null ? "(no reason: fragment-has-reason fails it)" : JSON.stringify(use.reason)}${libraries}`)
  }
  return lines.join("\n")
}

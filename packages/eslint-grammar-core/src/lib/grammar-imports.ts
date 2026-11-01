import type { TSESTree } from "@typescript-eslint/types"

/** A module that is the Grammar package or one of its entries (`@starci/grammar`, `@starci/grammar/core`, `/common`, `/offset-pop`). */
const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/|$)/

/** Where a name was reached: a named import specifier, or a member of a Grammar namespace import. */
export interface RemovedImport {
  readonly node: TSESTree.Node
  readonly name: string
}

/**
 * The visitor of a law that reduces to imports: a Grammar export that no longer exists is refused where it is imported
 * (`import { Name }`) or reached through a namespace (`G.Name`, in an expression or a JSX tag). The law needs no
 * structural reading, because the export is the whole of the thing it forbids.
 */
export const refuseGrammarExports = (names: ReadonlySet<string>, refuse: (found: RemovedImport) => void) => {
  const namespaces = new Set<string>()
  const member = (object: TSESTree.Node, property: TSESTree.Node, node: TSESTree.Node): void => {
    const owner = object.type === "Identifier" || object.type === "JSXIdentifier" ? object.name : null
    const name = property.type === "Identifier" || property.type === "JSXIdentifier" ? property.name : null
    if (owner !== null && name !== null && namespaces.has(owner) && names.has(name)) refuse({ node, name })
  }
  return {
    ImportDeclaration(declaration: TSESTree.ImportDeclaration) {
      if (!GRAMMAR_SOURCE.test(String(declaration.source.value))) return
      for (const specifier of declaration.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name)
        else if (specifier.type === "ImportSpecifier") {
          const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value)
          if (names.has(imported)) refuse({ node: specifier, name: imported })
        }
      }
    },
    MemberExpression(node: TSESTree.MemberExpression) { member(node.object, node.property, node) },
    JSXMemberExpression(node: TSESTree.JSXMemberExpression) {
      if (node.parent.type === "JSXClosingElement") return
      member(node.object, node.property, node)
    },
  }
}

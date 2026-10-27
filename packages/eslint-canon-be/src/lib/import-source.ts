/**
 * Import-owner helpers: what a name written in a file IS, by the import that binds it, never by how it is spelled.
 *
 * `import { CommandHandler as Handler } from "@nestjs/cqrs"` and `import { CommandHandler } from "@nestjs/cqrs"` are the
 * same decorator; a local class that happens to be called `CommandHandler` is not. A rule that asks
 * `importOf(context, identifier)` sees that difference and a rule that compares identifier text does not.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import type { Context, Node } from "./rule.ts"

/** An import binding: the module specifier and the exported name (`*` for a namespace import, `default` for a default import). */
export interface ImportBinding {
    readonly source: string
    readonly imported: string | null
}

/** One place a file names another module. */
export interface ModuleReference {
    readonly node: Node
    readonly source: Node
    readonly value: string
    readonly names: ReadonlyArray<string | null>
}

const textOf = (node: Node | null | undefined): string | null =>
    (node?.type === "Identifier" ? node.name : node?.type === "Literal" ? String(node.value) : null)

/**
 * The import an identifier resolves to.
 *
 * @param context - The ESLint rule context.
 * @param identifier - An `Identifier` node in a value or decorator position.
 * @returns The module specifier and the exported name (`*` for a namespace import, `default` for a default import), or null when the name is not an import binding.
 */
export const importOf = (context: Context, identifier: Node | null | undefined): ImportBinding | null => {
    if (identifier?.type !== "Identifier") return null
    for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name)
        if (!variable) continue
        const definition = variable.defs[0]
        if (definition?.type !== "ImportBinding") return null
        const specifier = definition.node
        const source = importSourceOf(definition.parent)
        if (specifier.type === "ImportSpecifier") return { source, imported: textOf(specifier.imported) }
        if (specifier.type === "ImportNamespaceSpecifier") return { source, imported: "*" }
        return { source, imported: "default" }
    }
    return null
}

/** The module specifier of the declaration an import binding sits in. */
const importSourceOf = (parent: TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration | null): string => {
    if (parent?.type === "ImportDeclaration") return parent.source.value
    throw new TypeError("an import binding outside an import declaration has no module specifier")
}

/**
 * True when an expression is `name` exported by `source`, whether written as the imported (possibly renamed) identifier
 * or as a member of a namespace import of that module.
 *
 * @param context - The ESLint rule context.
 * @param expression - An `Identifier` or `MemberExpression` node.
 * @param sources - The module specifier or specifiers.
 * @param names - The exported name or names.
 * @returns Whether the expression is one of those exports.
 */
export const isImportedFrom = (
    context: Context,
    expression: Node | null | undefined,
    sources: string | ReadonlyArray<string>,
    names: string | ReadonlyArray<string>,
): boolean => {
    const wantedSources: ReadonlyArray<string | null> = typeof sources === "string" ? [sources] : sources
    const wantedNames: ReadonlyArray<string | null> = typeof names === "string" ? [names] : names
    if (expression?.type === "Identifier") {
        const found = importOf(context, expression)
        return found !== null && wantedSources.includes(found.source) && wantedNames.includes(found.imported)
    }
    if (expression?.type === "MemberExpression" && !expression.computed && expression.object.type === "Identifier") {
        const found = importOf(context, expression.object)
        return found !== null && found.imported === "*" && wantedSources.includes(found.source) && wantedNames.includes(textOf(expression.property))
    }
    return false
}

/** The called expression of a decorator: `@Foo` and `@Foo(...)` both give `Foo`. */
export const decoratorCallee = (decorator: TSESTree.Decorator | null | undefined): TSESTree.Expression | null => {
    const expression = decorator?.expression
    return expression?.type === "CallExpression" ? expression.callee : expression ?? null
}

/** The arguments of a decorator (`[]` for a bare `@Foo`). */
export const decoratorArguments = (decorator: TSESTree.Decorator | null | undefined): TSESTree.CallExpressionArgument[] =>
    (decorator?.expression?.type === "CallExpression" ? decorator.expression.arguments : [])

/** The text of a string literal, or of a template with no substitution, else null. */
const literal = (node: Node | null | undefined): string | null =>
    (node?.type === "Literal" && typeof node.value === "string"
        ? node.value
        : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? (node.quasis[0]?.value.cooked ?? null) : null)

/** The visitor object `moduleReferences` returns. */
export type ModuleReferenceVisitors = ReturnType<typeof moduleReferences>

/** Run the `moduleReferences` visitor of a node's own type, if it has one (a walk that is not ESLint's traversal). */
export const visitModuleReference = (visitors: ModuleReferenceVisitors, node: Node): void => {
    switch (node.type) {
        case "ImportDeclaration": visitors.ImportDeclaration(node); break
        case "ExportNamedDeclaration": visitors.ExportNamedDeclaration(node); break
        case "ExportAllDeclaration": visitors.ExportAllDeclaration(node); break
        case "ImportExpression": visitors.ImportExpression(node); break
        case "CallExpression": visitors.CallExpression(node); break
        case "TSImportEqualsDeclaration": visitors.TSImportEqualsDeclaration(node); break
        default: break
    }
}

/**
 * Visitors that report every place a file names another module: a static import, an `export ... from`, a dynamic
 * `import()`, `import x = require()` and a `require()` call with a literal argument.
 *
 * @param onReference - Called once per reference; `names` are the exported names taken (`*` for a whole module).
 * @returns An ESLint visitor object.
 */
export const moduleReferences = (onReference: (reference: ModuleReference) => void) => ({
    ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        const names = node.specifiers.map((specifier) => specifier.type === "ImportSpecifier" ? textOf(specifier.imported) : specifier.type === "ImportNamespaceSpecifier" ? "*" : "default")
        onReference({ node, source: node.source, value: node.source.value, names: names.length > 0 ? names : ["*"] })
    },
    ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration): void {
        if (!node.source) return
        onReference({ node, source: node.source, value: node.source.value, names: node.specifiers.map((specifier) => textOf(specifier.local)) })
    },
    ExportAllDeclaration(node: TSESTree.ExportAllDeclaration): void {
        onReference({ node, source: node.source, value: node.source.value, names: ["*"] })
    },
    ImportExpression(node: TSESTree.ImportExpression): void {
        const value = literal(node.source)
        if (value !== null) onReference({ node, source: node.source, value, names: ["*"] })
    },
    CallExpression(node: TSESTree.CallExpression): void {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return
        const argument = node.arguments[0]
        const value = literal(argument)
        if (value !== null && argument !== undefined) onReference({ node, source: argument, value, names: ["*"] })
    },
    TSImportEqualsDeclaration(node: TSESTree.TSImportEqualsDeclaration): void {
        const reference = node.moduleReference
        if (reference.type !== "TSExternalModuleReference") return
        const value = literal(reference.expression)
        if (value !== null) onReference({ node, source: reference.expression, value, names: ["*"] })
    },
})

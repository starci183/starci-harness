/**
 * What the persistence laws share: the declared connections, the named injector each one owns, the sites where a class
 * receives an infrastructure value, and the type and slot questions a rule asks about them.
 *
 * Nothing here matches a path or a variable name. A receiver is an `EntityManager` because its TypeScript type is
 * `typeorm`'s; a file is the database capability's because the HFS slot manifest says so.
 */
import { normalizePath } from "./path.ts"
import { ownerNameOf } from "./ports.ts"
import { typeOrigins } from "./types.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { HfsConnection, HfsView } from "./hfs.ts"
import type { Context, Node } from "./rule.ts"

/** One place a class receives a dependency: a constructor parameter or a property, with its decorator names and type annotation. */
export interface InjectionSite {
    readonly node: Node
    readonly kind: "param" | "property"
    readonly decorators: string[]
    readonly annotation: TSESTree.TypeNode | null
}

/** The `typeorm` types a class must never receive except through the platform database capability. */
const INFRA_TYPES = new Set(["EntityManager", "DataSource", "QueryRunner"])

/**
 * PascalCase of a connection name: `expert-academy` gives `ExpertAcademy`.
 *
 * @param {string} name - A kebab-case connection name from `hfs.json`.
 * @returns {string} The PascalCase form.
 */
export const pascalOf = (name: unknown): string =>
    String(name).split(/[-_]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")

/**
 * The one injector name a declared connection owns.
 *
 * @param {string} connection - A connection name.
 * @returns {string} `Inject<Pascal>EntityManager`.
 */
export const injectorNameOf = (connection: string): string => `Inject${pascalOf(connection)}EntityManager`

/**
 * The declared connections of the repository.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @returns {Array<{ name: string, envPrefix: string }>} The `hfs.json` connections.
 */
export const connectionsOf = (hfs: HfsView): readonly HfsConnection[] => hfs.connections ?? []

/**
 * The declared injector names, in declaration order.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @returns {Array<string>} One `Inject<Pascal>EntityManager` per declared connection.
 */
export const declaredInjectorNames = (hfs: HfsView): string[] => connectionsOf(hfs).map((connection) => injectorNameOf(connection.name))

/**
 * The last segment of a path.
 *
 * @param {string} filename - A file path.
 * @returns {string} The base name.
 */
export const baseNameOf = (filename: string): string => normalizePath(filename).split("/").pop() ?? ""

/**
 * Whether a file belongs to the platform database capability.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @param {string} file - A file path.
 * @returns {boolean} True for `be.platform` files of the `database` capability.
 */
export const inDatabaseCapability = (hfs: HfsView, file: string) => {
    const found = hfs.classify(file)
    return found.slot === "be.platform" && found.bindings?.capability === "database"
}

/**
 * Whether a file is the command line of the back end: the cli app (slot `be.app.cli`) or the cli feature root (slot `be.cli`,
 * `src/features/cli/`), where every one-off action runs, the migrate and seed commands among them.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @param {string} file - A file path.
 * @returns {boolean} True for the files of the cli app and the cli feature root.
 */
export const inCli = (hfs: HfsView, file: string) => hfs.slotOf(file) === "be.app.cli" || hfs.slotOf(file) === "be.cli"

/**
 * Whether a file is a migration: a `be.persistence` file below its `migrations/` folder.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @param {string} file - A file path.
 * @returns {boolean} True for a migration file.
 */
export const isMigrationFile = (hfs: HfsView, file: string) => {
    const found = hfs.classify(file)
    return found.slot === "be.persistence" && hfs.relative(file).startsWith(`${found.root}/migrations/`)
}

/**
 * The connection a `<conn>.<role>.ts` file of the database capability is about, when that connection is declared.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @param {string} file - A file path.
 * @param {string} role - `decorators`, `connection` or `config`.
 * @returns {{ name: string, envPrefix: string } | null} The declared connection, or null.
 */
export const connectionFileOf = (hfs: HfsView, file: string, role: string): HfsConnection | null => {
    if (!inDatabaseCapability(hfs, file)) return null
    const suffix = `.${role}.ts`
    const base = baseNameOf(file)
    if (!base.endsWith(suffix)) return null
    const name = base.slice(0, -suffix.length)
    return connectionsOf(hfs).find((connection) => connection.name === name) ?? null
}

/** The platform capabilities that own a `persistence/` and so may hold an `EntityManager` (a pattern capability is named by its folder). */
const PERSISTENCE_CAPABILITIES: ReadonlyArray<string | null | undefined> = ["database", "inbox", "event-bus", "queue", "jobs", "saga", "outbox", "realtime", "http-security"]

/**
 * Whether a class in this file may receive an `EntityManager`: an application handler, a domain service, a projection, a typed queue producer (it takes the transaction of its caller), a platform persistence capability.
 *
 * @param {object} hfs - The HFS view of the repository.
 * @param {string} file - A file path.
 * @returns {boolean} True for the EntityManager-using service roles.
 */
export const mayHoldEntityManager = (hfs: HfsView, file: string) => {
    const found = hfs.classify(file)
    const base = baseNameOf(file)
    if (found.slot === "be.feature.application") return base.endsWith(".handler.ts")
    if (found.slot === "be.domain") return base.endsWith(".service.ts")
    if (found.slot === "be.projections") return base.endsWith(".projection.ts")
    if (found.slot === "be.queues") return base.endsWith(".queue.ts")
    return typeof found.slot === "string" && found.slot.startsWith("be.platform") && PERSISTENCE_CAPABILITIES.includes(ownerNameOf(hfs, file))
}

/**
 * The `typeorm` infrastructure type of a node (`EntityManager`, `DataSource`, `QueryRunner`), by type and not by name.
 *
 * @param {object} context - The ESLint rule context.
 * @param {object} node - An expression, parameter or type annotation node.
 * @returns {string | null} The type name, or null when the node is none of them.
 */
export const infraTypeOf = (context: Context, node: Node): string | null => {
    const origin = typeOrigins(context, node).find((entry) => entry.module === "typeorm" && INFRA_TYPES.has(entry.name))
    return origin ? origin.name : null
}

/**
 * Whether a class is a TypeORM migration: it implements the `MigrationInterface` typeorm declares. A migration receives a
 * `QueryRunner` by contract, wherever the file sits (a fixture migration is one too).
 *
 * @param {object} context - The ESLint rule context.
 * @param {object} classNode - A ClassDeclaration or ClassExpression.
 * @returns {boolean} True when the class implements typeorm's `MigrationInterface`.
 */
export const implementsMigration = (context: Context, classNode: TSESTree.ClassDeclaration | TSESTree.ClassExpression): boolean =>
    (classNode.implements ?? []).some((entry) => typeOrigins(context, entry).some((origin) => origin.module === "typeorm" && origin.name === "MigrationInterface"))

/** The decorator names written on a node: `@Foo()` and `@Foo` both give `Foo`. */
const decoratorNamesOf = (node: { readonly decorators?: readonly TSESTree.Decorator[] }): string[] =>
    (node.decorators ?? []).flatMap((decorator) => {
        const expression = decorator.expression
        if (expression.type === "CallExpression" && expression.callee.type === "Identifier") return [expression.callee.name]
        return expression.type === "Identifier" ? [expression.name] : []
    })

/**
 * The visitors that find every place a class receives a value: a constructor parameter (a parameter property included)
 * or a class property. Each place is handed to `handle` with its decorators and its type annotation.
 *
 * @param {(site: { node: object, kind: "param" | "property", decorators: Array<string>, annotation: object | null }) => void} handle - Called once per site.
 * @returns {object} The ESLint visitors.
 */
export const injectionSites = (handle: (site: InjectionSite) => void) => ({
    MethodDefinition(node: TSESTree.MethodDefinition): void {
        if (node.kind !== "constructor" || !node.value?.params) return
        for (const original of node.value.params) {
            const wrapped = original.type === "TSParameterProperty" ? original.parameter : original
            const param = wrapped.type === "AssignmentPattern" ? wrapped.left : wrapped
            handle({
                node: param,
                kind: "param",
                decorators: [...decoratorNamesOf(original), ...decoratorNamesOf(param)],
                annotation: param.typeAnnotation?.typeAnnotation ?? null,
            })
        }
    },
    PropertyDefinition(node: TSESTree.PropertyDefinition): void {
        handle({ node, kind: "property", decorators: decoratorNamesOf(node), annotation: node.typeAnnotation?.typeAnnotation ?? null })
    },
})

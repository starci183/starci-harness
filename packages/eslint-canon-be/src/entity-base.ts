/**
 * The entity-base law (catalog R342 `BE_ENTITY_EXTENDS_BASE`; contexts/code/be/persistence.md BE-PERSISTENCE-3, ruling `entity-base`):
 * columns every table shares are inherited, never repeated. `platform/database/abstract.entity.ts` holds `AbstractEntity`
 * (`created_at`, `updated_at`, which the database sets) and `UuidAbstractEntity` (those plus the generated uuid `id`); an entity
 * whose table has those columns extends the base, imported from `@modules/platform/database`.
 *
 *   - `entity-extends-base` refuses an `@Entity` class that declares, itself, a database-set `created_at` or `updated_at` column
 *     (`@CreateDateColumn`, `@UpdateDateColumn`, or a `@Column` named `created_at` / `updated_at`, or on a `createdAt` / `updatedAt`
 *     property with no name, that sets `insert: false`, `update: false` or a `default`) and, beside both, a generated uuid primary
 *     key (`@PrimaryGeneratedColumn("uuid")`). The finding names the base to extend: `UuidAbstractEntity` with the uuid key,
 *     `AbstractEntity` without it.
 *
 * What it leaves alone: a timestamp the application sets (a plain `@Column` with none of those options, such as a `created_at` written
 * from the injected clock) is the "table without them" of the ruling and extends nothing; a class with no `@Entity` (the bases
 * themselves); and the base file `platform/database/abstract.entity.ts`.
 *
 * Judges both editions: TypeORM entities are the persistence of lite and full alike.
 */
import type { TSESTree } from "@typescript-eslint/utils"
import type { RuleModule, Recommended, Rules } from "./lib/rule.ts"

/** The file that declares the bases: the one place these columns are written. */
const BASE_FILE = /[\\/]platform[\\/]database[\\/]abstract\.entity\.ts$/
/** The base entities and the public entry they are imported from. */
const BASE_ENTITY = "AbstractEntity"
const UUID_BASE_ENTITY = "UuidAbstractEntity"
const DATABASE_MODULE = "@modules/platform/database"
/** The shared timestamp columns and the property that maps to each when a decorator names no column. */
const TIMESTAMPS: Readonly<Record<string, string>> = { created_at: "createdAt", updated_at: "updatedAt" }
/** The decorators TypeORM itself fills a timestamp through, and the column each one fills. */
const MANAGED_DATE_COLUMNS: Readonly<Record<string, string>> = { CreateDateColumn: "created_at", UpdateDateColumn: "updated_at" }

type Decorated = TSESTree.PropertyDefinition | TSESTree.ClassDeclaration | TSESTree.ClassExpression

/** The decorator of a node whose name is in `names`, with its call when it is called. */
const decoratorOf = (node: Decorated, names: ReadonlySet<string>): { name: string; call: TSESTree.CallExpression | null } | undefined => {
    for (const decorator of node.decorators) {
        const expression = decorator.expression
        if (expression.type === "Identifier" && names.has(expression.name)) return { name: expression.name, call: null }
        if (expression.type === "CallExpression" && expression.callee.type === "Identifier" && names.has(expression.callee.name)) return { name: expression.callee.name, call: expression }
    }
    return undefined
}

/** One option of a decorator's options object: whether it is written and, when it is a literal, its value. */
const optionOf = (options: TSESTree.Node | undefined, key: string): { present: boolean; value?: unknown } => {
    if (options?.type !== "ObjectExpression") return { present: false }
    for (const property of options.properties) {
        if (property.type !== "Property" || property.computed) continue
        const name = property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? String(property.key.value) : undefined
        if (name !== key) continue
        return property.value.type === "Literal" ? { present: true, value: property.value.value } : { present: true }
    }
    return { present: false }
}

/** The options object of a decorator call: its first object argument. */
const optionsOf = (call: TSESTree.CallExpression | null): TSESTree.Node | undefined => call?.arguments.find((argument) => argument.type === "ObjectExpression")

/** The key of a class property when it is a plain identifier or string. */
const propertyName = (member: TSESTree.PropertyDefinition): string | undefined => {
    if (member.computed) return undefined
    if (member.key.type === "Identifier") return member.key.name
    return member.key.type === "Literal" ? String(member.key.value) : undefined
}

/** The column a decorator maps: its literal `name`, else the column the property `createdAt` / `updatedAt` stands for. */
const columnOf = (member: TSESTree.PropertyDefinition, options: TSESTree.Node | undefined): unknown => {
    const named = optionOf(options, "name")
    if (named.present) return named.value
    return Object.keys(TIMESTAMPS).find((column) => TIMESTAMPS[column] === propertyName(member))
}

/** The shared timestamp column a property maps through a database-set decorator, or undefined. */
const timestampColumnOf = (member: TSESTree.PropertyDefinition): string | undefined => {
    const managed = decoratorOf(member, new Set(Object.keys(MANAGED_DATE_COLUMNS)))
    if (managed) {
        const column = columnOf(member, optionsOf(managed.call))
        return typeof column === "string" && column === MANAGED_DATE_COLUMNS[managed.name] ? column : undefined
    }
    const plain = decoratorOf(member, new Set(["Column"]))
    if (!plain) return undefined
    const options = optionsOf(plain.call)
    const column = columnOf(member, options)
    if (typeof column !== "string" || TIMESTAMPS[column] === undefined) return undefined
    const databaseSet = optionOf(options, "insert").value === false || optionOf(options, "update").value === false || optionOf(options, "default").present
    return databaseSet ? column : undefined
}

/** True when a property is the generated uuid primary key. */
const isGeneratedUuid = (member: TSESTree.PropertyDefinition): boolean => {
    const generated = decoratorOf(member, new Set(["PrimaryGeneratedColumn"]))
    if (!generated) return false
    const [first, second] = generated.call?.arguments ?? []
    const strategy = first?.type === "Literal" ? first.value : optionOf(first, "type").value
    const name = optionOf(second?.type === "ObjectExpression" ? second : first, "name")
    return strategy === "uuid" && (!name.present || name.value === "id")
}

/** An entity inherits the columns every table shares. */
export const entityExtendsBase: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "An @Entity class does not repeat created_at / updated_at (or the generated uuid id beside them); it extends AbstractEntity or UuidAbstractEntity of @modules/platform/database." },
        schema: [],
        messages: {
            timestamp: `\`{{entity}}\` maps \`{{column}}\` itself. Columns every table shares are inherited, never repeated (BE-PERSISTENCE-3, ruling entity-base): extend \`{{base}}\` imported from \`${DATABASE_MODULE}\` and drop this property. A table whose timestamps the application sets, or that lacks one of them, extends nothing and maps its own with a plain \`@Column\`.`,
            key: `\`{{entity}}\` maps the generated uuid \`id\` beside \`created_at\` and \`updated_at\` itself. Columns every table shares are inherited, never repeated (BE-PERSISTENCE-3, ruling entity-base): extend \`${UUID_BASE_ENTITY}\` imported from \`${DATABASE_MODULE}\` and drop the three properties.`,
        },
    },
    create(context) {
        if (BASE_FILE.test(context.filename)) return {}
        const judge = (node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void => {
            if (!decoratorOf(node, new Set(["Entity"]))) return
            const entity = node.id?.name ?? "the entity"
            const properties = node.body.body.filter((member): member is TSESTree.PropertyDefinition => member.type === "PropertyDefinition")
            const timestamps = properties.flatMap((member) => {
                const column = timestampColumnOf(member)
                return column === undefined ? [] : [{ member, column }]
            })
            const both = new Set(timestamps.map((entry) => entry.column)).size === Object.keys(TIMESTAMPS).length
            const keys = both ? properties.filter(isGeneratedUuid) : []
            const base = keys.length > 0 ? UUID_BASE_ENTITY : BASE_ENTITY
            for (const { member, column } of timestamps) context.report({ node: member, messageId: "timestamp", data: { entity, column, base } })
            for (const member of keys) context.report({ node: member, messageId: "key", data: { entity } })
        }
        return { ClassDeclaration: judge, ClassExpression: judge }
    },
}

/** The rules of the entity-base law, by name. */
export const rules = { "entity-extends-base": entityExtendsBase } satisfies Rules
/** On at error; both editions. */
export const recommended: Recommended = { "starci-be/entity-extends-base": "error" }

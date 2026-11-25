/**
 * The schema a `SchemaForm` is drawn from, and the pure helpers over a value of it.
 *
 * The schema is the JSON Schema subset a zod schema emits (`z.toJSONSchema`) or a person writes by hand: `type`, `title`, `description`, `enum` or `oneOf` of `const` and `title`,
 * `format`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `items`, `properties`, `required`, and `default`; a zod `.meta({ ... })` carries the few keys below that
 * JSON Schema has no word for (`placeholder`, `unit`, `itemLabel`, `addLabel`, `accept`). Nothing here reads a zod object: the app converts, so Grammar adds no dependency.
 */

/** The wording of a closed list's option when the schema gives a title to a `const`. */
export type SchemaFormChoice = {
    readonly const: string | number
    readonly title?: string
}

/** One field of the schema, a node of the tree the form walks. */
export type SchemaFormField = {
    /** The kind of value. A node with no `type` and `properties` is an object; one with `enum` or `oneOf` is a choice. */
    readonly type?: "string" | "number" | "integer" | "boolean" | "array" | "object"
    /** The label drawn above the control (the key itself when left out). */
    readonly title?: string
    /** Standing guidance under the control. */
    readonly description?: string
    readonly default?: unknown
    /** A closed list of values: a choice the person picks from. */
    readonly enum?: readonly (string | number)[]
    /** A closed list with a title for each value (the same as `enum` plus the words); wins over `enum`. */
    readonly oneOf?: readonly SchemaFormChoice[]
    /**
     * How a string is entered: `textarea` (several lines), `image` or `file` (an upload slot, never a text box), `email`, `tel` (the matching keyboard and check), or none (one line).
     * An unknown format is a one-line text.
     */
    readonly format?: "textarea" | "image" | "file" | "email" | "tel" | (string & {})
    readonly minimum?: number
    readonly maximum?: number
    readonly minLength?: number
    readonly maxLength?: number
    readonly minItems?: number
    readonly maxItems?: number
    /** What each item of an array is; an object makes the array a list of rows the person adds to, removes and reorders. */
    readonly items?: SchemaFormField
    readonly properties?: Readonly<Record<string, SchemaFormField>>
    /** The keys of `properties` that must be filled before the form is complete. */
    readonly required?: readonly string[]
    /** The hint inside an empty text control. */
    readonly placeholder?: string
    /** The unit written after a number ("seconds"): in the label, so the control stays a bare number. */
    readonly unit?: string
    /** The name of one item of an array, numbered by the form: "Scene" reads "Scene 1", "Scene 2". */
    readonly itemLabel?: string
    /** The words of the button that adds an item of an array ("Add a scene"). */
    readonly addLabel?: string
    /** The file kinds an `image` or `file` field takes, the native `accept` list. */
    readonly accept?: string
}

/** A value of the form: a plain JSON tree the schema describes. */
export type SchemaFormValue = Readonly<Record<string, unknown>>

/** A path to one field: the keys and item indexes from the root, joined by dots ("scenes.1.text"). The root is "". */
export type SchemaFormPath = string

export const joinPath = (parent: SchemaFormPath, key: string | number): SchemaFormPath => (parent === "" ? String(key) : `${parent}.${String(key)}`)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The value at `path` (undefined when nothing is there). */
export const valueAt = (root: unknown, path: SchemaFormPath): unknown => {
    if (path === "") return root
    let current: unknown = root
    for (const key of path.split(".")) {
        if (Array.isArray(current)) current = current[Number(key)]
        else if (isRecord(current)) current = current[key]
        else return undefined
    }
    return current
}

/** A copy of `root` with `next` at `path`; nothing is changed in place. A missing branch is made (an array for a numeric key, else an object). */
export const withValueAt = (root: unknown, path: SchemaFormPath, next: unknown): unknown => {
    if (path === "") return next
    const [head = "", ...rest] = path.split(".")
    const tail = rest.join(".")
    if (Array.isArray(root)) {
        const copy = [...root]
        copy[Number(head)] = withValueAt(copy[Number(head)], tail, next)
        return copy
    }
    const base: Readonly<Record<string, unknown>> = isRecord(root) ? root : {}
    const child = base[head]
    const seeded = child ?? (rest[0] !== undefined && /^\d+$/.test(rest[0]) ? [] : {})
    return { ...base, [head]: withValueAt(seeded, tail, next) }
}

/** The kind a node is drawn as. */
export type SchemaFormKind = "text" | "textarea" | "number" | "boolean" | "choice" | "image" | "file" | "list" | "rows" | "group"

/** The control a node takes (the first row that applies): a closed list is a choice, whatever its `type`. */
export const kindOf = (field: SchemaFormField): SchemaFormKind => {
    if (field.oneOf !== undefined || field.enum !== undefined) return "choice"
    if (field.type === "array") return field.items?.type === "object" || field.items?.properties !== undefined ? "rows" : "list"
    if (field.type === "object" || (field.type === undefined && field.properties !== undefined)) return "group"
    if (field.type === "number" || field.type === "integer") return "number"
    if (field.type === "boolean") return "boolean"
    if (field.format === "image") return "image"
    if (field.format === "file") return "file"
    if (field.format === "textarea") return "textarea"
    return "text"
}

/** Whether a value counts as not filled: no value, a blank string, a number that is not one, or an empty list. A `false` is an answer. */
export const isBlank = (value: unknown): boolean => {
    if (value === undefined || value === null) return true
    if (typeof value === "string") return value.trim() === ""
    if (typeof value === "number") return !Number.isFinite(value)
    if (Array.isArray(value)) return value.length === 0
    return false
}

/**
 * The paths of the required fields that are not filled, in the order the form draws them: what a sticky foot says ("2 places missing") and links to. A required array with items
 * checks each item's required fields too; an optional object is looked into only while it holds something.
 */
export const schemaFormMissing = (schema: SchemaFormField, value: unknown, path: SchemaFormPath = ""): readonly SchemaFormPath[] => {
    const kind = kindOf(schema)
    if (kind === "group") {
        return Object.entries(schema.properties ?? {}).flatMap(([key, child]) => {
            const at = joinPath(path, key)
            const own = valueAt(value, at)
            const required = schema.required?.includes(key) === true
            const here = required && isBlank(own) ? [at] : []
            const kindOfChild = kindOf(child)
            if (kindOfChild === "group" && (required || !isBlank(own))) return [...here, ...schemaFormMissing(child, value, at)]
            return kindOfChild === "rows" ? [...here, ...schemaFormMissing(child, value, at)] : here
        })
    }
    if (kind === "rows") {
        const rows = valueAt(value, path)
        const item = schema.items
        if (item === undefined || !Array.isArray(rows)) return []
        return rows.flatMap((_row, index) => schemaFormMissing(item, value, joinPath(path, index)))
    }
    return []
}

/** The sum of the numbers under `key` in each item of the array at `path` (a missing or non-numeric one counts zero). */
export const sumOf = (value: unknown, path: SchemaFormPath, key: string): number => {
    const rows = valueAt(value, path)
    if (!Array.isArray(rows)) return 0
    return rows.reduce((total: number, row: unknown) => {
        const cell = isRecord(row) ? row[key] : undefined
        return total + (typeof cell === "number" && Number.isFinite(cell) ? cell : 0)
    }, 0)
}

/** A starting value of a node: its `default`, else an empty one of its kind. */
export const emptyOf = (field: SchemaFormField): unknown => {
    if (field.default !== undefined) return field.default
    const kind = kindOf(field)
    if (kind === "group") return Object.fromEntries(Object.entries(field.properties ?? {}).map(([key, child]) => [key, emptyOf(child)]).filter(([, child]) => child !== undefined))
    if (kind === "rows" || kind === "list") return []
    if (kind === "boolean") return false
    return undefined
}

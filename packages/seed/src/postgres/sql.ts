// Every statement the postgres store sends, built from the catalog with quoted identifiers only; a value never enters
// a statement's text, it travels as a parameter. Each statement starts with a seed marker comment so a log line or a
// test double can tell them apart without parsing SQL.

/** One column the copy holds: not generated, not dropped. */
export interface Column {
    readonly name: string
    /** `format_type` of the column, the type its text is cast back to on import. */
    readonly type: string
}

/** One table the copy holds. */
export interface Table {
    readonly schema: string
    readonly table: string
    /** `<schema>.<table>`, the set name. */
    readonly set: string
    readonly columns: readonly Column[]
    /** The primary key columns in key order (each is also one of `columns`). */
    readonly pk: readonly Column[]
}

/** Quotes one identifier. */
export const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`

/** The quoted, schema-qualified name of a table, also the text of a `regclass` parameter. */
export const qualified = (table: Table): string => `${quote(table.schema)}.${quote(table.table)}`

/** The SQL text of the primary key as the entry key: the one column's text, or a JSON array text of several. */
const keyOf = (table: Table): string => {
    const parts = table.pk.map((column) => `t.${quote(column.name)}::text`)
    return table.pk.length === 1 ? parts.join("") : `array_to_json(ARRAY[${parts.join(", ")}])::text`
}

/** The row as one JSON object text of every held column cast to text: numbers, bytes, timestamps and json keep their exact digits. */
const rowOf = (table: Table): string =>
    `(SELECT row_to_json(x)::text FROM (SELECT ${table.columns.map((column) => `t.${quote(column.name)}::text AS ${quote(column.name)}`).join(", ")}) x)`

const byKey = (table: Table): string => table.pk.map((column, at) => `t.${quote(column.name)} = ($${String(at + 1)}::text)::${column.type}`).join(" AND ")

/** Session settings that make text output the same in every session: one zone, one date style, hex bytes, shortest floats. */
export const SESSION = `/* seed:session */ SELECT set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, YMD', true), set_config('IntervalStyle', 'iso_8601', true), set_config('bytea_output', 'hex', true), set_config('extra_float_digits', '1', true), set_config('lc_monetary', 'C', true)`

/** Foreign keys and triggers stay quiet while a copy is restored; needs the owner role. */
export const REPLICA = `/* seed:replica */ SET LOCAL session_replication_role = replica`

/** The ordinary and partitioned-parent tables of the schemas ($1 text[]), each with its held columns and primary key as JSON text. */
export const CATALOG = `/* seed:catalog */ SELECT n.nspname AS schema, c.relname AS "table",
  (SELECT coalesce(json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum), '[]'::json)::text
     FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS columns,
  (SELECT json_agg(a.attname ORDER BY k.ord)::text
     FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY($1::text[])`

/** One page of keys and rows in UTF-8 byte order of the key, after the key in $1 when given. */
export const page = (table: Table, rows: number, after: boolean): string =>
    `/* seed:page */ SELECT ${keyOf(table)} AS k, ${rowOf(table)} AS r FROM ${qualified(table)} t${after ? ` WHERE convert_to(${keyOf(table)}, 'UTF8') > convert_to($1::text, 'UTF8')` : ""} ORDER BY convert_to(${keyOf(table)}, 'UTF8') LIMIT ${String(rows)}`

/** The stored row of the primary key in $1... as the same JSON object text an export writes. */
export const get = (table: Table): string => `/* seed:get */ SELECT ${rowOf(table)} AS r FROM ${qualified(table)} t WHERE ${byKey(table)}`

/** Whether a row of the primary key in $1... exists. */
export const exists = (table: Table): string => `/* seed:exists */ SELECT 1 AS present FROM ${qualified(table)} t WHERE ${byKey(table)}`

/** Deletes the row of the primary key in $1.... */
export const remove = (table: Table): string => `/* seed:delete */ DELETE FROM ${qualified(table)} t WHERE ${byKey(table)}`

/** Every key of the table with each primary key column's text (p0, p1, ...). */
export const keys = (table: Table): string =>
    `/* seed:keys */ SELECT ${keyOf(table)} AS k${table.pk.map((column, at) => `, t.${quote(column.name)}::text AS p${String(at)}`).join("")} FROM ${qualified(table)} t`

/** Upserts the row object in $1 (a JSON text of every held column as text or null) by primary key. */
export const upsert = (table: Table): string => {
    const names = table.columns.map((column) => quote(column.name))
    const changed = table.columns.filter((column) => !table.pk.some((key) => key.name === column.name)).map((column) => `${quote(column.name)} = EXCLUDED.${quote(column.name)}`)
    const casts = table.columns.map((column) => `(x.${quote(column.name)})::${column.type}`)
    return `/* seed:upsert */ INSERT INTO ${qualified(table)} (${names.join(", ")}) OVERRIDING SYSTEM VALUE SELECT ${casts.join(", ")} FROM json_to_record($1::json) AS x(${names.map((name) => `${name} text`).join(", ")}) ON CONFLICT (${table.pk.map((column) => quote(column.name)).join(", ")}) ${changed.length === 0 ? "DO NOTHING" : `DO UPDATE SET ${changed.join(", ")}`}`
}

/** The sequences owned by a column of the table named in $1 (quoted, schema-qualified), each with its quoted name and column. */
export const SEQUENCES = `/* seed:sequences */ SELECT quote_ident(sn.nspname) || '.' || quote_ident(s.relname) AS sequence, a.attname AS "column"
FROM pg_depend d JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S' JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
WHERE d.refclassid = 'pg_class'::regclass AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i') AND d.refobjid = ($1::text)::regclass
ORDER BY 1, 2`

/** Sets the sequence named in $1 to the column's maximum; does nothing when the table is empty. */
export const setval = (table: Table, column: string): string =>
    `/* seed:setval */ SELECT setval(($1::text)::regclass, m) AS value FROM (SELECT max(t.${quote(column)}) AS m FROM ${qualified(table)} t) x WHERE m IS NOT NULL`

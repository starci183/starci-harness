/** R86 SQL proofs exercise each edition's declared schema authority. */
// proves: BE_SQL_TABLE_OWNER@lite
// proves: BE_SQL_TABLE_OWNER@full
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.mjs"
import { rules } from "./project-graph.ts"
import type { TestContext } from "node:test"
import { ruleNamed } from '../fixtures/rule-tester.mjs';

const OWN_SQL = "src/modules/domain/purchase/persistence/purchase.sql.ts"
const FOREIGN_SQL = "src/modules/domain/purchase/persistence/foreign.sql.ts"
const UNBOUNDED_SQL = "src/modules/domain/purchase/persistence/unbounded.sql.ts"
const PREFIXED_SQL = "src/modules/domain/purchase/persistence/lines.sql.ts"
const LINES_ROWS = "src/modules/domain/purchase-lines/persistence/purchase-lines.rows.ts"
const NOTES_SQL = "src/modules/domain/purchase/persistence/notes.sql.ts"
const LOOKALIKE_SQL = "src/modules/domain/purchase/persistence/lookalike.sql.ts"
const FILES = {
    "src/modules/platform/database/index.ts": "export { sql } from './sql';\n",
    "src/modules/platform/database/sql.ts": 'export const sql = (strings: TemplateStringsArray, ...values: unknown[]): string => strings.join("?") + values.length;\n',
    "src/modules/domain/purchase/index.ts": "export const purchase = 1;\n",
    "src/modules/domain/identity/index.ts": "export const identity = 1;\n",
    "src/modules/domain/purchase/persistence/purchase.rows.ts": "export type PurchaseRow = { readonly id: string };\n",
    "src/modules/domain/identity/persistence/identity.rows.ts": "export type IdentityRow = { readonly id: string };\n",
    [OWN_SQL]: "import { sql } from '../../../platform/database';\nexport const READ = sql`SELECT id FROM purchase LIMIT 10`;\nexport const WRITE = sql`UPDATE purchase SET id = $1 WHERE id = $2`;\n",
    [FOREIGN_SQL]: "import { sql } from '../../../platform/database';\nexport const WRITE = sql`UPDATE identity SET id = $1 WHERE id = $2`;\n",
    [PREFIXED_SQL]: "import { sql } from '../../../platform/database';\nexport const WRITE = sql`UPDATE purchase_lines SET id = $1 WHERE id = $2`;\n",
    [NOTES_SQL]: "import { sql } from '../../../platform/database';\nexport const WRITE = sql`UPDATE purchase_notes SET id = $1 WHERE id = $2`;\n",
    [LOOKALIKE_SQL]: "import { sql } from '../../../platform/database';\nexport const WRITE = sql`UPDATE purchases SET id = $1 WHERE id = $2`;\n",
    [UNBOUNDED_SQL]: "import { sql } from '../../../platform/database';\nexport const READ = sql`SELECT id FROM purchase`;\n",
}
/** A capability that owns purchase_lines itself under Supabase schema authority (its persistence folder names the table). */
const LINES_CAPABILITY = {
    "src/modules/domain/purchase-lines/index.ts": "export const purchaseLines = 1;\n",
    [LINES_ROWS]: "export type PurchaseLineRow = { readonly id: string };\n",
}
const ENTITIES = {
    "src/modules/domain/purchase/persistence/entities/purchase.entity.ts": 'import { Entity, PrimaryColumn } from "typeorm"; @Entity("purchase") export class PurchaseEntity { @PrimaryColumn({ type: "uuid" }) id!: string }\n',
    "src/modules/domain/purchase/persistence/entities/purchase-line.entity.ts": 'import { Entity, PrimaryColumn } from "typeorm"; @Entity("purchase_lines") export class PurchaseLineEntity { @PrimaryColumn({ type: "uuid" }) id!: string }',
    "src/modules/domain/purchase/persistence/entities/purchases.entity.ts": 'import { Entity, PrimaryColumn } from "typeorm"; @Entity("purchases") export class PurchasesEntity { @PrimaryColumn({ type: "uuid" }) id!: string }',
    "src/modules/domain/identity/persistence/entities/identity.entity.ts": 'import { Entity, PrimaryColumn } from "typeorm"; @Entity("identity") export class IdentityEntity { @PrimaryColumn({ type: "uuid" }) id!: string }\n',
}
const DATABASE_TYPES = `export type Database = {
    public: {
        Tables: {
            purchase: { Row: { id: string }; Insert: { id: string }; Update: { id?: string }; Relationships: [] }
            identity: { Row: { id: string }; Insert: { id: string }; Update: { id?: string }; Relationships: [] }
            purchase_lines: { Row: { id: string }; Insert: { id: string }; Update: { id?: string }; Relationships: [] }
            purchase_notes: { Row: { id: string }; Insert: { id: string }; Update: { id?: string }; Relationships: [] }
            purchases: { Row: { id: string }; Insert: { id: string }; Update: { id?: string }; Relationships: [] }
        }
    }
}
`

for (const edition of ["lite", "full"] as const) {
    test(`R86 accepts bounded own-table SQL and rejects foreign writes and unbounded reads in ${edition}`, (t) => {
        const files = { ...FILES }
        if (edition === "full") Object.assign(files, ENTITIES)
        else Object.assign(files, LINES_CAPABILITY)
        const fixture = projectFixture({
            edition,
            files,
            rootFiles: { "supabase/types/database.types.ts": DATABASE_TYPES },
        })
        t.after(fixture.cleanup)
        fixture.tester.run("sql-owner", ruleNamed(rules, "sql-owner"), {
            valid: [
                { filename: fixture.at(OWN_SQL), code: FILES[OWN_SQL] },
                // a table named for the capability and an underscore (realtime_events of platform/realtime)
                ...(edition === "full"
                    ? [{ filename: fixture.at(PREFIXED_SQL), code: FILES[PREFIXED_SQL] }]
                    : [{ filename: fixture.at(NOTES_SQL), code: FILES[NOTES_SQL] }]),
            ],
            invalid: [
                { filename: fixture.at(FOREIGN_SQL), code: FILES[FOREIGN_SQL], errors: [{ message: /BE_SQL_TABLE_OWNER/ }] },
                { filename: fixture.at(UNBOUNDED_SQL), code: FILES[UNBOUNDED_SQL], errors: [{ message: /BE_SQL_TABLE_OWNER/ }] },
                // a table named for another capability is that capability's even when it starts with this one's name
                ...(edition === "lite"
                    ? [{ filename: fixture.at(PREFIXED_SQL), code: FILES[PREFIXED_SQL], errors: [{ message: /BE_SQL_TABLE_OWNER/ }] }]
                    : []),
                // under Supabase schema authority a table that merely starts with the capability name is not its own (a full entity makes it so)
                ...(edition === "lite"
                    ? [{ filename: fixture.at(LOOKALIKE_SQL), code: FILES[LOOKALIKE_SQL], errors: [{ message: /BE_SQL_TABLE_OWNER/ }] }]
                    : []),
            ],
        })
    })
}

const KEY_SQL = "src/modules/domain/purchase/persistence/key.sql.ts"
const sqlRead = (text: string) => `import { sql } from '../../../platform/database';\nexport const READ = sql\`${text}\`;\n`
const keyRead = (where: string) => sqlRead(`SELECT id FROM public.purchase WHERE ${where}`)
const COMPOSITE_TABLE = "CREATE TABLE public.purchase (workspace_id uuid NOT NULL, id text NOT NULL, PRIMARY KEY (workspace_id, id));"
const KEY_LOOKUP = "workspace_id = $1 AND id = $2"

/** The key lookups and queries one Supabase key check reads, over its migrations (and an archived migration it must ignore). */
interface SupabaseKeyCase {
    readonly migrations: readonly string[]
    readonly valid?: readonly string[]
    readonly validSql?: readonly string[]
    readonly invalid?: readonly string[]
    readonly invalidSql?: readonly string[]
    readonly archived?: string
}

/** The real Supabase authority: generated table identity plus ordered, tracked migration constraints. */
const checkSupabaseKeys = (t: TestContext, { migrations, valid = [], validSql = [], invalid = [KEY_LOOKUP], invalidSql = [], archived = "" }: SupabaseKeyCase) => {
    const validFiles = Object.fromEntries([
        ...valid.map((where, index): [string, string] => [KEY_SQL.replace("key.sql", `valid-${index}.sql`), keyRead(where)]),
        ...validSql.map((text, index): [string, string] => [KEY_SQL.replace("key.sql", `valid-query-${index}.sql`), sqlRead(text)]),
    ])
    const invalidFiles = Object.fromEntries([
        ...invalid.map((where, index): [string, string] => [KEY_SQL.replace("key.sql", `invalid-${index}.sql`), keyRead(where)]),
        ...invalidSql.map((text, index): [string, string] => [KEY_SQL.replace("key.sql", `invalid-query-${index}.sql`), sqlRead(text)]),
    ])
    const rootFiles = {
        "supabase/types/database.types.ts": DATABASE_TYPES,
        ...Object.fromEntries(migrations.map((sql, index): [string, string] => [`supabase/migrations/20261024000${String(index).padStart(3, "0")}_keys.sql`, sql])),
        ...(archived ? { "supabase/migrations/_archive/20261023000000_keys.sql": archived } : {}),
    }
    const fixture = projectFixture({ edition: "lite", files: { ...FILES, ...validFiles, ...invalidFiles }, rootFiles })
    t.after(fixture.cleanup)
    fixture.tester.run("sql-owner", ruleNamed(rules, "sql-owner"), {
        valid: Object.entries(validFiles).map(([file, code]) => ({ filename: fixture.at(file), code })),
        invalid: Object.entries(invalidFiles).map(([file, code]) => ({ filename: fixture.at(file), code, errors: [{ message: /BE_SQL_TABLE_OWNER/ }] })),
    })
}

test("R86 proves a Supabase composite key lookup and keeps partial-key and OR reads unbounded", (t) => {
    checkSupabaseKeys(t, {
        migrations: [COMPOSITE_TABLE, "ALTER TABLE public.purchase ENABLE ROW LEVEL SECURITY;"],
        valid: [
            KEY_LOOKUP,
            "purchase.workspace_id = $1 AND purchase.id = $2",
            "$1 = workspace_id AND $2 = id",
            '"workspace_id" = $1 AND "id" = $2',
            "workspace_id = $1::uuid AND id = $2::text",
            "workspace_id = CAST($1 AS uuid) AND id = CAST($2 AS text)",
            "CAST($1 AS uuid) = workspace_id AND CAST($2 AS text) = id",
            "workspace_id = CAST(($1) AS pg_catalog.uuid) AND id = ($2)::pg_catalog.text",
        ],
        invalid: [
            "id = $1",
            "workspace_id = $1",
            "workspace_id = $1 AND id = $2 OR id = $3",
            "workspace_id = workspace_id AND id = id",
            "workspace_id = $1 AND id = coalesce(null, id)",
            "workspace_id = $1 AND id = random()",
            "workspace_id = $1 AND id = ANY($2)",
            "workspace_id = $1 AND id = CAST(id AS text)",
            "workspace_id = $1 AND id = CAST(random() AS text)",
            "workspace_id = $1 AND id = $2::private.custom_type",
            "workspace_id = $1 AND id = CAST($2 AS private.custom_type)",
        ],
    })
})

test("R86 does not infer a result bound across row multiplication or unbounded set operations", (t) => {
    checkSupabaseKeys(t, {
        migrations: [COMPOSITE_TABLE],
        invalid: [],
        validSql: [
            "SELECT count(*) FROM public.purchase",
            "SELECT CAST(count(*) AS text) FROM public.purchase",
            "SELECT CAST($1 AS text)",
            "SELECT generate_series(1, 1000) FROM public.purchase LIMIT 10",
        ],
        invalidSql: [
            "SELECT p.id FROM public.purchase p CROSS JOIN public.purchase q WHERE p.workspace_id = $1 AND p.id = $2",
            "SELECT p.id FROM public.purchase p JOIN public.purchase q ON q.workspace_id = p.workspace_id WHERE p.workspace_id = $1 AND p.id = $2",
            "SELECT p.id FROM public.purchase p, public.purchase q WHERE p.workspace_id = $1 AND p.id = $2",
            "SELECT id FROM public.purchase WHERE workspace_id = $1 AND id = $2 UNION ALL SELECT id FROM public.purchase",
            "SELECT count(*) FROM public.purchase UNION ALL SELECT id FROM public.purchase",
            "SELECT generate_series(1, 1000) FROM public.purchase WHERE workspace_id = $1 AND id = $2",
            "SELECT generate_series(1, 1000)",
            "SELECT unnest(array_agg(id)) FROM public.purchase",
            "SELECT generate_series(1, count(*)) FROM public.purchase",
            "SELECT CAST(generate_series(1, 1000) AS text) FROM public.purchase WHERE workspace_id = $1 AND id = $2",
            "SELECT public.count(*) FROM public.purchase",
            "SELECT count(*) FROM public.purchase WHERE workspace_id = $1 AND id = $2 GROUP BY GROUPING SETS ((), ())",
        ],
    })
})

test("R86 bounds a SELECT without FROM and an aggregate-only SELECT by construction, and keeps every multi-row shape unbounded", (t) => {
    checkSupabaseKeys(t, {
        migrations: [COMPOSITE_TABLE],
        invalid: [],
        validSql: [
            "SELECT public.workspace_owner_member($1) AS id",
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            "SELECT gen_random_uuid()::text AS id",
            "SELECT EXISTS (SELECT 1 FROM public.purchase WHERE workspace_id = $1 LIMIT 1) OR EXISTS (SELECT 1 FROM public.purchase WHERE id = $2 LIMIT 1) AS taken",
            "SELECT COALESCE(SUM(id), 0)::float8 AS total FROM public.purchase WHERE workspace_id = $1",
            "SELECT count(*)::int AS total, COALESCE(sum(id), 0)::float8 AS amount FROM public.purchase WHERE workspace_id = $1",
            "SELECT count(*) FILTER (WHERE id IN ('a', 'b'))::int AS a, count(*) FILTER (WHERE id = 'c')::int AS b FROM public.purchase WHERE workspace_id = $1",
            "SELECT coalesce(sum(extract(epoch from (workspace_id - id)) / 60), 0)::int AS minutes FROM public.purchase WHERE workspace_id = $1",
            "SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id) ORDER BY p.id), '[]'::jsonb) AS rows FROM public.purchase p WHERE p.workspace_id = $1",
        ],
        invalidSql: [
            "SELECT unnest($1::text[]) AS id",
            "SELECT generate_series(1, 3) AS n",
            "SELECT public.workspace_owner_member($1), unnest($2::text[])",
            "SELECT 1 UNION ALL SELECT 2",
            "SELECT unnest(array_agg(id)) FROM public.purchase",
            "SELECT id FROM public.purchase WHERE workspace_id = $1",
            "SELECT id, count(*) FROM public.purchase WHERE workspace_id = $1",
            "SELECT workspace_id, count(*) FROM public.purchase GROUP BY workspace_id",
            "SELECT count(*) FROM public.purchase GROUP BY workspace_id",
            "SELECT count(*) OVER () FROM public.purchase",
            "SELECT count(*), public.rows_of(id) FROM public.purchase",
            "SELECT COALESCE(sum(id), 0) FROM public.purchase UNION ALL SELECT id FROM public.purchase",
            "SELECT count(*) FROM public.purchase p, public.purchase q GROUP BY p.id",
            "SELECT unnest(ARRAY[sum(id)]) FROM public.purchase",
        ],
    })
})

test("R86 never applies public key metadata to another schema's table with the same name", (t) => {
    checkSupabaseKeys(t, {
        migrations: ['CREATE SCHEMA private; CREATE TABLE private.purchase (workspace_id uuid, id text); CREATE TABLE public."Purchase" (workspace_id uuid, id text);', COMPOSITE_TABLE],
        valid: [KEY_LOOKUP],
        invalid: [],
        invalidSql: [
            "SELECT id FROM private.purchase WHERE workspace_id = $1 AND id = $2",
            'SELECT id FROM "PUBLIC".purchase WHERE workspace_id = $1 AND id = $2',
            'SELECT id FROM public."Purchase" WHERE workspace_id = $1 AND id = $2',
        ],
    })
})

for (const constraint of ["id text PRIMARY KEY", "id text UNIQUE", "id text, CONSTRAINT identity UNIQUE (id)"]) {
    test(`R86 proves a direct Supabase key constraint: ${constraint}`, (t) => {
        checkSupabaseKeys(t, { migrations: [`CREATE TABLE public.purchase (${constraint});`], valid: ["id = $1"], invalid: [] })
    })
}

test("R86 reads later Supabase ADD CONSTRAINT keys in migration order", (t) => {
    checkSupabaseKeys(t, {
        migrations: [
            "CREATE TABLE public.purchase (workspace_id uuid, id text);",
            "ALTER TABLE public.purchase ADD CONSTRAINT purchase_key UNIQUE (workspace_id, id);",
        ],
        valid: [KEY_LOOKUP],
        invalid: ["id = $1"],
    })
})

test("R86 proves a replacement key after a known table drops its old constraint", (t) => {
    checkSupabaseKeys(t, {
        migrations: [
            COMPOSITE_TABLE,
            "ALTER TABLE public.purchase DROP CONSTRAINT IF EXISTS purchase_pkey; ALTER TABLE public.purchase ADD CONSTRAINT replacement UNIQUE (workspace_id, id);",
        ],
        valid: [KEY_LOOKUP],
        invalid: ["id = $1"],
    })
})

for (const alteration of [
    "ALTER TABLE public.purchase DROP CONSTRAINT purchase_pkey;",
    "ALTER TABLE public.purchase DROP COLUMN workspace_id;",
    "ALTER TABLE public.purchase RENAME COLUMN workspace_id TO tenant_id;",
    "DROP TABLE public.purchase; CREATE TABLE public.purchase (workspace_id uuid, id text);",
    "DO $$ BEGIN ALTER TABLE public.purchase DROP CONSTRAINT purchase_pkey; END $$;",
    "CREATE TABLE private.child (note text) INHERITS (public.purchase);",
    "CREATE FUNCTION public.remove_key() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ALTER TABLE public.purchase DROP CONSTRAINT purchase_pkey; END $$; SELECT public.remove_key();",
]) {
    test(`R86 does not retain stale Supabase uniqueness after ${alteration}`, (t) => {
        checkSupabaseKeys(t, { migrations: [COMPOSITE_TABLE, alteration] })
    })
}

for (const ddl of [
    "CREATE TABLE public.purchase (workspace_id uuid, id text); CREATE UNIQUE INDEX purchase_key ON public.purchase (workspace_id, id) WHERE id <> '';",
    "CREATE TABLE public.purchase (workspace_id uuid, id text); CREATE UNIQUE INDEX purchase_key ON public.purchase (lower(id));",
    "CREATE TABLE public.purchase (workspace_id uuid, id text); DO $$ BEGIN ALTER TABLE public.purchase ADD PRIMARY KEY (workspace_id, id); END $$;",
    "CREATE TABLE IF NOT EXISTS public.purchase (workspace_id uuid, id text, PRIMARY KEY (workspace_id, id));",
    "CREATE TABLE private.purchase (workspace_id uuid, id text, PRIMARY KEY (workspace_id, id));",
    "CREATE TABLE public.purchase (workspace_id uuid, id text, UNIQUE (workspace_id, id) DEFERRABLE);",
    "CREATE SCHEMA private; CREATE TABLE public.purchase (workspace_id uuid, id text); SELECT set_config('search_path', 'private', false); CREATE TABLE purchase (workspace_id uuid, id text, PRIMARY KEY (workspace_id, id));",
    "CREATE TABLE public.purchase (workspace_id uuid, id text); BEGIN; ALTER TABLE public.purchase ADD PRIMARY KEY (workspace_id, id); ROLLBACK;",
]) {
    test(`R86 requires proven unconditional public uniqueness: ${ddl}`, (t) => {
        checkSupabaseKeys(t, { migrations: [ddl] })
    })
}

test("R86 does not use archived Supabase constraints", (t) => {
    checkSupabaseKeys(t, { migrations: ["CREATE TABLE public.purchase (workspace_id uuid, id text);"], archived: COMPOSITE_TABLE })
})

test("R86 keeps a known key when CREATE IF NOT EXISTS leaves its existing table unchanged", (t) => {
    checkSupabaseKeys(t, {
        migrations: [COMPOSITE_TABLE, "CREATE TABLE IF NOT EXISTS public.purchase (workspace_id uuid, id text);"],
        valid: [KEY_LOOKUP],
        invalid: [],
    })
})

const REMOVE_KEY_FUNCTION = "CREATE FUNCTION public.remove_key() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN ALTER TABLE public.purchase DROP CONSTRAINT IF EXISTS purchase_pkey; RETURN 1; END $$;"

for (const executable of [
    "CREATE TABLE public.audit AS SELECT public.remove_key();",
    "CREATE MATERIALIZED VIEW public.audit AS SELECT public.remove_key();",
    "CREATE MATERIALIZED VIEW public.audit AS SELECT public.remove_key() WITH NO DATA; REFRESH MATERIALIZED VIEW public.audit;",
    "COPY (SELECT public.remove_key()) TO STDOUT;",
]) {
    test(`R86 invalidates key facts after executing DDL or COPY: ${executable}`, (t) => {
        checkSupabaseKeys(t, { migrations: [COMPOSITE_TABLE, `${REMOVE_KEY_FUNCTION} ${executable}`] })
    })
}

for (const alteration of [
    "ALTER TABLE public.audit ADD COLUMN effect integer DEFAULT public.remove_key();",
    "ALTER TABLE public.audit ADD CONSTRAINT effect CHECK (public.remove_key() = 1);",
    "ALTER TABLE public.audit VALIDATE CONSTRAINT effect;",
]) {
    test(`R86 invalidates key facts after executing ALTER expressions: ${alteration}`, (t) => {
        const validation = alteration.includes("VALIDATE") ? "ALTER TABLE public.audit ADD CONSTRAINT effect CHECK (public.remove_key() = 1) NOT VALID;" : ""
        checkSupabaseKeys(t, {
            migrations: [
                `CREATE TABLE public.audit (id integer); INSERT INTO public.audit VALUES (1); ${REMOVE_KEY_FUNCTION} ${validation}`,
                COMPOSITE_TABLE,
                alteration,
            ],
        })
    })
}

test("R86 does not trust later key declarations under a declared DDL event trigger", (t) => {
    checkSupabaseKeys(t, {
        migrations: [
            "CREATE FUNCTION public.remove_new_key() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_TAG = 'CREATE TABLE' THEN ALTER TABLE public.purchase DROP CONSTRAINT IF EXISTS purchase_pkey; END IF; END $$; CREATE EVENT TRIGGER key_effect ON ddl_command_end EXECUTE FUNCTION public.remove_new_key();",
            COMPOSITE_TABLE,
        ],
    })
})

/** The engine-owned database objects (hfs.json sides.be.engineOwned): R86 lets only the declared capability touch them, R35 lets only it map them. */
// proves: BE_SQL_TABLE_OWNER@lite
// proves: BE_SCHEMA_OWNER@lite
import fs from "node:fs"
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import type { TestContext } from "node:test"
import type { ProjectFixture } from "../fixtures/project/tester.ts"
import { ruleNamed } from '../fixtures/rule-tester.ts';

const source = (fixture: ProjectFixture, relative: string) => ({ filename: fixture.at(relative), code: fs.readFileSync(fixture.at(relative), "utf8") })
const invalid = (fixture: ProjectFixture, relative: string, message: RegExp) => ({ ...source(fixture, relative), errors: [{ message }] })
const engineOwned = { capability: "entity-engine", tables: ["records", "record_links", "entity_sequences"], partitionsOf: "records", views: "v_*", manifest: ".starciwork/entities.manifest.json" }
const SQL_TAG = "import { sql } from '../../../platform/database';\n"
const ENGINE_SQL = "src/modules/domain/entity-engine/persistence/engine.sql.ts"
const SALES_SQL = "src/modules/domain/sales/persistence/sales.sql.ts"
const SALES_WRITE_SQL = "src/modules/domain/sales/persistence/records-write.sql.ts"
const SALES_PARTITION_SQL = "src/modules/domain/sales/persistence/partition-write.sql.ts"
const SALES_VIEW_SQL = "src/modules/domain/sales/persistence/view-read.sql.ts"
const MIGRATION = [
    "CREATE TABLE public.sales (id uuid PRIMARY KEY);",
    "CREATE TABLE public.records (id uuid NOT NULL, entity text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (entity, id)) PARTITION BY LIST (entity);",
    "CREATE TABLE public.records_order PARTITION OF public.records FOR VALUES IN ('order');",
    "CREATE VIEW public.v_order AS SELECT id FROM public.records_order;",
].join("\n") + "\n"
const FILES = {
    "src/modules/platform/database/index.ts": "export { sql } from './sql';\n",
    "src/modules/platform/database/sql.ts": 'export const sql = (strings: TemplateStringsArray, ...values: unknown[]): string => strings.join("?") + values.length;\n',
    "src/modules/domain/entity-engine/index.ts": "export const engine = 1;\n",
    "src/modules/domain/sales/index.ts": "export const sales = 1;\n",
    [ENGINE_SQL]: `${SQL_TAG}export const A = sql\`INSERT INTO records (id, entity, data) VALUES ($1, $2, $3)\`;\nexport const B = sql\`UPDATE records_order SET data = $1 WHERE id = $2\`;\nexport const C = sql\`SELECT id FROM v_order LIMIT 10\`;\n`,
    [SALES_SQL]: `${SQL_TAG}export const A = sql\`UPDATE sales SET id = $1 WHERE id = $2\`;\n`,
    [SALES_WRITE_SQL]: `${SQL_TAG}export const A = sql\`INSERT INTO records (id, entity, data) VALUES ($1, $2, $3)\`;\n`,
    [SALES_PARTITION_SQL]: `${SQL_TAG}export const A = sql\`DELETE FROM records_order WHERE id = $1\`;\n`,
    [SALES_VIEW_SQL]: `${SQL_TAG}export const A = sql\`SELECT id FROM v_order LIMIT 10\`;\n`,
}

test("R86 lets only the declared engine capability touch engine-owned tables, partitions and views", (t: TestContext) => {
    const fixture = projectFixture({ edition: "lite", files: FILES, rootFiles: { "db/migrations/20261105000000_engine.sql": MIGRATION }, declaration: { engineOwned } })
    t.after(fixture.cleanup)
    fixture.tester.run("sql-owner", ruleNamed(rules, "sql-owner"), {
        valid: [source(fixture, ENGINE_SQL), source(fixture, SALES_SQL)],
        invalid: [
            invalid(fixture, SALES_WRITE_SQL, /BE_SQL_TABLE_OWNER.*writes table records.*entity-engine/),
            invalid(fixture, SALES_PARTITION_SQL, /BE_SQL_TABLE_OWNER.*writes partition records_order/),
            invalid(fixture, SALES_VIEW_SQL, /BE_SQL_TABLE_OWNER.*reads view v_order/),
        ],
    })
})

test("R86 without the declaration refuses the engine capability's own writes to records, partitions and views", (t: TestContext) => {
    const fixture = projectFixture({ edition: "lite", files: FILES, rootFiles: { "db/migrations/20261105000000_engine.sql": MIGRATION } })
    t.after(fixture.cleanup)
    fixture.tester.run("sql-owner", ruleNamed(rules, "sql-owner"), {
        valid: [source(fixture, SALES_SQL)],
        invalid: [{ ...source(fixture, ENGINE_SQL), errors: [{ message: /BE_SQL_TABLE_OWNER.*writes table records/ }, { message: /BE_SQL_TABLE_OWNER.*writes table records_order/ }, { message: /BE_SQL_TABLE_OWNER.*reads table v_order, which no db\/migrations migration creates/ }] }],
    })
})

const liteFiles = (entityTable: string, owner: string) => ({
    "src/modules/platform/database/index.ts": "export { DatabaseModule } from './database.module';\n",
    "src/modules/platform/database/database.module.ts": "import { Module } from '@nestjs/common';\n@Module({})\nexport class DatabaseModule { static register(options: { entities: readonly unknown[] }) { return { module: DatabaseModule, ...options } } }\n",
    [`src/modules/domain/${owner}/index.ts`]: `export { ${owner}Entities } from './persistence/entities/index';\n`,
    [`src/modules/domain/${owner}/persistence/entities/index.ts`]: `import { ThingEntity } from './thing.entity';\nexport const ${owner}Entities = [ThingEntity];\n`,
    [`src/modules/domain/${owner}/persistence/entities/thing.entity.ts`]: `import { Entity, PrimaryColumn } from 'typeorm';\n@Entity('${entityTable}')\nexport class ThingEntity { @PrimaryColumn({ name: 'id', type: 'uuid' }) id!: string }\n`,
    "src/modules/platform/database/entities.ts": `import { ${owner}Entities } from '../../domain/${owner}';\nexport const PRIMARY_ENTITIES = [...${owner}Entities];\n`,
    "src/modules/domain/entity-engine/index.ts": "export const engine = 1;\n",
    "apps/core/src/main.ts": "void 0;\n",
    "apps/cli/src/main.ts": "void 0;\n",
})
const liteRepo = (t: TestContext, entityTable: string, owner: string) => {
    const fixture = projectFixture({
        edition: "lite",
        apps: [{ name: "core", kind: "api" }, { name: "cli", kind: "cli" }],
        declaration: { connections: [{ name: "primary", envPrefix: "PRIMARY", owner: "core", isolation: "database" }], engineOwned },
        files: liteFiles(entityTable, owner),
    })
    t.after(fixture.cleanup)
    return fixture
}
const THING = "src/modules/domain/billing/persistence/entities/thing.entity.ts"

test("R35 refuses another capability's entity over an engine-owned table, partition or view", (t: TestContext) => {
    for (const table of ["records", "records_order", "v_order"]) {
        const fixture = liteRepo(t, table, "billing")
        fixture.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), {
            valid: [],
            invalid: [invalid(fixture, THING, /BE_SCHEMA_OWNER.*entity-engine/)],
        })
    }
})

test("R35 accepts an ordinary entity beside the engine-owned declaration", (t: TestContext) => {
    const fixture = liteRepo(t, "invoices", "billing")
    fixture.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), { valid: [source(fixture, THING)], invalid: [] })
})

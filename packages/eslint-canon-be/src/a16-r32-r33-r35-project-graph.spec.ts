// proves: BE_APP_COMPOSITION_ONLY@lite BE_APP_COMPOSITION_ONLY@full
// proves: BE_APP_BUSINESS_ROLE@lite BE_APP_BUSINESS_ROLE@full
// proves: BE_ENTRYPOINT_ONLY_IN_APPS@lite BE_ENTRYPOINT_ONLY_IN_APPS@full
// proves: BE_SCHEMA_OWNER@lite BE_SCHEMA_OWNER@full
import fs from "node:fs"
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import type { TestContext } from "node:test"
import type { ProjectFixture } from "../fixtures/project/tester.ts"
import { ruleNamed } from '../fixtures/rule-tester.ts';

const repo = (t: TestContext, options: Parameters<typeof projectFixture>[0]) => {
    const fixture = projectFixture(options)
    t.after(fixture.cleanup)
    return fixture
}
const source = (fixture: ProjectFixture, relative: string) => ({ filename: fixture.at(relative), code: fs.readFileSync(fixture.at(relative), "utf8") })
const invalid = (fixture: ProjectFixture, relative: string, line: number, message: RegExp) => ({ ...source(fixture, relative), errors: [{ line, message }] })

const MAIN = "apps/core/src/main.ts"
const APP = "apps/core/src/app.module.ts"
const BOOT = "import { NestFactory } from '@nestjs/core';\nexport const start = (module: unknown) => NestFactory.createApplicationContext(module);\n"
const OWNER = "src/modules/domain/billing"
const ENTITY = "import { Entity, PrimaryColumn } from 'typeorm';\n@Entity('invoices')\nexport class InvoiceEntity { @PrimaryColumn({ name: 'id', type: 'uuid' }) id!: string }\n"
const MIGRATION = "import { MigrationInterface, QueryRunner } from 'typeorm';\nexport class CreateInvoices1789800000000 implements MigrationInterface {\n  name = 'CreateInvoices1789800000000';\n  async up(queryRunner: QueryRunner): Promise<void> { void queryRunner }\n  async down(queryRunner: QueryRunner): Promise<void> { void queryRunner }\n}\n"
const registration = (name: string) => [
    "import { Module } from '@nestjs/common';",
    "import { DatabaseModule } from '../../../src/modules/platform/database';",
    "import { billingEntities, billingMigrations } from '../../../src/modules/domain/billing';",
    "@Module({ imports: [DatabaseModule.register({ connections: [{ name: '" + name + "', entities: billingEntities, migrations: billingMigrations }] })] })",
    "export class AppModule {}",
    "",
].join("\n")
const SCHEMA_FILES = {
    "src/modules/platform/database/index.ts": "export { DatabaseModule } from './database.module';\n",
    "src/modules/platform/database/database.module.ts": "import { Module } from '@nestjs/common';\n@Module({})\nexport class DatabaseModule { static register(options: { connections: { name: string }[] }) { return { module: DatabaseModule, ...options } } }\n",
    [`${OWNER}/index.ts`]: "export { billingEntities, billingMigrations } from './persistence/connection';\n",
    [`${OWNER}/persistence/connection.ts`]: "import { InvoiceEntity } from './entities/invoice.entity';\nimport { CreateInvoices1789800000000 } from './migrations/1789800000000-create-invoices';\nexport const billingEntities = [InvoiceEntity];\nexport const billingMigrations = [CreateInvoices1789800000000];\n",
    [`${OWNER}/persistence/entities/invoice.entity.ts`]: ENTITY,
    [`${OWNER}/persistence/migrations/1789800000000-create-invoices.ts`]: MIGRATION,
    [APP]: registration("primary"),
    "apps/cli/src/main.ts": "void 0;\n",
    "apps/cli/src/app.module.ts": registration("primary"),
}
const schemaRepo = (t: TestContext, edition: "full" | "lite", files: Readonly<Record<string, string>> = {}) => repo(t, {
    edition,
    apps: [{ name: "core", kind: "api" }, { name: "cli", kind: "cli" }],
    declaration: { connections: [{ name: "primary", envPrefix: "PRIMARY", owner: "core", isolation: "database" }] },
    files: { ...SCHEMA_FILES, ...files },
})

for (const edition of ["lite", "full"] as const) {
    test(`R32 accepts app composition and rejects business files in ${edition}`, (t) => {
        const fixture = repo(t, {
            edition,
            files: {
                [APP]: "export class AppModule {}\n",
                "apps/core/src/core.env.ts": "export const env = { port: 3000 };\n",
                "apps/core/src/core.options.ts": "export interface CoreOptions { readonly port: number }\n",
                "apps/core/src/pricing.ts": "export const price = (n: number) => n * 2;\n",
                "apps/core/src/leaky.service.ts": "export class LeakyService { run() { return 1 } }\n",
                "src/modules/domain/pricing/pricing.service.ts": "export class PricingService { run() { return 1 } }\n",
            },
        })
        fixture.tester.run("app-composition-only", ruleNamed(rules, "app-composition-only"), {
            valid: [source(fixture, MAIN), source(fixture, APP), source(fixture, "apps/core/src/core.env.ts"), source(fixture, "apps/core/src/core.options.ts"), source(fixture, "src/modules/domain/pricing/pricing.service.ts")],
            invalid: [
                invalid(fixture, "apps/core/src/pricing.ts", 1, /BE_APP_COMPOSITION_ONLY/),
                invalid(fixture, "apps/core/src/leaky.service.ts", 1, /BE_APP_BUSINESS_ROLE/),
            ],
        })
    })

    test(`R33 accepts app and TestWorld boot and rejects feature entrypoints in ${edition}`, (t) => {
        const fixture = repo(t, {
            edition,
            files: {
                [MAIN]: BOOT,
                "src/tests/world/use-test-world.ts": BOOT,
                "src/features/api/checkout/index.ts": BOOT,
                "src/features/api/checkout/bootstrap.ts": "declare function bootstrap(): Promise<void>;\nvoid bootstrap();\n",
            },
        })
        fixture.tester.run("entrypoint-only-in-apps", ruleNamed(rules, "entrypoint-only-in-apps"), {
            valid: [source(fixture, MAIN), source(fixture, "src/tests/world/use-test-world.ts")],
            invalid: [
                invalid(fixture, "src/features/api/checkout/index.ts", 2, /BE_ENTRYPOINT_ONLY_IN_APPS/),
                invalid(fixture, "src/features/api/checkout/bootstrap.ts", 2, /BE_ENTRYPOINT_ONLY_IN_APPS/),
            ],
        })
    })

    test(`R35 accepts owned schema and rejects misplaced entities and undeclared connections in ${edition}`, (t) => {
        const misplaced = "src/features/api/checkout/application/invoice.entity.ts"
        // lite has no be migration: its owned shape is the entity list that PRIMARY_ENTITIES names (BE-PERSISTENCE-3)
        const correct = edition === "full" ? schemaRepo(t, edition, { [misplaced]: ENTITY }) : liteRepo(t, LITE_NAMED, { [misplaced]: ENTITY })
        const unknown = schemaRepo(t, edition, { [APP]: registration("ledger"), "apps/cli/src/app.module.ts": registration("ledger") })
        correct.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), {
            valid: edition === "full"
                ? [source(correct, APP), source(correct, `${OWNER}/index.ts`), source(correct, `${OWNER}/persistence/connection.ts`), source(correct, `${OWNER}/persistence/entities/invoice.entity.ts`), source(correct, `${OWNER}/persistence/migrations/1789800000000-create-invoices.ts`)]
                : [source(correct, LITE_LIST), source(correct, `${OWNER}/index.ts`), source(correct, `${OWNER}/persistence/entities/index.ts`), source(correct, `${OWNER}/persistence/entities/invoice.entity.ts`)],
            invalid: [
                invalid(correct, misplaced, 3, /BE_SCHEMA_OWNER.*Entity InvoiceEntity is declared outside/),
            ],
        })
        unknown.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), {
            valid: [source(unknown, `${OWNER}/persistence/entities/invoice.entity.ts`)],
            invalid: [
                invalid(unknown, "apps/cli/src/app.module.ts", 4, /BE_SCHEMA_OWNER.*which hfs\.json does not declare/),
            ],
        })
    })
}

/** The lite shape (BE-PERSISTENCE-3): entities and their list, no be migration, PRIMARY_ENTITIES the one registered list. */
const LITE_SCHEMA_FILES = {
    "src/modules/platform/database/index.ts": "export { DatabaseModule } from './database.module';\n",
    "src/modules/platform/database/database.module.ts": "import { Module } from '@nestjs/common';\n@Module({})\nexport class DatabaseModule { static register(options: { entities: readonly unknown[] }) { return { module: DatabaseModule, ...options } } }\n",
    [`${OWNER}/index.ts`]: "export { billingEntities } from './persistence/entities/index';\n",
    [`${OWNER}/persistence/entities/index.ts`]: "import { InvoiceEntity } from './invoice.entity';\nexport const billingEntities = [InvoiceEntity];\n",
    [`${OWNER}/persistence/entities/invoice.entity.ts`]: ENTITY,
    "apps/core/src/main.ts": "void 0;\n",
    "apps/cli/src/main.ts": "void 0;\n",
}
const LITE_LIST = "src/modules/platform/database/entities.ts"
const LITE_NAMED = "import { billingEntities } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billingEntities];\n"
const liteRepo = (t: TestContext, list: string, files: Readonly<Record<string, string>> = {}) => repo(t, {
    edition: "lite",
    apps: [{ name: "core", kind: "api" }, { name: "cli", kind: "cli" }],
    declaration: { connections: [{ name: "primary", envPrefix: "PRIMARY", owner: "core", isolation: "database" }] },
    files: { ...LITE_SCHEMA_FILES, [LITE_LIST]: list, ...files },
})

test("R35 lite: a capability's entity list is persistence/entities/index.ts and PRIMARY_ENTITIES names it", (t) => {
    const named = liteRepo(t, LITE_NAMED)
    const missing = liteRepo(t, "export const PRIMARY_ENTITIES = [];\n")
    named.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), {
        valid: [source(named, LITE_LIST), source(named, `${OWNER}/index.ts`), source(named, `${OWNER}/persistence/entities/index.ts`), source(named, `${OWNER}/persistence/entities/invoice.entity.ts`)],
        invalid: [],
    })
    missing.tester.run("schema-owner", ruleNamed(rules, "schema-owner"), {
        valid: [source(missing, `${OWNER}/persistence/entities/index.ts`)],
        invalid: [invalid(missing, LITE_LIST, 1, /BE_SCHEMA_OWNER.*does not name billingEntities in PRIMARY_ENTITIES/)],
    })
})

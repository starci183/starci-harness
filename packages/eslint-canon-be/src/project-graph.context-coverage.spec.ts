// proves: BE_CONTEXT_OWNER@lite
// proves: BE_CONTEXT_OWNER@full
// proves: BE_CONTEXT_COUPLING@lite
// proves: BE_CONTEXT_COUPLING@full
// proves: BE_CONTEXT_TRANSACTION@lite
// proves: BE_CONTEXT_TRANSACTION@full
// proves: BE_CONTEXT_PLATFORM_TABLES@lite
// proves: BE_CONTEXT_PLATFORM_TABLES@full
import test from "node:test"
import { projectFixture } from "../fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import type { TestContext } from "node:test"
import type { SideDeclaration } from "../fixtures/app.ts"
import { ruleNamed } from '../fixtures/rule-tester.ts';

// R174, R175, R176 and R178 share three contexts: identity, order (with cart), and billing.
// A connection is a context; a capability belongs to the connection its persistence arrays are registered on.
const DATABASE = "src/modules/platform/database"
const DOMAIN = "src/modules/domain"
const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
/** The text of a fixture file the spec wrote (a spec naming a file it did not write fails here, as the tester would). */
const textAt = (files: Readonly<Record<string, string>>, rel: string) => {
    const text = files[rel]
    if (text === undefined) throw new Error(`no fixture file ${rel}`)
    return text
}

const databaseFiles = {
    [`${DATABASE}/index.ts`]: "export { sql } from './sql';\nexport { DatabaseModule } from './database.module';\n",
    [`${DATABASE}/sql.ts`]: 'export const sql = (strings: TemplateStringsArray, ...values: unknown[]): string => strings.join("?") + values.length;\n',
    [`${DATABASE}/database.module.ts`]: "import { Module } from '@nestjs/common';\n@Module({})\nexport class DatabaseModule {\n  static register(options: { connections: { name: string }[] }) { return { module: DatabaseModule, ...options }; }\n}\n",
    [`${DATABASE}/manager.ts`]: "export declare class EntityManager { transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T>; save(entity: unknown): Promise<void> }\n",
}
const connectionFiles = (name: string, prefix: string) => ({
    [`${DATABASE}/${name}.connection.ts`]: `export const ${prefix}_CONNECTION = "${name}";\n`,
    [`${DATABASE}/${name}.decorators.ts`]: `import { getEntityManagerToken } from '@nestjs/typeorm';\nimport { ${prefix}_CONNECTION } from './${name}.connection';\ndeclare function injector(token: unknown): unknown;\nexport const Inject${pascal(name)}EntityManager = () => injector(getEntityManagerToken(${prefix}_CONNECTION));\n`,
    [`${DATABASE}/${name}.config.ts`]: `export const ${name}Config = () => ({ host: process.env.${prefix}_HOST, port: process.env.${prefix}_PORT, name: process.env.${prefix}_NAME });\n`,
})
const entity = (klass: string, table: string) => `import { Column, Entity, PrimaryColumn } from 'typeorm';\n@Entity("${table}")\nexport class ${klass} {\n  @PrimaryColumn({ name: 'id', type: 'uuid' }) id!: string;\n}\n`
const migration = (klass: string, sqlText: string) => `import { MigrationInterface, QueryRunner } from 'typeorm';\nexport class ${klass} implements MigrationInterface {\n  name = "${klass}";\n  async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(\`${sqlText}\`); }\n  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('SELECT 1'); }\n}\n`
/** A capability with one entity, its migration and the arrays of persistence/connection.ts, exported from its index. */
const capability = (tier: string, name: string, table: string, extraIndex = "", migrationSql = "SELECT 1") => {
    const root = `src/modules/${tier}/${name}`
    const camel = name.replace(/-(.)/g, (_, c) => c.toUpperCase())
    const klass = `${pascal(camel)}Entity`
    const migrationClass = `Create${pascal(camel)}1790000000000`
    return {
        [`${root}/index.ts`]: `export { ${camel}Entities, ${camel}Migrations } from './persistence/connection';\n${extraIndex}`,
        [`${root}/persistence/connection.ts`]: `import { ${klass} } from './entities/${name}.entity';\nimport { ${migrationClass} } from './migrations/1790000000000-create-${name}';\nexport const ${camel}Entities = [${klass}];\nexport const ${camel}Migrations = [${migrationClass}];\n`,
        [`${root}/persistence/entities/${name}.entity.ts`]: entity(klass, table),
        [`${root}/persistence/migrations/1790000000000-create-${name}.ts`]: migration(migrationClass, migrationSql),
    }
}
const IDENTITY_INDEX = "export class IdentityService { lookup(): string { return 'user'; } }\n"
const BILLING_INDEX = "export class BillingService { charge(): string { return 'invoice'; } }\n"
const CART_INDEX = "export class CartService { total(): number { return 1; } }\n"
/** The imports an entry needs: the connection constant and the arrays of every capability it lists. */
const IMPORTS = {
    IDENTITY_CONNECTION: "import { IDENTITY_CONNECTION } from '../../../src/modules/platform/database/identity.connection';\nimport { identityEntities, identityMigrations } from '../../../src/modules/domain/identity';\n",
    ORDER_CONNECTION: "import { ORDER_CONNECTION } from '../../../src/modules/platform/database/order.connection';\nimport { orderEntities, orderMigrations } from '../../../src/modules/domain/order';\nimport { cartEntities, cartMigrations } from '../../../src/modules/domain/cart';\n",
    BILLING_CONNECTION: "import { BILLING_CONNECTION } from '../../../src/modules/platform/database/billing.connection';\nimport { billingEntities, billingMigrations } from '../../../src/modules/domain/billing';\n",
}
const registration = (entry: readonly string[]) => `import { Module } from '@nestjs/common';\nimport { DatabaseModule } from '../../../src/modules/platform/database';\n${Object.entries(IMPORTS).filter(([name]) => entry.some((text: string) => text.includes(name))).map(([, text]) => text).join("")}@Module({ imports: [DatabaseModule.register({ connections: [${entry.join(", ")}] })] })\nexport class AppModule {}\n`
const IDENTITY_ENTRY = "{ name: IDENTITY_CONNECTION, entities: identityEntities, migrations: identityMigrations }"
const ORDER_ENTRY = "{ name: ORDER_CONNECTION, entities: [...orderEntities, ...cartEntities], migrations: [...orderMigrations, ...cartMigrations] }"
const BILLING_ENTRY = "{ name: BILLING_CONNECTION, entities: billingEntities, migrations: billingMigrations }"

const BASE = {
    ...databaseFiles,
    ...connectionFiles("identity", "IDENTITY"),
    ...connectionFiles("order", "ORDER"),
    ...connectionFiles("billing", "BILLING"),
    ...capability("domain", "identity", "users", IDENTITY_INDEX),
    ...capability("domain", "order", "orders"),
    ...capability("domain", "cart", "carts", CART_INDEX),
    ...capability("domain", "billing", "invoices", BILLING_INDEX),
    "apps/identity/src/app.module.ts": registration([IDENTITY_ENTRY]),
    "apps/order/src/app.module.ts": registration([ORDER_ENTRY]),
    "apps/billing/src/app.module.ts": registration([BILLING_ENTRY]),
    "apps/cli/src/app.module.ts": registration([IDENTITY_ENTRY, ORDER_ENTRY, BILLING_ENTRY]),
}
const CONNECTIONS = [
    { name: "identity", envPrefix: "IDENTITY", owner: "identity", isolation: "database" },
    { name: "order", envPrefix: "ORDER", owner: "order", isolation: "schema" },
    { name: "billing", envPrefix: "BILLING", owner: "billing", isolation: "schema" },
]
const APPS = [{ name: "identity", kind: "api" }, { name: "order", kind: "api" }, { name: "billing", kind: "api" }, { name: "cli", kind: "cli" }]
const repo = (t: TestContext, edition: "full" | "lite", files: Readonly<Record<string, string>> = {}, options: { readonly connections?: SideDeclaration["connections"]; readonly apps?: readonly { readonly name: string; readonly kind: string }[] } = {}) => {
    const f = projectFixture({ edition, files: { ...BASE, ...files }, declaration: { connections: options.connections ?? CONNECTIONS }, apps: options.apps ?? APPS })
    t.after(f.cleanup)
    return f
}

const MANAGER = "import type { EntityManager } from '../../platform/database/manager';\n"
const service = (body: string) => [
    "import { InjectOrderEntityManager } from '../../platform/database/order.decorators';",
    "import { InjectBillingEntityManager } from '../../platform/database/billing.decorators';",
    MANAGER,
    'export class OrderService {',
    '  constructor(',
    '    @InjectOrderEntityManager() private readonly entityManager: EntityManager,',
    '    @InjectBillingEntityManager() private readonly billingManager: EntityManager,',
    '  ) {}',
    body,
    '}',
].join('\n')
const busFiles = capability('platform', 'event-bus', 'event_outbox',
    'export class EventBus { publish(event: unknown, manager: unknown): void { void event; void manager; } }\n')
const BUS_ORDER_ENTRY = '{ name: ORDER_CONNECTION, entities: [...orderEntities, ...cartEntities, ...eventBusEntities], migrations: [...orderMigrations, ...cartMigrations, ...eventBusMigrations] }'
const withBus = (entries: readonly string[]) => registration(entries).replace('@Module(', "import { eventBusEntities, eventBusMigrations } from '../../../src/modules/platform/event-bus';\n@Module(")
const publisher = (prefix: string) => [
    "import { Inject" + prefix + "EntityManager } from '../../platform/database/" + prefix.toLowerCase() + ".decorators';",
    "import { EventBus } from '../../platform/event-bus';",
    MANAGER,
    'export class Publisher {',
    '  constructor(@Inject' + prefix + 'EntityManager() private readonly entityManager: EntityManager, private readonly bus: EventBus) {}',
    "  async publish() { await this.entityManager.transaction(async (manager) => { this.bus.publish('order.placed', manager); }); }",
    '}',
].join('\n')

for (const edition of ['lite', 'full'] as const) {
    test(edition + ' context-owner accepts owned composition and rejects a foreign context', (t) => {
        const files = { 'apps/order/src/app.module.ts': registration([ORDER_ENTRY, BILLING_ENTRY]) }
        const f = repo(t, edition, files)
        f.tester.run('context-owner', ruleNamed(rules, 'context-owner'), {
            valid: [{ filename: f.at('apps/identity/src/app.module.ts'), code: BASE['apps/identity/src/app.module.ts'] }],
            invalid: [{
                filename: f.at('apps/order/src/app.module.ts'),
                code: files['apps/order/src/app.module.ts'],
                errors: [
                    { message: /App order imports src.modules.domain.billing, a capability of context billing owned by app billing/ },
                    { message: /App order composes connection billing, the context owned by app billing/ },
                ],
            }],
        })
    })

    test(edition + ' context-coupling accepts a same-context import and rejects a foreign context', (t) => {
        const files = {
            [DOMAIN + '/order/clean.service.ts']: "import { CartService } from '../cart';\nexport const local = CartService;\n",
            [DOMAIN + '/order/foreign.service.ts']: "import { IdentityService } from '../identity';\nexport const foreign = IdentityService;\n",
        }
        const f = repo(t, edition, files)
        f.tester.run('context-coupling', ruleNamed(rules, 'context-coupling'), {
            valid: [{ filename: f.at(DOMAIN + '/order/clean.service.ts'), code: textAt(files, DOMAIN + '/order/clean.service.ts') }],
            invalid: [{
                filename: f.at(DOMAIN + '/order/foreign.service.ts'),
                code: textAt(files, DOMAIN + '/order/foreign.service.ts'),
                errors: [{ message: /imports src.modules.domain.identity .context identity./ }],
            }],
        })
    })

    test(edition + ' context-transaction accepts one manager and rejects a second connection', (t) => {
        const files = {
            [DOMAIN + '/order/clean.service.ts']: service('  async place() { await this.entityManager.transaction(async (manager) => { await manager.save(1); }); }'),
            [DOMAIN + '/order/foreign.service.ts']: service('  async place() { await this.entityManager.transaction(async (manager) => { await manager.save(1); await this.billingManager.save(2); }); }'),
        }
        const f = repo(t, edition, files)
        f.tester.run('context-transaction', ruleNamed(rules, 'context-transaction'), {
            valid: [{ filename: f.at(DOMAIN + '/order/clean.service.ts'), code: textAt(files, DOMAIN + '/order/clean.service.ts') }],
            invalid: [{
                filename: f.at(DOMAIN + '/order/foreign.service.ts'),
                code: textAt(files, DOMAIN + '/order/foreign.service.ts'),
                errors: [{ message: /uses the entity manager of connection billing/ }],
            }],
        })
    })

    test(edition + ' context-platform-tables accepts registered tables and rejects a missing registration', (t) => {
        const files = {
            ...busFiles,
            'apps/order/src/app.module.ts': withBus([BUS_ORDER_ENTRY]),
            'apps/cli/src/app.module.ts': withBus([IDENTITY_ENTRY, BUS_ORDER_ENTRY, BILLING_ENTRY]),
            [DOMAIN + '/order/publisher.service.ts']: publisher('Order'),
            [DOMAIN + '/billing/publisher.service.ts']: publisher('Billing'),
        }
        const f = repo(t, edition, files)
        f.tester.run('context-platform-tables', ruleNamed(rules, 'context-platform-tables'), {
            valid: [{ filename: f.at(DOMAIN + '/order/publisher.service.ts'), code: textAt(files, DOMAIN + '/order/publisher.service.ts') }],
            invalid: [{
                filename: f.at(DOMAIN + '/billing/publisher.service.ts'),
                code: textAt(files, DOMAIN + '/billing/publisher.service.ts'),
                errors: [{ message: /passes the entity manager of connection billing to event-bus, but the tables of event-bus are not registered on billing/ }],
            }],
        })
    })
}

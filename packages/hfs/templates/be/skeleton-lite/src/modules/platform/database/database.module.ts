import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { TypeOrmModule, getDataSourceToken } from "@nestjs/typeorm"
import type { DataSource } from "typeorm"
import { DatabaseProbeService } from "./database-probe.service"
import { DATABASE_OPTIONS } from "./database.port"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./database.module-definition"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"
import { PRIMARY_CONNECTION } from "./primary.connection"
import { DATABASE_PROBE, PRIMARY_ENTITY_MANAGER } from "./primary.decorators"

/** The `schema` option of a connection, left out when the connection names none. */
const schemaOption = (schema: string | undefined): Partial<Record<"schema", string>> =>
    schema === undefined ? {} : { schema }

/** The token each declared connection provides its shared EntityManager under. */
type EntityManagerToken = typeof PRIMARY_ENTITY_MANAGER

const ENTITY_MANAGER_TOKENS: ReadonlyMap<string, EntityManagerToken> = new Map<string, EntityManagerToken>([
    [PRIMARY_CONNECTION, PRIMARY_ENTITY_MANAGER],
])

/**
 * How long a connection waits for its database at boot: 10 attempts 3 s apart (about 30 s), so an app that starts beside the db
 * service of its stack outlives the database's own start instead of exiting and rolling the release back.
 */
const CONNECT_RETRY = { retryAttempts: 10, retryDelay: 3000 } as const

@Module({})
/** Opens each named PostgreSQL connection with the entities the composition root hands it, and exposes its shared EntityManager; no migrations. */
export class DatabaseModule extends ConfigurableModuleClass {
    /** Registers the capability once per app with the connections it opens. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const managers = options.connections.map((connection) => {
            const token = ENTITY_MANAGER_TOKENS.get(connection.name)
            if (token === undefined) {
                throw new DatabaseError({
                    code: DatabaseErrorCode.ConnectionUndeclared,
                    params: { name: connection.name },
                })
            }
            return {
                provide: token,
                inject: [getDataSourceToken(connection.name)],
                useFactory: (source: DataSource) => source.manager,
            }
        })
        const probes = options.connections.some((connection) => connection.name === PRIMARY_CONNECTION)
            ? [{ provide: DATABASE_PROBE, useClass: DatabaseProbeService }]
            : []
        return {
            ...base,
            imports: [
                ...(base.imports ?? []),
                ...options.connections.map((connection) =>
                    TypeOrmModule.forRoot({
                        name: connection.name,
                        type: "postgres",
                        url: connection.url.reveal(),
                        ...schemaOption(connection.schema),
                        entities: [...options.entities],
                        synchronize: false,
                        ...CONNECT_RETRY,
                    }),
                ),
            ],
            providers: [...(base.providers ?? []), ...managers, ...probes],
            exports: [
                DATABASE_OPTIONS,
                ...probes.map((probe) => probe.provide),
                ...managers.map((manager) => manager.provide),
            ],
        }
    }
}

import { getDataSourceToken } from "@nestjs/typeorm"
import { Secret } from "@modules/platform/config"
import { PRIMARY_CONNECTION } from "@modules/platform/database"

/** What a wiring proof hands the compiled root: public options and the infrastructure doubles. */
export interface WiringProof {
    readonly options: Readonly<Record<string, unknown>>
    readonly overrides: ReadonlyArray<{ readonly token: unknown; readonly value: unknown }>
}

/** Public fixture options and the database double for compiling the real CLI AppModule without network access. */
export const buildWiringProof = (): WiringProof => ({
    options: {
        connections: [{
            name: PRIMARY_CONNECTION,
            provider: "postgres",
            url: new Secret("postgresql://app_be@127.0.0.1:5432/postgres"),
            schema: "public",
        }],
    },
    overrides: [{ token: getDataSourceToken(PRIMARY_CONNECTION), value: { manager: {} } }],
})

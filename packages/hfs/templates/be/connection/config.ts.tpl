import type { EnvSource } from "@modules/platform/config"
import type { DatabaseConnectionConfig } from "./database.options"
import { @@NAME@@_CONNECTION } from "./@@name@@.connection"

/** Reads the @@name@@ connection from the `@@PREFIX@@_*` keys. */
export const parse@@Pascal@@DatabaseConfig = (env: EnvSource): DatabaseConnectionConfig => ({
    name: @@NAME@@_CONNECTION,
    url: env.secret("@@PREFIX@@_URL"),
})

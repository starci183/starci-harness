import type { EnvSource } from "@modules/platform/config"
import { REDIS_DEFAULT_PREFIX } from "./realtime.contracts"
import type { PostgresRealtimeConfig, RealtimeConfig, RedisRealtimeOptions } from "./realtime.options"

/** The hubs an app can run. */
const HUBS = ["memory", "postgres", "redis"] as const

/** The Redis hub: its URL (a secret), database and the prefix of its channel and keys. */
const redisConfigOf = (env: EnvSource): RedisRealtimeOptions => ({
    hub: "redis",
    url: env.secret("REALTIME_REDIS_URL"),
    db: env.int("REALTIME_REDIS_DB", 0),
    prefix: env.optional("REALTIME_REDIS_PREFIX") ?? REDIS_DEFAULT_PREFIX,
})

/** The Postgres hub: the dedicated LISTEN URL when `REALTIME_DB_URL` is declared. */
const postgresConfigOf = (env: EnvSource): PostgresRealtimeConfig => ({
    hub: "postgres",
    listenUrl: env.has("REALTIME_DB_URL") ? env.secret("REALTIME_DB_URL") : undefined,
})

/**
 * Reads the hub from `REALTIME_HUB`; when it is not declared the full edition defaults to `redis` (the in-process `memory` hub is
 * never a default, so a scaled deploy cannot fall back to it unseen). For the Redis hub it reads the address and prefix. A Postgres
 * hub LISTENs on `REALTIME_DB_URL` when it is declared (a direct or session-mode URL, never a transaction pooler), else on the
 * primary database URL; either way the boot probe refuses a connection that does not deliver notifications.
 */
export const parseRealtimeConfig = (env: EnvSource): RealtimeConfig => {
    const hub = env.has("REALTIME_HUB") ? env.enum("REALTIME_HUB", HUBS) : "redis"
    if (hub === "redis") return redisConfigOf(env)
    return hub === "postgres" ? postgresConfigOf(env) : { hub }
}

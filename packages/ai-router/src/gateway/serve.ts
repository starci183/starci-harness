import { createRouter } from "../router.ts"
import type { FetchLike } from "../types.ts"
import { loadGatewayConfig, readSecret } from "./config-file.ts"
import type { KeyStoreConfig } from "./config-file.ts"
import { createGateway } from "./gateway.ts"
import type { AiRouterGateway } from "./gateway.ts"
import { MemoryKeyStore } from "./keys.ts"
import type { KeyStore } from "./keys.ts"
import { openSqliteKeyStore } from "./sqlite-key-store.ts"

/** Opens the key store a config file names. */
export async function openKeyStore(config: KeyStoreConfig): Promise<KeyStore> {
    return config.type === "sqlite" ? openSqliteKeyStore(config.path) : new MemoryKeyStore()
}

/** What `serveGateway` takes: the config file, and overrides of its address (and, for tests, of `fetch`). */
export interface ServeOptions {
    readonly config: string
    readonly port?: number
    readonly host?: string
    readonly fetch?: FetchLike
    /** Where secret references are read from. Default `process.env`. */
    readonly env?: NodeJS.ProcessEnv
    readonly onError?: (error: unknown) => void
}

/** A running gateway process: the gateway, where it listens, and how to stop it. */
export interface ServingGateway {
    readonly gateway: AiRouterGateway
    readonly url: string
    /** Stops listening and closes the key store. */
    close(): Promise<void>
}

/** Loads a config file, builds the router and the key store, and listens: the whole `ai-router serve`. */
export async function serveGateway(options: ServeOptions): Promise<ServingGateway> {
    const file = await loadGatewayConfig(options.config)
    const router = createRouter(options.fetch === undefined ? file.pool : { ...file.pool, fetch: options.fetch })
    const keys = await openKeyStore(file.gateway.keyStore)
    const admin = file.gateway.adminToken
    const gateway = createGateway(router, {
        keys,
        maxBodyBytes: file.gateway.maxBodyBytes,
        ...(admin === null ? {} : { adminToken: () => readSecret(admin, options.env) }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
    })
    try {
        const address = await gateway.listen(options.port ?? file.gateway.port, options.host ?? file.gateway.host)
        return {
            gateway,
            url: address.url,
            async close() {
                await gateway.close()
                await keys.close?.()
            },
        }
    } catch (error) {
        await gateway.close()
        await keys.close?.()
        throw error
    }
}

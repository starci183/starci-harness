import type { AddressInfo } from "node:net"
import { AiRouterError } from "./errors.ts"

/** The offset from the app's port the gateway listens at when none is given: the API on 3001 serves its gateway on 3002. */
export const DEFAULT_GATEWAY_PORT_OFFSET = 1

/** Where the gateway listens: an explicit port, or a port derived from the app's own (`true`: offset 1 on 127.0.0.1). */
export type AiRouterGatewayListen =
    | true
    | { readonly port: number; readonly host?: string; readonly offset?: never }
    | { readonly offset?: number; readonly host?: string; readonly port?: never }

/** The HTTP server of the Nest application, as far as the gateway needs it. */
export interface AppServer {
    readonly listening: boolean
    address(): AddressInfo | string | null
    once(event: "listening", listener: () => void): unknown
    off(event: "listening", listener: () => void): unknown
}

function failure(message: string): AiRouterError {
    return new AiRouterError({ errorClass: "config", message })
}

/** The port a listen setting means for an app on `appPort`, or the explicit port; refuses an unusable one. */
export function gatewayPort(listen: AiRouterGatewayListen, appPort: number | undefined): number {
    if (listen !== true && listen.port !== undefined) return listen.port
    const offset = listen === true ? DEFAULT_GATEWAY_PORT_OFFSET : (listen.offset ?? DEFAULT_GATEWAY_PORT_OFFSET)
    if (!Number.isInteger(offset) || offset < 1) throw failure("AiRouterGatewayModule listen.offset must be an integer of 1 or more")
    if (appPort === undefined) throw failure("AiRouterGatewayModule listen derives the gateway port from the app's port, but the app has no known port: listen with the application first, or set listen.port")
    const port = appPort + offset
    if (port > 65535) throw failure(`AiRouterGatewayModule listen: app port ${String(appPort)} + offset ${String(offset)} is not a port number`)
    return port
}

/** The host of a listen setting: `undefined` (the gateway's 127.0.0.1) unless given. */
export function gatewayHost(listen: AiRouterGatewayListen): string | undefined {
    return listen === true ? undefined : listen.host
}

/** The port the application's HTTP server is bound to, or `undefined` when it is not bound to a TCP port. */
function boundPort(server: AppServer): number | undefined {
    const address = server.address()
    return typeof address === "object" && address !== null ? address.port : undefined
}

/** The app's port from the `PORT` environment variable, when it is a port number. */
function envPort(env: NodeJS.ProcessEnv): number | undefined {
    const value = env.PORT
    if (value === undefined || !/^\d+$/.test(value)) return undefined
    const port = Number(value)
    return port <= 65535 ? port : undefined
}

/**
 * Calls `start(port)` once the app's port is known: at once when the server is bound, when it emits `listening` when
 * it is not yet (Nest bootstraps before `app.listen` binds), or from `PORT` when the app has no HTTP server. Returns
 * a function that cancels a wait still pending. It throws when no port can be known.
 */
export function whenAppPort(server: AppServer | undefined, env: NodeJS.ProcessEnv, start: (port: number) => void): () => void {
    if (server === undefined) {
        const port = envPort(env)
        if (port === undefined) throw failure("AiRouterGatewayModule listen derives the gateway port from the app's port, but the application has no HTTP server and PORT is not set: set listen.port")
        start(port)
        return () => undefined
    }
    if (server.listening) {
        const port = boundPort(server)
        if (port === undefined) throw failure("AiRouterGatewayModule listen derives the gateway port from the app's port, but the application's server is not on a TCP port: set listen.port")
        start(port)
        return () => undefined
    }
    const onListening = (): void => {
        const port = boundPort(server)
        if (port !== undefined) start(port)
    }
    server.once("listening", onListening)
    return () => {
        server.off("listening", onListening)
    }
}

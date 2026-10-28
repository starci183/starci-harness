import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { AiRouterGatewayListen } from "./ai-router-gateway.listen.ts"
import type { GatewayOptions } from "./gateway/gateway.ts"

/** What the gateway module takes: the gateway's options, and where it listens. */
export interface AiRouterGatewayModuleOptions extends GatewayOptions {
    /**
     * Listens on its own port and stops at shutdown; absent, mount `gateway.handle` yourself. `{ port }` is explicit;
     * `true` or `{ offset?, host? }` is the app's own port plus `offset` (default 1) once the app listens, on `host`
     * (default 127.0.0.1): an API on 3001 serves its gateway on 3002.
     */
    readonly listen?: AiRouterGatewayListen
}

/** The extras of a registration: its visibility, and the `name` of the `AiRouterModule` registration it fronts (the default router when absent). */
export interface AiRouterGatewayModuleExtras {
    readonly isGlobal: boolean
    readonly name: string | undefined
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<AiRouterGatewayModuleOptions>({ moduleName: "AiRouterGateway" })
    .setClassMethodName("register")
    .setFactoryMethodName("createAiRouterGatewayOptions")
    .setExtras<AiRouterGatewayModuleExtras>({ isGlobal: false, name: undefined }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

/** What `AiRouterGatewayModule.register` takes: the options, plus `isGlobal` and `name`. */
export type AiRouterGatewayRegisterOptions = typeof OPTIONS_TYPE

/** What `AiRouterGatewayModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal` and `name`. */
export type AiRouterGatewayRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

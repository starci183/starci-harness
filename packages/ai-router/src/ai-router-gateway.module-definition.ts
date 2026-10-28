import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { GatewayOptions } from "./gateway/gateway.ts"

/** What the gateway module takes: the gateway's options, and where it listens. */
export interface AiRouterGatewayModuleOptions extends GatewayOptions {
    /** Listens on its own port once the application bootstraps, and stops at shutdown; absent, mount `gateway.handle` yourself. */
    readonly listen?: { readonly port: number; readonly host?: string }
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

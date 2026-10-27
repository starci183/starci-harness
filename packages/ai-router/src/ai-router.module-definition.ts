import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { AiRouterModuleOptions } from "./ai-router.options.ts"

/** The extras every registration may set: global visibility, and the name of one of several pools. */
export interface AiRouterModuleExtras {
    readonly isGlobal: boolean
    readonly name: string | undefined
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<AiRouterModuleOptions>({ moduleName: "AiRouter" })
    .setClassMethodName("register")
    .setFactoryMethodName("createAiRouterOptions")
    .setExtras<AiRouterModuleExtras>({ isGlobal: false, name: undefined }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

/** What `AiRouterModule.register` takes: the options, plus `isGlobal` and `name`. */
export type AiRouterRegisterOptions = typeof OPTIONS_TYPE

/** What `AiRouterModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal` and `name`. */
export type AiRouterRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

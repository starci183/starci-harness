import { Module } from "@nestjs/common"
import type { DynamicModule, Provider } from "@nestjs/common"
import { createRouter } from "./router.ts"
import type { AiRouter } from "./types.ts"
import { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } from "./ai-router.module-definition.ts"
import type { AiRouterRegisterAsyncOptions, AiRouterRegisterOptions } from "./ai-router.module-definition.ts"
import type { AiRouterModuleOptions } from "./ai-router.options.ts"
import { AiRouterService } from "./ai-router.service.ts"
import { getAiRouterServiceToken, getAiRouterToken } from "./ai-router.tokens.ts"

/** Adds the router and its service, built from this registration's options when the module is instantiated. */
function withRouter(base: DynamicModule, name: string | undefined): DynamicModule {
    const routerToken = getAiRouterToken(name)
    const serviceToken = getAiRouterServiceToken(name)
    const providers: Provider[] = [
        {
            provide: routerToken,
            inject: [MODULE_OPTIONS_TOKEN],
            // The router reads only its pool config; the handlers are the service's to subscribe and release.
            useFactory: (options: AiRouterModuleOptions): AiRouter => createRouter(options),
        },
        {
            provide: serviceToken,
            inject: [routerToken, MODULE_OPTIONS_TOKEN],
            useFactory: (router: AiRouter, options: AiRouterModuleOptions): AiRouterService => new AiRouterService(router, options.on),
        },
    ]
    return { ...base, providers: [...(base.providers ?? []), ...providers], exports: [...(base.exports ?? []), routerToken, serviceToken] }
}

/** A pool router as a Nest capability: registered once at the app root, or once per name for several pools. */
export class AiRouterModule extends ConfigurableModuleClass {
    /** Registers a router from options known now. */
    static override register(options: AiRouterRegisterOptions): DynamicModule {
        return withRouter(super.register(options), options.name)
    }

    /** Registers a router from options a factory, class or existing provider supplies. */
    static override registerAsync(options: AiRouterRegisterAsyncOptions): DynamicModule {
        return withRouter(super.registerAsync(options), options.name)
    }
}

Module({})(AiRouterModule)

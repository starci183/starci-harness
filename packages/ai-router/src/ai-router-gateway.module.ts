import { Inject, Module } from "@nestjs/common"
import type { DynamicModule, Provider } from "@nestjs/common"
import { getAiRouterToken } from "./ai-router.tokens.ts"
import { createGateway } from "./gateway/gateway.ts"
import type { AiRouterGateway } from "./gateway/gateway.ts"
import { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } from "./ai-router-gateway.module-definition.ts"
import type { AiRouterGatewayModuleOptions, AiRouterGatewayRegisterAsyncOptions, AiRouterGatewayRegisterOptions } from "./ai-router-gateway.module-definition.ts"
import type { AiRouter } from "./types.ts"

/** The injection token of the default router's gateway. */
export const AI_ROUTER_GATEWAY = "AI_ROUTER_GATEWAY"

/** The token of a gateway: `AI_ROUTER_GATEWAY` over the default router, `AI_ROUTER_GATEWAY:<name>` over a named one. */
export function getAiRouterGatewayToken(name?: string): string {
    return name === undefined ? AI_ROUTER_GATEWAY : `${AI_ROUTER_GATEWAY}:${name}`
}

/** Injects the gateway over the default router, or over the router registered under `name`. */
export function InjectAiRouterGateway(name?: string): PropertyDecorator & ParameterDecorator {
    return Inject(getAiRouterGatewayToken(name))
}

/** Adds the gateway over the named router, and the hooks that listen at bootstrap and close at shutdown. */
function withGateway(base: DynamicModule, name: string | undefined): DynamicModule {
    const token = getAiRouterGatewayToken(name)
    const providers: Provider[] = [
        {
            provide: token,
            inject: [getAiRouterToken(name), MODULE_OPTIONS_TOKEN],
            useFactory: (router: AiRouter, options: AiRouterGatewayModuleOptions): AiRouterGateway => createGateway(router, options),
        },
        {
            // Nest calls the lifecycle hooks of every provider instance that has them.
            provide: `${token}:lifecycle`,
            inject: [token, MODULE_OPTIONS_TOKEN],
            useFactory: (gateway: AiRouterGateway, options: AiRouterGatewayModuleOptions) => ({
                async onApplicationBootstrap(): Promise<void> {
                    if (options.listen !== undefined) await gateway.listen(options.listen.port, options.listen.host)
                },
                onApplicationShutdown(): Promise<void> {
                    return gateway.close()
                },
            }),
        },
    ]
    return { ...base, providers: [...(base.providers ?? []), ...providers], exports: [...(base.exports ?? []), token] }
}

/**
 * The OpenAI-compatible gateway hosted in a Nest application, over the router an `AiRouterModule` registration
 * provides: the router must be visible here (an `isGlobal` registration, or its module in `imports` of `registerAsync`).
 */
export class AiRouterGatewayModule extends ConfigurableModuleClass {
    /** Registers a gateway from options known now. */
    static override register(options: AiRouterGatewayRegisterOptions): DynamicModule {
        return withGateway(super.register(options), options.name)
    }

    /** Registers a gateway from options a factory, class or existing provider supplies. */
    static override registerAsync(options: AiRouterGatewayRegisterAsyncOptions): DynamicModule {
        return withGateway(super.registerAsync(options), options.name)
    }
}

Module({})(AiRouterGatewayModule)

import { Inject } from "@nestjs/common"
import { AiRouterService } from "./ai-router.service.ts"

/** The injection token of the default instance's raw router (`AiRouter`). */
export const AI_ROUTER = "AI_ROUTER"

/** The token of a raw router: `AI_ROUTER` for the default instance, `AI_ROUTER:<name>` for a named one. */
export function getAiRouterToken(name?: string): string {
    return name === undefined ? AI_ROUTER : `${AI_ROUTER}:${name}`
}

/** The token of a service: the `AiRouterService` class for the default instance, `AiRouterService:<name>` for a named one. */
export function getAiRouterServiceToken(name?: string): typeof AiRouterService | string {
    return name === undefined ? AiRouterService : `AiRouterService:${name}`
}

/** Injects the raw router of the default instance, or of the instance registered under `name`. */
export function InjectAiRouter(name?: string): PropertyDecorator & ParameterDecorator {
    return Inject(getAiRouterToken(name))
}

/** Injects the `AiRouterService` of the default instance, or of the instance registered under `name`. */
export function InjectAiRouterService(name?: string): PropertyDecorator & ParameterDecorator {
    return Inject(getAiRouterServiceToken(name))
}

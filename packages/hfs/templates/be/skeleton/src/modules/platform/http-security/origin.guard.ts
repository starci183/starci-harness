import { Injectable, SetMetadata } from "@nestjs/common"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { Reflector } from "@nestjs/core"
import { InjectReflector } from "@modules/platform/composition"
import { HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import { requestOf } from "./execution-request.mapper"
import { InjectHttpSecurityOptions, REQUIRE_ORIGIN_KEY } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"])

const SERVER_TO_SERVER_KEY = "platform.http-security.server-to-server"

/**
 * Marks a door whose caller is a server proving itself on every request (a signed webhook, a header credential), so no
 * browser origin is owed. Applied only by the identity decorators that carry that proof: `@Public({ reason:
 * PublicReason.SignedWebhook })` and `@Credential({ kind })`.
 */
export const ServerToServer = (): ReturnType<typeof SetMetadata> => SetMetadata(SERVER_TO_SERVER_KEY, true)

/** The origin a request names: its Origin header, or the origin of its Referer only when Origin is absent. */
const originOf = (origin: string | undefined, referer: string | undefined): string | undefined => {
    if (origin !== undefined) return origin
    return referer !== undefined && URL.canParse(referer) ? new URL(referer).origin : undefined
}

@Injectable()
/**
 * The second app guard, the CSRF defence: cookie-bearing mutations and doors marked RequireOrigin need an actual allowed
 * Origin. Other mutations retain Referer fallback and the ServerToServer exemption for callers proving themselves.
 */
export class OriginGuard implements CanActivate {
    constructor(
        @InjectReflector() private readonly reflector: Reflector,
        @InjectHttpSecurityOptions() private readonly options: HttpSecurityOptions,
    ) {}

    /** Refuses a state-changing request whose origin is missing or outside the allowlist. */
    canActivate(context: ExecutionContext): boolean {
        const request = requestOf(context)
        if (SAFE_METHODS.has(request.method)) return true
        const requiresOrigin =
            this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_ORIGIN_KEY, [
                context.getHandler(),
                context.getClass(),
            ]) === true || request.headers.cookie !== undefined
        const exempt = this.reflector.getAllAndOverride<boolean | undefined>(SERVER_TO_SERVER_KEY, [
            context.getHandler(),
            context.getClass(),
        ])
        if (!requiresOrigin && exempt === true) return true
        const origin = requiresOrigin
            ? request.headers.origin
            : originOf(request.headers.origin, request.headers.referer)
        if (origin !== undefined && this.options.allowedOrigins.includes(origin)) return true
        throw new HttpSecurityError({ code: HttpSecurityErrorCode.OriginRejected })
    }
}

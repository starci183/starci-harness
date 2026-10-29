import { Injectable, SetMetadata, applyDecorators } from "@nestjs/common"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { Reflector } from "@nestjs/core"
import type { Response } from "express"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectReflector } from "@modules/platform/composition"
import type { DoorDecorator } from "@modules/platform/composition"
import { InjectPrimaryEntityManager, returnedRows } from "@modules/platform/database"
import { HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import { requestOf } from "./execution-request.mapper"
import { InjectHttpSecurityOptions } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { isRateWindowRow } from "./persistence/rate-limit.rows"
import { HIT_RATE_WINDOW, PRUNE_RATE_WINDOWS } from "./persistence/rate-limit.sql"

/** The rate limit tiers of a door. */
export enum RateTier {
    /** The global default tier. */
    Default = "default",
    /** The tight tier every authentication handshake and signed webhook carries. */
    Strict = "strict",
}

/** What a door answers when its caller is over the limit, when that is not the 429 error body. */
export interface RateLimitExceeded {
    /** A same-site path the door's own contract answers with a 303 (an OAuth callback's error redirect). */
    readonly redirect: string
}

const RATE_TIER_KEY = "platform.http-security.rate-tier"
const RATE_EXCEEDED_KEY = "platform.http-security.rate-exceeded"
/** The longest window key the table stores: the tier, a colon and the caller address. */
const KEY_MAX = 128

/** A same-site path: one leading slash, never a protocol-relative `//` or `/\` that leaves the site. */
const isSameSitePath = (location: string): boolean =>
    location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\")

/**
 * Marks a door with a rate limit tier other than the default. A door whose contract answers only redirects (an OAuth
 * callback) names its error redirect in `exceeded`, and a caller over the limit gets that 303 instead of a 429 body.
 */
export const RateLimit = (tier: RateTier, exceeded?: RateLimitExceeded): DoorDecorator => {
    if (exceeded === undefined) return applyDecorators(SetMetadata(RATE_TIER_KEY, tier))
    if (!isSameSitePath(exceeded.redirect))
        throw new HttpSecurityError({
            code: HttpSecurityErrorCode.RequestInvalid,
            params: { fields: "RATE_LIMIT_REDIRECT" },
        })
    return applyDecorators(SetMetadata(RATE_TIER_KEY, tier), SetMetadata(RATE_EXCEEDED_KEY, exceeded))
}

@Injectable()
/**
 * The first app guard: a fixed-window counter per caller address and tier, stamped by the Clock and kept in the primary
 * database, so every replica counts against the same window. A hit that opens a fresh window also prunes a bounded batch of
 * expired windows.
 */
export class RateLimitGuard implements CanActivate {
    constructor(
        @InjectReflector() private readonly reflector: Reflector,
        @InjectClock() private readonly clock: Clock,
        @InjectHttpSecurityOptions() private readonly options: HttpSecurityOptions,
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
    ) {}

    /**
     * Counts the request and refuses it when the caller is over the limit of the door tier. A door that declares its
     * exceeded redirect has the 303 written here; the refusal still travels, and the errors filter leaves the sent
     * response as it is.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()]
        const tier = this.reflector.getAllAndOverride<RateTier | undefined>(RATE_TIER_KEY, targets) ?? RateTier.Default
        const limit =
            tier === RateTier.Strict ? this.options.rateLimit.strictLimit : this.options.rateLimit.defaultLimit
        const now = this.clock.now()
        const key = `${tier}:${requestOf(context).ip ?? "unknown"}`.slice(0, KEY_MAX)
        const resetAt = new Date(now.getTime() + this.options.rateLimit.windowMs)
        const rows = returnedRows(await this.entityManager.query(HIT_RATE_WINDOW, [key, now, resetAt]), isRateWindowRow)
        const hits = rows[0]?.hits ?? Number.POSITIVE_INFINITY
        if (hits === 1) await this.entityManager.query(PRUNE_RATE_WINDOWS, [now])
        if (hits <= limit) return true
        const exceeded = this.reflector.getAllAndOverride<RateLimitExceeded | undefined>(RATE_EXCEEDED_KEY, targets)
        if (exceeded !== undefined && context.getType() === "http")
            context.switchToHttp().getResponse<Response>().redirect(303, exceeded.redirect)
        throw new HttpSecurityError({ code: HttpSecurityErrorCode.RateLimited })
    }
}

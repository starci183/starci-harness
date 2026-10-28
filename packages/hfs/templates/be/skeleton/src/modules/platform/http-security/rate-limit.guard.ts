import { Injectable, SetMetadata } from "@nestjs/common"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { Reflector } from "@nestjs/core"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectReflector } from "@modules/platform/composition"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import { requestOf } from "./execution-request.mapper"
import { InjectHttpSecurityOptions } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import type { RateWindowRow } from "./persistence/rate-limit.rows"
import { HIT_RATE_WINDOW, PRUNE_RATE_WINDOWS } from "./persistence/rate-limit.sql"

/** The rate limit tiers of a door. */
export enum RateTier {
    /** The global default tier. */
    Default = "default",
    /** The tight tier every authentication handshake and signed webhook carries. */
    Strict = "strict",
}

const RATE_TIER_KEY = "platform.http-security.rate-tier"
/** The longest window key the table stores: the tier, a colon and the caller address. */
const KEY_MAX = 128

/** Marks a door with a rate limit tier other than the default. */
export const RateLimit = (tier: RateTier): ReturnType<typeof SetMetadata> => SetMetadata(RATE_TIER_KEY, tier)

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

    /** Counts the request and refuses it when the caller is over the limit of the door tier. */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const tier =
            this.reflector.getAllAndOverride<RateTier | undefined>(RATE_TIER_KEY, [
                context.getHandler(),
                context.getClass(),
            ]) ?? RateTier.Default
        const limit =
            tier === RateTier.Strict ? this.options.rateLimit.strictLimit : this.options.rateLimit.defaultLimit
        const now = this.clock.now()
        const key = `${tier}:${requestOf(context).ip ?? "unknown"}`.slice(0, KEY_MAX)
        const resetAt = new Date(now.getTime() + this.options.rateLimit.windowMs)
        const rows: Array<RateWindowRow> = await this.entityManager.query(HIT_RATE_WINDOW, [key, now, resetAt])
        const hits = rows[0]?.hits ?? Number.POSITIVE_INFINITY
        if (hits === 1) await this.entityManager.query(PRUNE_RATE_WINDOWS, [now])
        if (hits > limit) throw new HttpSecurityError({ code: HttpSecurityErrorCode.RateLimited })
        return true
    }
}

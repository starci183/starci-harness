import { Injectable, SetMetadata, applyDecorators } from "@nestjs/common"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { Reflector } from "@nestjs/core"
import type { Response } from "express"
import { In, LessThanOrEqual, MoreThan } from "typeorm"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectReflector } from "@modules/platform/composition"
import type { DoorDecorator } from "@modules/platform/composition"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import { requestOf } from "./execution-request.mapper"
import { InjectHttpSecurityOptions } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"
import { RateWindowEntity } from "./persistence/entities/rate-window.entity"

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
/** The most ended windows one fresh window prunes. */
const PRUNE_BATCH = 100

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
 * database through its entity, so every replica counts against the same window. A hit that opens a fresh window also prunes
 * a bounded batch of expired windows.
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
        const hits = await this.hit(key, now, resetAt)
        if (hits === 1) await this.prune(now)
        if (hits <= limit) return true
        const exceeded = this.reflector.getAllAndOverride<RateLimitExceeded | undefined>(RATE_EXCEEDED_KEY, targets)
        if (exceeded !== undefined && context.getType() === "http")
            context.switchToHttp().getResponse<Response>().redirect(303, exceeded.redirect)
        throw new HttpSecurityError({ code: HttpSecurityErrorCode.RateLimited })
    }

    /**
     * Counts one hit in the caller's window and answers the hits it holds: a live window grows by one in one atomic increment,
     * an ended window restarts at one hit ending at `resetAt`, and a missing one opens at one hit (a concurrent opener's row
     * wins and this hit is its first). A window that vanished between the writes counts as over every limit.
     */
    private async hit(key: string, now: Date, resetAt: Date): Promise<number> {
        const counted = await this.entityManager.increment(RateWindowEntity, { key, resetAt: MoreThan(now) }, "hits", 1)
        if ((counted.affected ?? 0) > 0) {
            const window = await this.entityManager.findOneBy(RateWindowEntity, { key })
            return window?.hits ?? Number.POSITIVE_INFINITY
        }
        const restarted = await this.entityManager.update(
            RateWindowEntity,
            { key, resetAt: LessThanOrEqual(now) },
            { hits: 1, resetAt },
        )
        if ((restarted.affected ?? 0) > 0) return 1
        await this.entityManager
            .createQueryBuilder(RateWindowEntity, "window")
            .insert()
            .values({ key, hits: 1, resetAt })
            .orIgnore()
            .execute()
        return 1
    }

    /** Deletes a bounded batch of the windows that ended by `now`; a window a hit restarted meanwhile is kept. */
    private async prune(now: Date): Promise<void> {
        const ended = await this.entityManager.find(RateWindowEntity, {
            select: { key: true },
            where: { resetAt: LessThanOrEqual(now) },
            order: { resetAt: "ASC" },
            take: PRUNE_BATCH,
        })
        if (ended.length === 0) return
        await this.entityManager.delete(RateWindowEntity, {
            key: In(ended.map((window) => window.key)),
            resetAt: LessThanOrEqual(now),
        })
    }
}

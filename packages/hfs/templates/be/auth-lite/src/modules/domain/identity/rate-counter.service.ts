// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import { LessThanOrEqual, MoreThan } from "typeorm"
import type { EntityManager } from "typeorm"
import type { RateCounter } from "@modules/integrations/passport"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager, returnedRows, rowShape } from "@modules/platform/database"
import { IdentityAttemptEntity } from "./persistence/entities"

const isCountedWindow = rowShape({ hits: "number" })

@Injectable()
/** The package's rate counter over identity_attempts: a fixed window per key, counted in one statement so every replica agrees. */
export class IdentityRateCounterService implements RateCounter {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** Counts one hit in the window and says whether the key is still within the limit. */
    async consume(key: string, windowMs: number, limit: number): Promise<boolean> {
        const now = this.clock.now()
        const counted = await this.entityManager
            .createQueryBuilder(IdentityAttemptEntity, "attempt")
            .update()
            .set({ hits: () => "hits + 1" })
            .where({ key, resetAt: MoreThan(now) })
            .returning("hits")
            .execute()
        const [live] = returnedRows(counted.raw, isCountedWindow)
        if (live !== undefined) return live.hits <= limit
        const resetAt = new Date(now.getTime() + windowMs)
        const restarted = await this.entityManager.update(
            IdentityAttemptEntity,
            { key, resetAt: LessThanOrEqual(now) },
            { hits: 1, resetAt },
        )
        if ((restarted.affected ?? 0) === 0) {
            await this.entityManager
                .createQueryBuilder(IdentityAttemptEntity, "attempt")
                .insert()
                .values({ key, hits: 1, resetAt })
                .orIgnore()
                .execute()
        }
        return limit >= 1
    }

    /** Forgets the window of a key. */
    async clear(key: string): Promise<void> {
        await this.entityManager.delete(IdentityAttemptEntity, { key })
    }
}

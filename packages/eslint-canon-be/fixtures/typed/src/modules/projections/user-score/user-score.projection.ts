import type { EntityManager } from "typeorm"
import { UserScoreProjectionEntity } from "./user-score.projection-entity"

/** The user-score read model: the only writer of its table. */
export class UserScoreProjection {
    constructor(private readonly entityManager: EntityManager) {}

    /** Recomputes one user's score from scratch (idempotent). */
    async recomputeUserScore(userId: string, total: number): Promise<void> {
        await this.entityManager.update(UserScoreProjectionEntity, { userId }, { total })
    }

    /** Reads one user's score. */
    async getUserScore(userId: string): Promise<number> {
        const rows = await this.entityManager.find(UserScoreProjectionEntity, { where: { userId } })
        return rows[0]?.total ?? 0
    }
}

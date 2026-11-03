// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { AccountDirectory, AccountStanding } from "@modules/integrations/passport"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { AuthUserEntity } from "./persistence/entities"

/** True when the account is deleted or banned at this instant. */
export const isDisabled = (user: AuthUserEntity, now: Date): boolean =>
    user.deletedAt !== null || (user.bannedUntil !== null && user.bannedUntil > now)

@Injectable()
/** The package's account directory over auth.users: whether an account still stands, for a refresh to go on. */
export class IdentityAccountDirectoryAdapter implements AccountDirectory {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** The standing of one account, or undefined when it does not exist. */
    async find(userId: string): Promise<AccountStanding | undefined> {
        const user = await this.entityManager.findOne(AuthUserEntity, { where: { id: userId } })
        if (user === null) return undefined
        return { id: user.id, email: user.email, disabled: isDisabled(user, this.clock.now()) }
    }
}

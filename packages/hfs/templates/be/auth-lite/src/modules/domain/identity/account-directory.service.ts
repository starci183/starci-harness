// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { AccountDirectory, AccountStanding } from "@modules/integrations/passport"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { accountDoors } from "./persistence/account-doors.port"

@Injectable()
/** The package's account directory over the account doors: whether an account still stands, for a refresh to go on. */
export class IdentityAccountDirectoryService implements AccountDirectory {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The standing of one account (disabled is decided by the database clock), or undefined when it does not exist. */
    async find(userId: string): Promise<AccountStanding | undefined> {
        const account = await accountDoors.userById(this.entityManager, userId)
        if (account === undefined) return undefined
        return { id: account.id, email: account.email, disabled: account.disabled }
    }
}

import type { EntityManager } from "typeorm"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import type { DeliveryClaimBackfill } from "./inbox.port"
import { CLAIM_EVENT } from "./persistence/inbox.sql"

/** Transfers a legacy delivery claim inside its owning capability's migration transaction. */
export const backfillDeliveryClaim = async (manager: EntityManager, claim: DeliveryClaimBackfill): Promise<void> => {
    if (manager.queryRunner?.isTransactionActive !== true) {
        throw new InboxError({ code: InboxErrorCode.TransactionRequired })
    }
    await manager.query(CLAIM_EVENT, [claim.source, claim.eventId, claim.claimedAt])
}

import type { EntityManager } from "typeorm"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import type { DeliveryClaim } from "./inbox.port"
import { RELEASE_EVENT } from "./persistence/inbox.sql"

/** Transfers a delivery receipt's authority back after its legacy owner restored the receipt in the same transaction. */
export const releaseDeliveryClaim = async (manager: EntityManager, claim: DeliveryClaim): Promise<void> => {
    if (manager.queryRunner?.isTransactionActive !== true) {
        throw new InboxError({ code: InboxErrorCode.TransactionRequired })
    }
    await manager.query(RELEASE_EVENT, [claim.source, claim.eventId])
}

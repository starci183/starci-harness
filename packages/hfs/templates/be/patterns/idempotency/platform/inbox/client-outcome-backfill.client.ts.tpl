import type { EntityManager } from "typeorm"
import { clientSource } from "./client-operation.policy"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import type { ClientOperation } from "./inbox.port"
import { canonicalJson, requestFingerprint } from "./request-fingerprint.policy"
import { BACKFILL_CLIENT_OUTCOME } from "./persistence/inbox.sql"

/** Transfers a capability's legacy completed operation into the shared inbox during its data migration. */
export const backfillClientOutcome = async (
    manager: EntityManager,
    operation: ClientOperation,
    outcome: unknown,
    claimedAt: Date,
): Promise<void> => {
    if (manager.queryRunner?.isTransactionActive !== true)
        throw new InboxError({ code: InboxErrorCode.TransactionRequired })
    await manager.query(BACKFILL_CLIENT_OUTCOME, [
        clientSource(operation),
        operation.idempotencyKey,
        requestFingerprint(operation.request),
        claimedAt,
        canonicalJson({ value: outcome }),
    ])
}

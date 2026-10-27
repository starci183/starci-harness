import { BATCH_ROWS } from "@modules/platform/database"
import { Injectable } from "@nestjs/common"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import type { EntityManager } from "typeorm"
import { InjectClaimManagers } from "./inbox.decorators"
import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import { clientSource } from "./client-operation.policy"
import type { ClientOperation, ClientOperationEffect, Inbox } from "./inbox.port"
import { canonicalJson, requestFingerprint } from "./request-fingerprint.policy"
import type { ClaimClientRow, InboxEventRow, InboxSweepRow, SavedClientOutcomeRow } from "./persistence/inbox.rows"
import { CLAIM_CLIENT, CLAIM_EVENT, RELEASE_EVENT, SAVE_CLIENT_OUTCOME, SWEEP_CLIENTS } from "./persistence/inbox.sql"

@Injectable()
/** The Inbox adapter over the claims table: the unique (source, event id) pair decides who claims first. */
export class PostgresInbox implements Inbox {
    constructor(
        @InjectClaimManagers() private readonly managers: readonly [EntityManager],
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** Claims through the caller transaction when supplied, otherwise through the app's configured manager. */
    async claim(source: string, eventId: string, tx?: EntityManager): Promise<boolean> {
        const manager = tx ?? this.managers[0]
        const rows: Array<InboxEventRow> = await manager.query(CLAIM_EVENT, [source, eventId, this.clock.now()])
        return rows.length > 0
    }

    /** Deletes the claim so a redelivery is processed again. */
    async release(source: string, eventId: string): Promise<void> {
        const [manager] = this.managers
        await manager.query(RELEASE_EVENT, [source, eventId])
    }

    /** Runs once in the domain transaction, returning the persisted JSON outcome on both the first call and every retry. */
    async runClient<T>(request: ClientOperation, tx: EntityManager, effect: ClientOperationEffect<T>): Promise<T> {
        if (tx.queryRunner?.isTransactionActive !== true)
            throw new InboxError({ code: InboxErrorCode.TransactionRequired })
        const source = clientSource(request)
        const fingerprint = requestFingerprint(request.request)
        const rows: Array<ClaimClientRow<T>> = await tx.query(CLAIM_CLIENT, [
            source,
            request.idempotencyKey,
            fingerprint,
            this.clock.now(),
        ])
        const claim = rows[0]
        if (!claim) throw new InboxError({ code: InboxErrorCode.OutcomeMissing })
        if (claim.request_fingerprint !== fingerprint)
            throw new IdempotencyError({ code: IdempotencyErrorCode.KeyReused })
        if (claim.incomplete) throw new InboxError({ code: InboxErrorCode.OutcomeMissing })
        if (claim.outcome !== null) return claim.outcome.value

        const value = await effect()
        let outcome: string
        try {
            outcome = canonicalJson({ value })
        } catch (cause) {
            throw new InboxError({ code: InboxErrorCode.OutcomeInvalid, cause })
        }
        const saved: Array<SavedClientOutcomeRow<T>> = await tx.query(SAVE_CLIENT_OUTCOME, [
            source,
            request.idempotencyKey,
            outcome,
        ])
        const recorded = saved[0]
        if (!recorded) throw new InboxError({ code: InboxErrorCode.OutcomeMissing })
        return recorded.outcome.value
    }

    /** A row lock and SKIP LOCKED keep retention from competing with a live retry or another sweep worker. */
    async sweepClients(cutoff: Date, tx: EntityManager): Promise<number> {
        const rows: Array<InboxSweepRow> = await tx.query(SWEEP_CLIENTS, [cutoff, BATCH_ROWS])
        return rows[0]?.deleted_count ?? 0
    }
}

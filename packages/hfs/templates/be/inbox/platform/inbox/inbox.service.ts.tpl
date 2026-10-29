import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { BATCH_ROWS, DatabaseError, DatabaseErrorCode, callDbFunction } from "@modules/platform/database"
import type { ClientOperation, ClientOperationEffect, Inbox, InboxEventId } from "./inbox.port"
import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"
import { InboxError, InboxErrorCode } from "./errors/inbox.error"
import { clientSource } from "./client-operation.policy"
import { canonicalJson, requestFingerprint } from "./request-fingerprint.policy"

/** The JSON envelope makes a completed null value distinct from a pending SQL-null outcome. */
interface ClientOutcomeRow<T> {
    /** The operation's complete JSON result, including expected refusals. */
    readonly value: T
}

/** The row returned by the atomic client claim. */
interface ClaimClientRow<T> {
    /** The digest recorded by the first operation under this scoped key. */
    readonly request_fingerprint: string | null
    /** The saved result, or null only for a claim inserted by this transaction. */
    readonly outcome: ClientOutcomeRow<T> | null
    /** An existing row had no completed outcome, so it must never run an effect again. */
    readonly incomplete: boolean
}

/** The persisted outcome returned to the first caller. */
interface SavedClientOutcomeRow<T> {
    /** The normalized JSON result as the database stores it. */
    readonly outcome: ClientOutcomeRow<T>
}

/** A claimed or deleted delivery key returned by inbox persistence. */
interface InboxEventRow {
    /** The event or client key owned by the row. */
    readonly event_id: string
}

/** The bounded retention batch's aggregate result. */
interface InboxSweepRow {
    /** Number of completed client claims removed by this transaction. */
    readonly deleted_count: number
}

@Injectable()
/** Claims a delivery with the receipt transaction, so a failure can be retried without losing the delivery. */
export class PostgresInbox implements Inbox {
    constructor(@InjectClock() private readonly clock: Clock) {}

    /** The first claim wins; the same source and delivery id becomes a no-op on redelivery. */
    async claim(source: string, eventId: InboxEventId, tx: EntityManager): Promise<boolean> {
        const normalizedEventId = eventId?.trim()
        if (!normalizedEventId) {
            throw new DatabaseError({ code: DatabaseErrorCode.WebhookDeliveryIdRequired })
        }
        const rows = await callDbFunction<InboxEventRow>(tx, "public.inbox_claim_event", [source, normalizedEventId])
        return rows.length > 0
    }

    /** Runs once in the domain transaction, returning the persisted JSON outcome on both the first call and every retry. */
    async runClient<T>(request: ClientOperation, tx: EntityManager, effect: ClientOperationEffect<T>): Promise<T> {
        if (tx.queryRunner?.isTransactionActive !== true)
            throw new InboxError({ code: InboxErrorCode.TransactionRequired })
        const source = clientSource(request)
        const fingerprint = requestFingerprint(request.request)
        const rows = await callDbFunction<ClaimClientRow<T>>(tx, "public.inbox_claim_client", [
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
        const saved = await callDbFunction<SavedClientOutcomeRow<T>>(tx, "public.inbox_save_client_outcome", [
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
        const rows = await callDbFunction<InboxSweepRow>(tx, "public.inbox_sweep_clients", [cutoff, BATCH_ROWS])
        return rows[0]?.deleted_count ?? 0
    }
}

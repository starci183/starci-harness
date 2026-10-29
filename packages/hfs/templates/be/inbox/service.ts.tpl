import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { @@Provider@@DeliveryRecordedEvent } from "@modules/events/@@provider@@"
import { InjectEventBus } from "@modules/platform/event-bus"
import type { EventBus } from "@modules/platform/event-bus"
import { InjectEntityInbox } from "@modules/platform/inbox"
import type { EntityInbox, InboxEntityReceipt } from "@modules/platform/inbox"
import { @@Provider@@InboxEntity } from "./persistence/entities/@@provider@@-inbox.entity"

interface @@Provider@@Delivery {
    readonly id: string
}

interface @@Provider@@DeliveryRequest {
    /** The request identity carried into the event envelope. */
    readonly correlationId: string
    readonly eventId: string | undefined
    readonly delivery: @@Provider@@Delivery
}

@Injectable()
/** Records each @@provider@@ delivery once. Pending rows are consumed by a separate reactor or job after commit. */
export class @@Provider@@InboxService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectEntityInbox() private readonly inbox: EntityInbox,
        @InjectEventBus() private readonly eventBus: EventBus,
    ) {}

    /**
     * The claim and the pending receipt row commit together: the winning claim inserts the row keyed by the delivery id the
     * claim normalized; a duplicate is acknowledged without another pending row, and this intake never dispatches a command.
     */
    record@@Provider@@Delivery(request: @@Provider@@DeliveryRequest): Promise<void> {
        return this.entityManager.transaction(async (manager) => {
            const receiptId = await this.inbox.claimRow("webhook.@@provider@@", request.eventId, manager, {
                entity: @@Provider@@InboxEntity,
                row: (deliveryId) => ({ provider: "@@provider@@", deliveryId, payload: request.delivery }),
            } satisfies InboxEntityReceipt<@@Provider@@InboxEntity>)
            if (receiptId === undefined) return
            await this.eventBus.publish(@@Provider@@DeliveryRecordedEvent.create({ receiptId }), manager, request.correlationId)
        })
    }
}

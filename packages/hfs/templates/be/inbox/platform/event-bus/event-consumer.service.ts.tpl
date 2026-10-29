import { Injectable } from "@nestjs/common"
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectLogger, isCorrelationId } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEventBusOptions } from "./event-bus.decorators"
import type { BaseEvent, EventMessage } from "./event-bus.contracts"
import { EventBusLogEvent } from "./event-bus.log-events"
import type { EventBusOptions } from "./event-bus.options"
import type { EventConsumer, EventConsumerRegistry } from "./event-bus.port"

/** One row of event_bus_read: pgmq returns the bigint id as text. */
interface MessageRow {
    readonly msg_id: string
    readonly read_ct: number
    readonly message: unknown
}

/** One consumer group: its queue and the consumer that reads it. */
export interface EventSubscription {
    /** The group's pgmq queue. */
    readonly queue: string
    /** The thin door the group's deliveries go through. */
    readonly consumer: EventConsumer<BaseEvent>
}

/** The correlation id of an envelope: its metadata when present and valid, else a safe event id; null refuses the message. */
const correlationOf = (message: unknown, eventId: string): string | null => {
    if (typeof message !== "object" || message === null || !("metadata" in message)) return isCorrelationId(eventId) ? eventId : null
    const metadata = message.metadata
    if (typeof metadata !== "object" || metadata === null || !("correlationId" in metadata)) return null
    return isCorrelationId(metadata.correlationId) ? metadata.correlationId : null
}

@Injectable()
/**
 * The consuming side of the lite event bus: each consumer group reads its own pgmq queue with a visibility timeout, archives a
 * message its consumer handled, leaves a failed one to reappear, and buries one past its attempts or malformed in the dead-letter
 * queue. Delivery is at least once, so the command a consumer dispatches claims the event in the inbox first (BE-IDEMPOTENCY-1).
 */
export class EventConsumerService implements EventConsumerRegistry, OnApplicationBootstrap, OnApplicationShutdown {
    private readonly subscriptions: Array<EventSubscription> = []
    private running = false

    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectEventBusOptions() private readonly options: EventBusOptions,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    subscribe<Event extends BaseEvent>(queue: string, consumer: EventConsumer<Event>): void {
        this.subscriptions.push({ queue, consumer })
    }

    onApplicationBootstrap(): void {
        this.running = true
        for (const subscription of this.subscriptions) void this.loop(subscription)
    }

    onApplicationShutdown(): void {
        this.running = false
    }

    /** Reads one batch of the group's queue and settles each message in order; answers how many it read. */
    async drain(subscription: EventSubscription): Promise<number> {
        const rows = await callDbFunction<MessageRow>(this.entityManager, "event_bus_read", [
            subscription.queue,
            this.options.visibilitySeconds ?? 30,
            this.options.batch ?? 10,
        ])
        for (const row of rows) await this.settle(subscription, { msgId: row.msg_id, readCt: row.read_ct, message: row.message })
        return rows.length
    }

    private async loop(subscription: EventSubscription): Promise<void> {
        while (this.running) {
            const read = await this.drain(subscription).catch((cause: unknown) => {
                this.logger.error(EventBusLogEvent.ReadFailed, cause, { queue: subscription.queue })
                return 0
            })
            if (read === 0) await new Promise((resolve) => setTimeout(resolve, this.options.idleMs ?? 500))
        }
    }

    private async settle(subscription: EventSubscription, message: EventMessage): Promise<void> {
        const event = subscription.consumer.event.parse(message.message)
        const correlationId = event === null ? null : correlationOf(message.message, event.eventId)
        if (event === null || correlationId === null) return this.bury(subscription.queue, message, "malformed")
        if (message.readCt > (this.options.attempts ?? 5)) return this.bury(subscription.queue, message, "attempts")
        try {
            await subscription.consumer.handle({ correlationId, eventId: event.eventId, event, attempt: message.readCt })
        } catch (cause) {
            this.logger.error(EventBusLogEvent.ConsumerFailed, cause, { queue: subscription.queue, eventId: event.eventId, attempt: message.readCt })
            return
        }
        await callDbFunction(this.entityManager, "event_bus_archive", [subscription.queue, message.msgId])
    }

    private async bury(queue: string, message: EventMessage, reason: string): Promise<void> {
        this.logger.warn(EventBusLogEvent.DeliveryBuried, { queue, msgId: message.msgId, reason, attempt: message.readCt })
        await callDbFunction(this.entityManager, "event_bus_bury", [queue, message.msgId, message.readCt, JSON.stringify(message.message), reason])
    }
}

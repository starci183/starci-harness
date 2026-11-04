import { Injectable } from "@nestjs/common"
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectLogger, isCorrelationId } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEventBusOptions } from "./event-bus.decorators"
import { DEFAULT_MAX_DELIVERIES } from "./event-bus.contracts"
import type { BaseEvent, EventMessage, EventSubscriptionOptions } from "./event-bus.contracts"
import { EventBusLogEvent } from "./event-bus.log-events"
import type { EventBusOptions } from "./event-bus.options"
import type { EventConsumer, EventConsumerRegistry } from "./event-bus.port"

/** One row of event_bus_read: pgmq returns the bigint id as text. */
interface MessageRow {
    readonly msg_id: string
    readonly read_ct: number
    readonly message: unknown
}

/** One consumer: its queue `<topic>__<consumer>`, the door its deliveries go through and its delivery budget. */
export interface EventSubscription {
    /** The consumer's pgmq queue. */
    readonly queue: string
    /** The thin door the consumer's deliveries go through. */
    readonly consumer: EventConsumer<BaseEvent>
    /** The deliveries before the message moves to `<queue>__dead`. */
    readonly maxDeliveries: number
}

/** The correlation id of an envelope: its metadata when present and valid, else a safe event id; null refuses the message. */
const correlationOf = (message: unknown, eventId: string): string | null => {
    if (typeof message !== "object" || message === null || !("metadata" in message)) return isCorrelationId(eventId) ? eventId : null
    const metadata = message.metadata
    if (typeof metadata !== "object" || metadata === null || !("correlationId" in metadata)) return null
    return isCorrelationId(metadata.correlationId) ? metadata.correlationId : null
}

/** True for a usable business dedupe key. */
const isDedupeKey = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256

@Injectable()
/**
 * The consuming side of the lite event bus: each consumer reads its own pgmq queue with a visibility timeout, archives a message it
 * handled, leaves a failed one to reappear, and moves one past its maxDeliveries, or malformed, to `<queue>__dead`. Delivery is at
 * least once and unordered, so the command a consumer dispatches claims (consumer, dedupeKey) in the inbox first and reads current
 * state rather than trusting the order of events (BE-EVENT-BUS-4).
 */
export class EventConsumerService implements EventConsumerRegistry, OnApplicationBootstrap, OnApplicationShutdown {
    private readonly subscriptions: Array<EventSubscription> = []
    private running = false

    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectEventBusOptions() private readonly options: EventBusOptions,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    subscribe<Event extends BaseEvent>(queue: string, consumer: EventConsumer<Event>, options: EventSubscriptionOptions = {}): void {
        this.subscriptions.push({ queue, consumer, maxDeliveries: options.maxDeliveries ?? DEFAULT_MAX_DELIVERIES })
    }

    onApplicationBootstrap(): void {
        this.running = true
        for (const subscription of this.subscriptions) void this.loop(subscription)
    }

    onApplicationShutdown(): void {
        this.running = false
    }

    /** Reads one batch of the consumer's queue and settles each message in order; answers how many it read. */
    async drain(subscription: EventSubscription): Promise<number> {
        const rows = await callDbFunction<MessageRow>(this.entityManager, "public.event_bus_read", [
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
        if (event === null || correlationId === null || !isDedupeKey(event.payload.dedupeKey)) return this.dead(subscription, message, "malformed", null)
        if (message.readCt > subscription.maxDeliveries) return this.dead(subscription, message, "max-deliveries", event.eventName)
        try {
            await subscription.consumer.handle({
                correlationId,
                eventId: event.eventId,
                consumer: subscription.queue,
                dedupeKey: event.payload.dedupeKey,
                event,
                attempt: message.readCt,
            })
        } catch (cause) {
            this.logger.error(EventBusLogEvent.ConsumerFailed, cause, { consumer: subscription.queue, event: event.eventName, attempt: message.readCt })
            return
        }
        await callDbFunction(this.entityManager, "public.event_bus_archive", [subscription.queue, message.msgId])
    }

    /** Moves the message to `<queue>__dead` and archives the original, in one call. */
    private async dead(subscription: EventSubscription, message: EventMessage, reason: string, eventName: string | null): Promise<void> {
        this.logger.warn(EventBusLogEvent.DeliveryDead, { consumer: subscription.queue, event: eventName, msgId: message.msgId, reason, attempt: message.readCt })
        await callDbFunction(this.entityManager, "public.event_bus_bury", [subscription.queue, message.msgId, message.readCt, JSON.stringify(message.message), reason])
    }
}

import type { DatabaseConnectionOptions } from "@modules/platform/database"
import { EventOutboxEntity } from "./entities/event-outbox.entity"
import { CreateEventOutbox@@epochMs13@@ } from "./migrations/@@epochMs13@@-create-event-outbox"

/** The entities of the event bus, for every connection that publishes events. */
export const eventBusEntities: DatabaseConnectionOptions["entities"] = [EventOutboxEntity]

/** The migrations of the event bus, in the order they run. */
export const eventBusMigrations: DatabaseConnectionOptions["migrations"] = [CreateEventOutbox@@epochMs13@@]

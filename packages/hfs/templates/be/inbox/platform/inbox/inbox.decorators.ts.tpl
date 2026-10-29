import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import type { EntityInbox, Inbox } from "./inbox.port"

/** Token of the shared, transaction-owned inbox claims; its provider is an EntityInbox too. */
export const INBOX: unique symbol = Symbol("platform.inbox")

/** Injects the Inbox port. Parameter type: Inbox. */
export const InjectInbox = (): TypedParameterDecorator<Inbox> => injector<Inbox>(INBOX)

/** Injects the Inbox port of a capability whose provider receipt is an entity row. Parameter type: EntityInbox. */
export const InjectEntityInbox = (): TypedParameterDecorator<EntityInbox> => injector<EntityInbox>(INBOX)

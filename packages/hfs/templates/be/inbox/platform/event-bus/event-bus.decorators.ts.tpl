import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import { MODULE_OPTIONS_TOKEN } from "./event-bus.module-definition"
import type { EventBusOptions } from "./event-bus.options"
import type { EventBus, EventConsumerRegistry } from "./event-bus.port"

/** Token of the transactional EventBus publisher. */
export const EVENT_BUS: unique symbol = Symbol("platform.event-bus")

/** Token of the registry reactors subscribe their consumers to. */
export const EVENT_CONSUMER_REGISTRY: unique symbol = Symbol("platform.event-bus.consumers")

/** Injects the EventBus port. Parameter type: EventBus. */
export const InjectEventBus = (): TypedParameterDecorator<EventBus> => injector<EventBus>(EVENT_BUS)

/** Injects the consumer registry. Parameter type: EventConsumerRegistry. */
export const InjectEventConsumerRegistry = (): TypedParameterDecorator<EventConsumerRegistry> =>
    injector<EventConsumerRegistry>(EVENT_CONSUMER_REGISTRY)

/** Injects the module's options. Parameter type: EventBusOptions. */
export const InjectEventBusOptions = (): TypedParameterDecorator<EventBusOptions> => injector<EventBusOptions>(MODULE_OPTIONS_TOKEN)

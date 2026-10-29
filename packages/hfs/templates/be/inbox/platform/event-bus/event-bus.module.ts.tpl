import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { EVENT_BUS, EVENT_CONSUMER_REGISTRY } from "./event-bus.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./event-bus.module-definition"
import { EventBusService } from "./event-bus.service"
import { EventConsumerService } from "./event-consumer.service"

@Module({})
/** Provides the lite event bus on pgmq: the transactional publisher and the read loops of the consumer groups. */
export class EventBusModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                { provide: EVENT_BUS, useClass: EventBusService },
                EventConsumerService,
                { provide: EVENT_CONSUMER_REGISTRY, useExisting: EventConsumerService },
            ],
            exports: [EVENT_BUS, EVENT_CONSUMER_REGISTRY],
        }
    }
}

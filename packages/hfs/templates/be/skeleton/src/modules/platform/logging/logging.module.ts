import { Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common"
import { CLOCK, type Clock } from "@modules/platform/clock"
import { IDS, type Ids } from "@modules/platform/ids"
import { CorrelationService } from "./correlation.service"
import { createJsonLogger } from "./json-logger.service"
import { CORRELATION_IDS, CORRELATION_RUNNER, InjectLogger, LOGGER } from "./logging.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./logging.module-definition"
import type { Logger } from "./logging.port"

/** A logger that holds lines for a transport and flushes them on request: the Winston adapter with its Loki push. */
interface FlushingLogger extends Logger {
    /** Pushes what the transport still holds and stops it. */
    close(): Promise<void>
}

/** True when the composed logger can flush; a logger without a transport has nothing to flush. */
const flushes = (logger: Logger): logger is FlushingLogger => typeof Reflect.get(logger, "close") === "function"

@Module({})
/** Provides the Logger port as the Winston adapter (JSON lines on stdout and stderr, Loki when configured) stamped by the app's Clock. */
export class LoggingModule extends ConfigurableModuleClass implements OnApplicationShutdown {
    constructor(@InjectLogger() private readonly logger: Logger) {
        super()
    }

    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                CorrelationService,
                { provide: CORRELATION_IDS, useExisting: CorrelationService },
                { provide: CORRELATION_RUNNER, useExisting: CorrelationService },
                {
                    provide: LOGGER,
                    inject: [CLOCK, IDS],
                    useFactory: (clock: Clock, ids: Ids) => createJsonLogger(clock, ids, options),
                },
            ],
            exports: [LOGGER, CORRELATION_IDS, CORRELATION_RUNNER],
        }
    }

    /** Pushes what the Loki transport still holds when the app shuts down, so the last lines of a stopping service reach Loki. */
    async onApplicationShutdown(): Promise<void> {
        if (flushes(this.logger)) await this.logger.close()
    }
}

import { Module, type DynamicModule } from "@nestjs/common"
import { CLOCK, type Clock } from "@modules/platform/clock"
import { IDS, type Ids } from "@modules/platform/ids"
import { CorrelationService } from "./correlation.service"
import { createJsonLogger } from "./json-logger.service"
import { LoggingShutdownService } from "./logging-shutdown.service"
import { CORRELATION_IDS, CORRELATION_RUNNER, LOGGER } from "./logging.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./logging.module-definition"

@Module({})
/** Provides the Logger port as the Winston adapter (JSON lines on stdout and stderr, Loki when configured) stamped by the app's Clock. */
export class LoggingModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                CorrelationService,
                LoggingShutdownService,
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
}

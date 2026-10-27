import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { IDS } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { CorrelationService } from "./correlation.service"
import { createJsonLogger } from "./json-logger.service"
import { CORRELATION_IDS, CORRELATION_RUNNER, LOGGER } from "./logging.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./logging.module-definition"

@Module({})
/** Provides the Logger port as the JSON-lines adapter stamped by the Clock the app registers. */
export class LoggingModule extends ConfigurableModuleClass {
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
                    useFactory: (clock: Clock, ids: Ids) => createJsonLogger(clock, ids),
                },
            ],
            exports: [LOGGER, CORRELATION_IDS, CORRELATION_RUNNER],
        }
    }
}

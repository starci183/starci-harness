import "reflect-metadata"
import { CommandFactory } from "nest-commander"
import { SystemClockService } from "@modules/platform/clock"
import { EnvSource } from "@modules/platform/config"
import { SystemIds } from "@modules/platform/ids"
import { createJsonLogger, createNestLogger, LoggingLogEvent } from "@modules/platform/logging"
import { AppModule } from "./app.module"
import { readCliEnv } from "./cli.env"
import { createCliAppOptions } from "./cli.options"

/** The command line of the back end: reads the environment once and runs the command its arguments name (`cli migrate run`). */
async function bootstrap(): Promise<void> {
    const logger = createJsonLogger(new SystemClockService(), new SystemIds())
    await CommandFactory.run(AppModule.register(createCliAppOptions(readCliEnv(EnvSource.fromProcess()))), {
        logger: createNestLogger(logger),
        errorHandler: (error: Error) => {
            logger.error(LoggingLogEvent.StartupFailed, error, { service: "cli" })
            process.exit(1)
        },
    })
}

bootstrap().catch((error: unknown) => {
    createJsonLogger(new SystemClockService(), new SystemIds()).error(LoggingLogEvent.StartupFailed, error, {
        service: "cli",
    })
    process.exit(1)
})

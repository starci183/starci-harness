import { NestFactory } from "@nestjs/core"
import { SystemClockService } from "@modules/platform/clock"
import { EnvSource } from "@modules/platform/config"
import { applyHttpSecurity } from "@modules/platform/http-security"
import { SystemIds } from "@modules/platform/ids"
import { applyCorrelation, createJsonLogger, createNestLogger, LOGGER, LoggingLogEvent, type Logger } from "@modules/platform/logging"
import { AppModule } from "./app.module"
import { read{{appPascal}}Env } from "./{{app}}.env"

/** Reads the environment once, composes the app from the parsed options and serves until a shutdown signal. */
const bootstrap = async (): Promise<void> => {
    const env = EnvSource.fromProcess()
    const options = read{{appPascal}}Env(env)
    // The framework's boot messages are held until the container's logger (Loki too, when configured) takes them over.
    const app = await NestFactory.create(AppModule.register(options), {
        rawBody: true,
        bufferLogs: true,
        logger: createNestLogger(createJsonLogger(new SystemClockService(), new SystemIds())),
    })
    const logger = app.get<Logger>(LOGGER)
    app.useLogger(createNestLogger(logger))
    applyCorrelation(app)
    applyHttpSecurity(app, options.httpSecurity, { trustProxy: 1 })
    app.enableShutdownHooks()
    await app.listen(options.server.port)
    logger.info(LoggingLogEvent.ServerStarted, {
        service: "{{app}}",
        port: options.server.port,
    })
}

bootstrap().catch((error: unknown) => {
    createJsonLogger(new SystemClockService(), new SystemIds()).error(LoggingLogEvent.StartupFailed, error, {
        service: "{{app}}",
    })
    process.exitCode = 1
})

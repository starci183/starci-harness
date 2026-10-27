import type { LoggerService } from "@nestjs/common"
import { InjectLogger } from "./logging.decorators"
import { LoggingLogEvent } from "./logging.log-events"
import type { LogFields, Logger } from "./logging.port"

/** Keeps the framework's message and optional textual context without dumping unstructured extra arguments. */
const fieldsOf = (message: unknown, optionalParams: ReadonlyArray<unknown>): LogFields => {
    const context = optionalParams.at(-1)
    return { message: String(message), ...(typeof context === "string" ? { context } : {}) }
}

/** Routes Nest's own bootstrap and runtime messages through the app's correlation-stamped logging port. */
export class NestLoggerService implements LoggerService {
    constructor(@InjectLogger() private readonly logger: Logger) {}

    /** Records an ordinary framework lifecycle message. */
    log(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.info(LoggingLogEvent.FrameworkLog, fieldsOf(message, optionalParams))
    }

    /** Keeps the framework's error as the cause for the logging adapter's structured serialization. */
    error(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.error(LoggingLogEvent.FrameworkError, message, fieldsOf(message, optionalParams))
    }

    /** Records a recoverable framework warning. */
    warn(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.warn(LoggingLogEvent.FrameworkWarning, fieldsOf(message, optionalParams))
    }

    /** Preserves debug identity on the JSON port's informational stream. */
    debug(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.info(LoggingLogEvent.FrameworkDebug, fieldsOf(message, optionalParams))
    }

    /** Preserves verbose identity on the JSON port's informational stream. */
    verbose(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.info(LoggingLogEvent.FrameworkVerbose, fieldsOf(message, optionalParams))
    }

    /** Records a fatal framework failure through the error stream. */
    fatal(message: unknown, ...optionalParams: Array<unknown>): void {
        this.logger.error(LoggingLogEvent.FrameworkFatal, message, fieldsOf(message, optionalParams))
    }
}

/** Supplies NestFactory or CommandFactory with the same Logger port used by application code. */
export const createNestLogger = (logger: Logger): LoggerService => new NestLoggerService(logger)

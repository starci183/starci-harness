import { isDomainError } from "@modules/platform/errors"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CqrsLogEvent } from "./cqrs.log-events"

/**
 * The template every command and query handler extends. `execute` is what `@nestjs/cqrs` calls: it delegates to the
 * handler `process` and, when that throws an unexpected failure (anything but a DomainError, which is an answer, not an
 * incident), logs `OperationFailed` once with the operation name and rethrows; the errors filter then maps it without logging
 * it again, since the logger writes one cause once (BE-ERROR-4). A handler
 * implements `process` and never overrides `execute`. It does not `implements ICommandHandler`: since `@nestjs/cqrs` 11
 * that type is conditional on the message result type, which a class cannot implement; `@CommandHandler` and
 * `@QueryHandler` check the shape where they are applied.
 */
export abstract class ICQRSHandler<TMessage, TResult> {
    constructor(@InjectLogger() private readonly logger: Logger) {}

    /** The bus entry point. */
    async execute(message: TMessage): Promise<TResult> {
        try {
            return await this.process(message)
        } catch (error) {
            if (!isDomainError(error)) this.logger.error(CqrsLogEvent.OperationFailed, error, { operation: this.constructor.name })
            throw error
        }
    }

    /** The one call of the handler: it hands the mapped message to one method of one service and returns the answer. */
    protected abstract process(message: TMessage): Promise<TResult>
}

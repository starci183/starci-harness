import type { OnApplicationShutdown } from "@nestjs/common"
import { JsonLoggerService } from "./json-logger.service"
import { InjectLogger } from "./logging.decorators"
import type { Logger } from "./logging.port"

/** Pushes what the Loki transport still holds when the app shuts down, so the last lines of a stopping service reach Loki. */
export class LoggingShutdownService implements OnApplicationShutdown {
    constructor(@InjectLogger() private readonly logger: Logger) {}

    /** Flushes and stops the adapter's Loki push; a logger without one has nothing to flush. */
    async onApplicationShutdown(): Promise<void> {
        if (this.logger instanceof JsonLoggerService) await this.logger.close()
    }
}

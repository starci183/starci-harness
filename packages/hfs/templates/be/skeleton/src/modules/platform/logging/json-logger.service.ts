import type { Writable } from "node:stream"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { InjectIds } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { stampLogFields } from "./correlation.policy"
import { InjectLogErr, InjectLogOut } from "./logging.decorators"
import type { LoggingOptions } from "./logging.options"
import type { LogFields, Logger } from "./logging.port"

type Level = "info" | "warn" | "error"

/** The default adapter: one JSON object per line, stamped by the Clock; info goes to `out`, warn and error to `err`. */
export class JsonLoggerService implements Logger {
    /** The identity of lines written outside any correlation scope: drawn once, so such lines of one process share it. */
    private readonly rootId: string

    constructor(
        @InjectClock() private readonly clock: Clock,
        @InjectLogOut() private readonly out: Writable,
        @InjectLogErr() private readonly err: Writable,
        @InjectIds() ids: Ids,
    ) {
        this.rootId = ids.next()
    }

    /** Writes an info line. */
    info(event: string, fields?: LogFields): void {
        this.write("info", this.out, event, fields)
    }

    /** Writes a warn line. */
    warn(event: string, fields?: LogFields): void {
        this.write("warn", this.err, event, fields)
    }

    /** Writes the cause's name, message, optional error code and stack without allowing caller fields to replace them. */
    error(event: string, cause: unknown, fields?: LogFields): void {
        const code = typeof cause === "object" && cause !== null && "code" in cause ? { errorCode: cause.code } : {}
        const detail =
            cause instanceof Error
                ? { errorName: cause.name, errorMessage: cause.message, stack: cause.stack }
                : { errorMessage: String(cause) }
        this.write("error", this.err, event, { ...fields, ...detail, ...code })
    }

    private write(level: Level, sink: Writable, event: string, fields?: LogFields): void {
        sink.write(
            `${JSON.stringify({ ...stampLogFields(fields, this.rootId), level, event, time: this.clock.now().toISOString() })}\n`,
        )
    }
}

/** Builds the JSON logger stamping lines with `clock`: info on stdout (or stderr when `options.info` says so), warn and error on stderr; main.ts uses it before the DI container exists. */
export const createJsonLogger = (clock: Clock, ids: Ids, options: LoggingOptions = {}): Logger =>
    new JsonLoggerService(clock, options.info === "stderr" ? process.stderr : process.stdout, process.stderr, ids)

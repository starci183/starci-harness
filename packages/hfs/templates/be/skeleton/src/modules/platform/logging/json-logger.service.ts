import type { Writable } from "node:stream"
import { createLogger, format, transports, type Logger as Winston, type transport as Transport } from "winston"
import type { Clock } from "@modules/platform/clock"
import type { Ids } from "@modules/platform/ids"
import { stampLogFields } from "./correlation.policy"
import { redactLogFields } from "./log-redaction.policy"
import { LoggingLogEvent } from "./logging.log-events"
import type { LoggingOptions } from "./logging.options"
import type { LogFields, Logger } from "./logging.port"
import { BoundedLokiTransport } from "./loki-transport.adapter"

type Level = "info" | "warn" | "error"

/** The levels of the port, most severe first, as winston numbers them. */
const LEVELS: Readonly<Record<Level, number>> = { error: 0, warn: 1, info: 2 }

/** Where winston reads the finished line (triple-beam's MESSAGE) and where the adapter keeps the record it was built from. */
const MESSAGE = Symbol.for("message")
const RECORD = Symbol("platform.logging.record")

/** How often a Loki outage is reported on stderr at most. */
const OUTAGE_REPORT_MS = 60_000

/**
 * The causes already written by any logger of this process: a failure is logged once, by the first owner that logs it (a handler
 * base, else the errors filter), however many owners it passes on its way out (BE-ERROR-4).
 */
const loggedCauses = new WeakSet<object>()

/** Serializes the record the adapter built into the line every transport writes, unchanged by winston. */
const lineFormat = format((info) => {
    Reflect.set(info, MESSAGE, JSON.stringify(Reflect.get(info, RECORD)))
    return info
})

/** Keeps a line only on the transport its level belongs to (info on `out`, warn and error on `err`). */
const levelsFormat = (levels: ReadonlyArray<string>) => format((info) => (levels.includes(info.level) ? info : false))()

/** The two console transports: stdout and stderr keep every line, so `docker logs` reads them whatever Loki does. */
const consoleTransports = (out: Writable, err: Writable): Array<Transport> => [
    new transports.Stream({ stream: out, eol: "\n", format: levelsFormat(["info"]) }),
    new transports.Stream({ stream: err, eol: "\n", format: levelsFormat(["warn", "error"]) }),
]

/**
 * The Winston adapter of the Logger port: one JSON object per line, stamped by the Clock and the correlation scope, credentials
 * masked (log-redaction.policy.ts); info goes to `out`, warn and error to `err`, and with `options.loki` every line is also pushed
 * to Loki through winston-loki (loki-transport.adapter.ts), labelled app, env, service, level and event. A Loki outage never reaches the
 * caller: the push is dropped, reported on stderr at most once a minute, and the console lines go on.
 */
export class JsonLoggerService implements Logger {
    /** The identity of lines written outside any correlation scope: drawn once, so such lines of one process share it. */
    private readonly rootId: string
    private readonly winston: Winston
    private readonly loki: BoundedLokiTransport | undefined
    private lastOutageReport = Number.NEGATIVE_INFINITY

    constructor(
        private readonly clock: Clock,
        ids: Ids,
        private readonly out: Writable,
        private readonly err: Writable,
        options: LoggingOptions = {},
    ) {
        this.rootId = ids.next()
        this.loki =
            options.loki === undefined
                ? undefined
                : new BoundedLokiTransport(options.loki, (cause) => this.reportOutage(cause))
        this.winston = createLogger({
            levels: LEVELS,
            level: "info",
            format: lineFormat(),
            transports: [...consoleTransports(out, err), ...(this.loki === undefined ? [] : [this.loki])],
            exitOnError: false,
        })
    }

    /** Writes an info line. */
    info(event: string, fields?: LogFields): void {
        this.write("info", event, fields)
    }

    /** Writes a warn line. */
    warn(event: string, fields?: LogFields): void {
        this.write("warn", event, fields)
    }

    /**
     * Writes the cause's name, message, optional error code and stack without allowing caller fields to replace them. A cause
     * object already logged by this process is not written again.
     */
    error(event: string, cause: unknown, fields?: LogFields): void {
        if (typeof cause === "object" && cause !== null) {
            if (loggedCauses.has(cause)) return
            loggedCauses.add(cause)
        }
        const code = typeof cause === "object" && cause !== null && "code" in cause ? { errorCode: cause.code } : {}
        const detail =
            cause instanceof Error
                ? { errorName: cause.name, errorMessage: cause.message, stack: cause.stack }
                : { errorMessage: String(cause) }
        this.write("error", event, { ...fields, ...detail, ...code })
    }

    /** Pushes what Loki still holds and stops its loop; the logging module calls it on shutdown. */
    async close(): Promise<void> {
        await this.loki?.close()
    }

    private write(level: Level, event: string, fields?: LogFields): void {
        const time = this.clock.now().toISOString()
        const record = { ...stampLogFields(redactLogFields(fields), this.rootId), level, event, time }
        this.winston.log({ level, message: event, timestamp: time, labels: { event }, [RECORD]: record })
    }

    /** Reports a failed push on stderr directly (never through Loki), at most once per OUTAGE_REPORT_MS. */
    private reportOutage(cause: unknown): void {
        const now = this.clock.now().getTime()
        if (now - this.lastOutageReport < OUTAGE_REPORT_MS) return
        this.lastOutageReport = now
        const record = {
            ...stampLogFields(
                {
                    errorMessage: cause instanceof Error ? cause.message : String(cause),
                    dropped: this.loki?.dropped ?? 0,
                },
                this.rootId,
            ),
            level: "warn",
            event: LoggingLogEvent.LokiUnreachable,
            time: new Date(now).toISOString(),
        }
        this.err.write(`${JSON.stringify(record)}\n`)
    }
}

/**
 * Builds the logger stamping lines with `clock`: info on stdout (or stderr when `options.info` says so), warn and error on stderr,
 * and Loki as well when `options.loki` is given; main.ts uses it before the DI container exists.
 */
export const createJsonLogger = (clock: Clock, ids: Ids, options: LoggingOptions = {}): JsonLoggerService =>
    new JsonLoggerService(
        clock,
        ids,
        options.info === "stderr" ? process.stderr : process.stdout,
        process.stderr,
        options,
    )

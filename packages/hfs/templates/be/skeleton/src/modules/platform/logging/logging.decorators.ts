import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { Logger } from "./logging.port"
import type { CorrelationIds, CorrelationRunner } from "./correlation.port"

/** Token of the Logger port. */
export const LOGGER: unique symbol = Symbol("platform.logging.logger")

/** Token of the inbound identity resolver. */
export const CORRELATION_IDS: unique symbol = Symbol("platform.logging.correlation-ids")

/** Token of the logger's async scope runner. */
export const CORRELATION_RUNNER: unique symbol = Symbol("platform.logging.correlation-runner")

/** Injects explicit inbound identity resolution. Parameter type: CorrelationIds. */
export const InjectCorrelationIds = (): TypedParameterDecorator<CorrelationIds> =>
    injector<CorrelationIds>(CORRELATION_IDS)

/** Injects infrastructure logging scopes. Parameter type: CorrelationRunner. */
export const InjectCorrelationRunner = (): TypedParameterDecorator<CorrelationRunner> =>
    injector<CorrelationRunner>(CORRELATION_RUNNER)

/** Injects the Logger port. Parameter type: Logger. */
export const InjectLogger = (): TypedParameterDecorator<Logger> => injector<Logger>(LOGGER)

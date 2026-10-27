import type { INestApplication } from "@nestjs/common"
import type { RequestHandler } from "express"
import type { CorrelationIds, CorrelationRunner } from "./correlation.port"
import { CORRELATION_IDS, CORRELATION_RUNNER } from "./logging.decorators"

/** Copies the identity onto the request and response, then scopes all downstream request logging. */
export const correlationMiddleware =
    (ids: CorrelationIds, runner: CorrelationRunner): RequestHandler =>
    (request, response, next) => {
        const correlationId = ids.fromHeaders(request.headers)
        Object.assign(request, { correlationId })
        response.setHeader("x-request-id", correlationId)
        runner.run(correlationId, next)
    }

/** Installs correlation before request handling; transports read the stamped request field explicitly. */
export const applyCorrelation = (app: INestApplication): void => {
    app.use(
        correlationMiddleware(app.get<CorrelationIds>(CORRELATION_IDS), app.get<CorrelationRunner>(CORRELATION_RUNNER)),
    )
}

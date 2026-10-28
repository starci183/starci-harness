import { Catch } from "@nestjs/common"
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common"
import type { Request, Response } from "express"
import { InjectRequestLocale } from "@modules/platform/i18n"
import type { RequestLocale } from "@modules/platform/i18n"
import { InjectErrorsService } from "./errors.decorators"
import type { ErrorsService } from "./errors.service"

@Catch()
/**
 * The one REST exception filter of an app: answers `{ code, kind, message, params }` with the status of the kind. In a GraphQL
 * context it hands the failure back untouched, so the GraphQL error formatter (platform/graphql) answers it. A response a
 * guard already answered (a redirect-only door over its rate limit) is left as it was sent.
 */
export class ErrorsFilter implements ExceptionFilter {
    constructor(
        @InjectErrorsService() private readonly errors: ErrorsService,
        @InjectRequestLocale() private readonly requestLocale: RequestLocale,
    ) {}

    /** Writes the description of `exception` on the HTTP response, or returns it unchanged for GraphQL. */
    catch(exception: unknown, host: ArgumentsHost): unknown {
        if (host.getType<string>() === "graphql") return exception
        const http = host.switchToHttp()
        const response = http.getResponse<Response>()
        if (response.headersSent) return undefined
        const request = http.getRequest<Request>()
        const description = this.errors.describe(exception)
        const locale = this.requestLocale.of(request.headers["accept-language"])
        response.status(description.status).json({
            code: description.code,
            kind: description.kind,
            message: this.errors.text(description.code, description.params, locale),
            params: description.params,
        })
        return undefined
    }
}

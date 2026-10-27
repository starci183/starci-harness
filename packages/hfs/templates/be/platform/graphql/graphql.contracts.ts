import type { Request, Response } from "express"
import type { CorrelationRequest } from "@modules/platform/logging"

/** The GraphQL context every operation runs with: the HTTP request it arrived on and its response. */
export interface GraphqlContext {
    /** The HTTP request: the guards read its headers and the principal they establish on it. */
    readonly req: Request & CorrelationRequest
    /** The HTTP response. */
    readonly res: Response
}

/** The deepest selection nesting an operation may have. */
export const GRAPHQL_DEPTH_MAX = 10

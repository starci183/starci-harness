import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { OidcError } from "./errors.ts"
import type { OidcHttpRequest, OidcHttpResponse, ResolvedOidcOptions } from "./options.ts"
import { isRecord } from "./primitives.ts"

/** The answers that mean the provider is struggling rather than refusing: a server error and a throttle. */
const isOutage = (status: number): boolean => status >= 500 || status === 429

/**
 * Sends one request through the registration's `OidcHttp` port with its deadline. A lost connection, a timeout, a 5xx and a 429 throw
 * `Unavailable` (a provider outage, never a refusal of the person); any other answer is returned for the caller to judge.
 */
export const send = async (options: ResolvedOidcOptions, request: Omit<OidcHttpRequest, "timeoutMs">): Promise<OidcHttpResponse> => {
    const response = await options.http.request({ ...request, timeoutMs: options.timeoutMs }).catch((cause: unknown) => {
        throw new OidcError(OIDC_ERROR_CODES.Unavailable, { cause })
    })
    if (isOutage(response.status)) throw new OidcError(OIDC_ERROR_CODES.Unavailable)
    return response
}

/** The OAuth `error` code of an answer (`invalid_grant`), or undefined. Never the description, which may name the person. */
export const errorCodeOf = (body: unknown): string | undefined => (isRecord(body) && typeof body.error === "string" ? body.error : undefined)

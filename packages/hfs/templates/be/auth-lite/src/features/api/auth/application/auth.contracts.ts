// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import type { HttpExchange } from "@modules/integrations/passport"

/** One cookie door of sign-in: the request and response the strategy or the refresh cookie work on. */
export interface ExchangeRequest {
    /** The request and response. */
    readonly exchange: HttpExchange
}

/** A request with nothing in it. */
export type EmptyRequest = Record<string, never>

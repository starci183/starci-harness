// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import type { MailLanguage } from "@modules/integrations/mail"
import type { HttpExchange } from "@modules/integrations/passport"

/** One cookie door of sign-in: the request and response the strategy or the refresh cookie work on. */
export interface ExchangeRequest {
    /** The request and response. */
    readonly exchange: HttpExchange
}

/** A request with nothing in it. */
export type EmptyRequest = Record<string, never>

/** The posted data of the signup door. */
export interface SignupData {
    /** The sign-in address. */
    readonly email: string
    /** The chosen password. */
    readonly password: string
    /** The language of the confirmation mail, when the request names one. */
    readonly language: MailLanguage | undefined
}

/** The posted data of the resend and forgot doors. */
export interface AddressData {
    /** The address the mail goes to. */
    readonly email: string
    /** The language of the mail, when the request names one. */
    readonly language: MailLanguage | undefined
}

/** The link token of the confirm door. */
export interface TokenData {
    /** The token the link carries. */
    readonly token: string
}

/** The posted data of the reset door. */
export interface ResetData {
    /** The token the link carries. */
    readonly token: string
    /** The new password. */
    readonly password: string
}

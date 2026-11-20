import type { MailOptions as MailSettings } from "@starci/mail"

/** The languages the app writes its mail in. */
export type MailLanguage = "vi" | "en"

/**
 * Outgoing mail parsed once at API boot: the settings of `@starci/mail` and what the app's own mail needs (the product name in
 * the header, the language of a mail whose request names none, how long a confirmation or reset link lives). The words and
 * layout of each mail belong to the domain that sends it.
 */
export interface MailOptions extends MailSettings {
    /** The origin of the web app: the links of a confirmation or reset mail open its pages. */
    readonly webOrigin: string
    /** The product name in the header of every mail. */
    readonly brandName: string
    /** The language of a mail whose request names none. */
    readonly defaultLanguage: MailLanguage
    /** How long a confirmation link lives, in seconds. */
    readonly confirmTtlSeconds: number
    /** How long a password reset link lives, in seconds. */
    readonly resetTtlSeconds: number
}

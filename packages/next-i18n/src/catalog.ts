import type { AbstractIntlMessages } from "next-intl"

/** What an app's loader returns for a locale: the module of its catalog file, whose default export is the message tree. */
export interface CatalogModule {
    readonly default: AbstractIntlMessages
}

/** Loads one app's own catalog for a served locale: `(locale) => import(`./messages/${locale}.json`)`. */
export type LoadCatalog<Locale extends string> = (locale: Locale) => Promise<CatalogModule>

/** The missing message next-intl asks a fallback for. */
export interface MissingMessage {
    readonly namespace?: string
    readonly key: string
}

const isMessages = (value: unknown): value is AbstractIntlMessages => typeof value === "object" && value !== null && !Array.isArray(value)

/** The message tree a catalog module exports as its default: the module is read as `unknown` and checked, never trusted. */
export const messagesOf = (loaded: unknown): AbstractIntlMessages => {
    const messages = typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : undefined
    if (!isMessages(messages)) throw new TypeError("A message catalog module must export its messages as default")
    return messages
}

/** The text shown for a key an app's catalog lacks: `<app>:<namespace>.<key>`, so the missing key is readable on screen. */
export const fallbackText = (app: string, missing: MissingMessage): string => `${app}:${missing.namespace ?? ""}.${missing.key}`

"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Statics: the app's static assets (illustrations, empty-state art, seed images and videos) are addressed by a key,
 * `illustrations/empty/customers.png`, and served from one base URL (an object-storage mirror, a CDN path, a folder of
 * the app). `Image`, `Video` and `Illustration` take that key as `staticsKey` and resolve it through the nearest
 * `StaticsProvider`, so a component names the asset and never the host that serves it; a plain `src` stays for a URL
 * that is already resolved.
 */

const StaticsContext = createContext<string | null>(null)

/** A key is a relative path of plain segments: no scheme, no query, no `..`, no empty segment. */
const KEY = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/

/** True when `key` is a well-formed statics key. */
export const isStaticsKey = (key: string): boolean => KEY.test(key) && !key.split("/").some((segment) => segment === "." || segment === "..")

/** The URL of a key under a base URL, or `null` for a malformed key. */
export const staticsUrl = (baseUrl: string, key: string): string | null =>
    isStaticsKey(key) ? `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}` : null

/** Tells every `Image`, `Video` and `Illustration` inside where the statics are served from. Nests: the innermost wins. */
export const StaticsProvider = ({ baseUrl, children }: { readonly baseUrl: string; readonly children: ReactNode }) => (
    <StaticsContext.Provider value={baseUrl}>{children}</StaticsContext.Provider>
)

/** The resolver of the nearest provider: a key to its URL, or `null` when there is no provider or the key is malformed. */
export const useStaticsResolver = (): ((key: string) => string | null) => {
    const baseUrl = useContext(StaticsContext)
    return (key) => (baseUrl === null ? null : staticsUrl(baseUrl, key))
}

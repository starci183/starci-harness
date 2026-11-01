"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { FieldVariant } from "./leaf/Field/index.js"

/**
 * What stands around the current content.
 *
 * - `card`, `pane` and `overlay` are painted surfaces. A `SurfaceCard` inside any of them is refused: a surface never
 *   stands inside another surface (a card in a card, in `Pane surface`, in a `Dialog`, `Drawer` or `Popover`).
 * - `chrome` is a bar or a rail that only decides the field layer; it paints no surface a card could collide with.
 */
export type SurfaceHost = "card" | "pane" | "overlay" | "chrome"

const SurfaceHostContext = createContext<SurfaceHost | null>(null)

/** Supplies the nested-control layer to every child, including portalled overlay content. */
export const SurfaceNesting = ({ children, host = "chrome" }: { readonly children: ReactNode; readonly host?: SurfaceHost }) => (
    <SurfaceHostContext.Provider value={host}>{children}</SurfaceHostContext.Provider>
)

/** Whether the current composition supplies a Grammar surface content edge and control layer. */
export const useSurfaceNesting = (): boolean => useContext(SurfaceHostContext) !== null

/** The surface that stands around the current content, or `null` on the page. */
export const useSurfaceHost = (): SurfaceHost | null => useContext(SurfaceHostContext)

const REFUSED_HOSTS: ReadonlySet<SurfaceHost> = new Set(["card", "pane", "overlay"])

/** The refusal a card raises when it would stand inside another surface (development only, like the pane refusals). */
export const assertNoSurfaceInSurface = (host: SurfaceHost | null): void => {
    if (host === null || !REFUSED_HOSTS.has(host) || process.env.NODE_ENV === "production") return
    const where = host === "card" ? "another SurfaceCard" : host === "pane" ? "a Pane surface" : "a Dialog, Drawer or Popover"
    throw new Error(`SurfaceCard stands inside ${where}: a surface never stands inside a surface. Put the content in the surface's own body, or give it a kind (bands, list, figures).`)
}

/** The field layer the surface decides: secondary inside a Grammar surface, primary on the page. */
export const useFieldVariant = (): FieldVariant => (useSurfaceNesting() ? "secondary" : "primary")

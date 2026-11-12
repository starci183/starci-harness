"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { FieldVariant } from "./leaf/Field/index.js"

/**
 * What stands around the current content.
 *
 * - `card` is a painted surface a `SurfaceCard` never stands inside (a card in a card is refused).
 * - `pane` (a `Pane surface`) and `overlay` (a `Dialog`, `Drawer` or `Popover`) are WHITE grounds: a `SurfaceCard` stands on them as a group, drawn bordered
 *   (1px, no shadow) by the SURFACE-ELEVATION rule (0.37.5; 0.37.4 threw here, against the owner's law).
 * - `chrome` is a bar or a rail that only decides the field layer; it paints no surface a card could collide with.
 * - `chat` (0.37.33) is a chat frame (`Pane content="chat"`) on the page tone `--background`: a card in it is bordered (no shadow), and a field in it (the
 *   composer) is the PRIMARY white field, whatever overlay or pane stands around the frame.
 */
export type SurfaceHost = "card" | "pane" | "overlay" | "chrome" | "chat"

const SurfaceHostContext = createContext<SurfaceHost | null>(null)

/** Supplies the nested-control layer to every child, including portalled overlay content. */
export const SurfaceNesting = ({ children, host = "chrome" }: { readonly children: ReactNode; readonly host?: SurfaceHost }) => (
    <SurfaceHostContext.Provider value={host}>{children}</SurfaceHostContext.Provider>
)

/** Whether the current composition supplies a Grammar surface content edge and control layer. */
export const useSurfaceNesting = (): boolean => useContext(SurfaceHostContext) !== null

/** The surface that stands around the current content, or `null` on the page. */
export const useSurfaceHost = (): SurfaceHost | null => useContext(SurfaceHostContext)

const REFUSED_HOSTS: ReadonlySet<SurfaceHost> = new Set(["card"])

/** The refusal a card raises when it would stand inside another card (development only). A white pane, drawer, dialog or popover hosts cards. */
export const assertNoSurfaceInSurface = (host: SurfaceHost | null): void => {
    if (host === null || !REFUSED_HOSTS.has(host) || process.env.NODE_ENV === "production") return
    throw new Error("SurfaceCard stands inside another SurfaceCard: a card never stands inside a card. Put the content in the card's own body, or give it a kind (bands, list, figures).")
}

/** The field layer the surface decides: secondary inside a Grammar surface, primary on the page and in a chat frame (the composer field stays white). */
export const useFieldVariant = (): FieldVariant => {
    const host = useSurfaceHost()
    return host !== null && host !== "chat" ? "secondary" : "primary"
}

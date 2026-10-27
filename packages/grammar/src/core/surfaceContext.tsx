"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { FieldVariant } from "./primitive/Field/index.js"

const SurfaceNestingContext = createContext(false)

/** Supplies the nested-control layer to every child, including portalled overlay content. */
export const SurfaceNesting = ({ children }: { readonly children: ReactNode }) => (
    <SurfaceNestingContext.Provider value={true}>{children}</SurfaceNestingContext.Provider>
)

/** Whether the current composition supplies a Grammar surface content edge and control layer. */
export const useSurfaceNesting = (): boolean => useContext(SurfaceNestingContext)

/** Resolve an explicit field layer, or the surface's secondary/page's primary default. */
export const useFieldVariant = (variant?: FieldVariant): FieldVariant => {
    const nested = useSurfaceNesting()
    return variant ?? (nested ? "secondary" : "primary")
}

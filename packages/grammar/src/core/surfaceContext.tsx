"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { FieldVariant } from "./leaf/Field/index.js"

const SurfaceNestingContext = createContext(false)

/** Supplies the nested-control layer to every child, including portalled overlay content. */
export const SurfaceNesting = ({ children }: { readonly children: ReactNode }) => (
    <SurfaceNestingContext.Provider value={true}>{children}</SurfaceNestingContext.Provider>
)

/** Whether the current composition supplies a Grammar surface content edge and control layer. */
export const useSurfaceNesting = (): boolean => useContext(SurfaceNestingContext)

/** The field layer the surface decides: secondary inside a Grammar surface, primary on the page. */
export const useFieldVariant = (): FieldVariant => (useSurfaceNesting() ? "secondary" : "primary")

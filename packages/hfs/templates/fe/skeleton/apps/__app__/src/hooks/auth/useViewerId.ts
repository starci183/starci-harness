"use client"

import type { ViewerId } from "@starci/next-data"
import { useAppSelector } from "@/redux"

/** The person the session belongs to: undefined until modules/auth answers, null when signed out (the viewer of @starci/next-data). */
export const useViewerId = (): ViewerId => {
    const session = useAppSelector((state) => state.session)
    if (session.status === "unknown") return undefined
    return session.session?.userId ?? null
}

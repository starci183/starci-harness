"use client"

import { useEffect, useState } from "react"

/** Under this width the page is a phone's: the graph is drawn the same, at 100%, and moved by hand (drag to pan, pinch to zoom). */
export const PHONE_WIDTH = 768

/** True while the window is narrower than a phone's width. Never true where there is no window (server, tests without one). */
export const usePhone = (): boolean => {
    const query = typeof window === "undefined" || typeof window.matchMedia !== "function" ? undefined : `(width < ${String(PHONE_WIDTH)}px)`
    const [phone, setPhone] = useState(query !== undefined && window.matchMedia(query).matches)
    useEffect(() => {
        if (query === undefined) return undefined
        const list = window.matchMedia(query)
        const read = (): void => {
            setPhone(list.matches)
        }
        read()
        list.addEventListener("change", read)
        return () => {
            list.removeEventListener("change", read)
        }
    }, [query])
    return phone
}

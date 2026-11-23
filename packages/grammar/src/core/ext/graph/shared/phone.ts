"use client"

import { useEffect, useState } from "react"

/** The width (px) under which a graph is laid out top-down so it fits a phone's width (the routing law, rule 4): the Grammar's 30rem phone step. */
export const PHONE_LAYOUT_WIDTH = 480

const QUERY = `(max-width: ${String(PHONE_LAYOUT_WIDTH - 0.02)}px)`

/** The direction a graph is laid out in on this screen: top-down under `PHONE_LAYOUT_WIDTH`, else the one the app asked for. */
export const useLayoutDirection = <D extends string>(asked: D, down: D): D => {
    const [isPhone, setPhone] = useState(false)
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
        const media = window.matchMedia(QUERY)
        const update = (): void => {
            setPhone(media.matches)
        }
        update()
        media.addEventListener("change", update)
        return () => {
            media.removeEventListener("change", update)
        }
    }, [])
    return isPhone ? down : asked
}

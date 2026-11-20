import { useEffect, useState } from "react"
import { SHOT_WIDTHS } from "../explain.ts"
import type { Width } from "../explain.ts"

import { VIEWS } from "../views.ts"
import type { View } from "../views.ts"

export type { View }
/** The pane of a narrow window, one at a time: the design, the shot, the comparison of both, the explanation. */
export type Pane = "design" | "shot" | "compare" | "explain"
export interface Route {
    readonly screen: string | null
    readonly flows: boolean
    /** The design board (PROJECT-GALLERY-9): every section of the app at 1440 and 390. */
    readonly board: boolean
    readonly width: Width
    readonly view: View
}

/** `#/<area>/<screen>?w=1440&v=side`, `#/flows` or `#/board`: the address is the state, so a screen can be linked and shared. */
export function parseHash(hash: string): Route {
    const [path = "", query = ""] = hash.replace(/^#\/?/u, "").split("?")
    const params = new URLSearchParams(query)
    const width = params.get("w")
    const view = params.get("v")
    return {
        screen: path === "" || path === "flows" || path === "board" ? null : decodeURIComponent(path),
        flows: path === "flows",
        board: path === "board",
        width: SHOT_WIDTHS.find((one) => one === width) ?? "1440",
        view: VIEWS.find((one) => one === view) ?? "side",
    }
}

export const hashOf = (route: Route): string => {
    const params = new URLSearchParams({ w: route.width, v: route.view })
    if (route.board) return "#/board"
    return route.flows ? "#/flows" : `#/${route.screen ?? ""}?${params.toString()}`
}

export function useRoute(): [Route, (next: Partial<Route>) => void] {
    const [route, setRoute] = useState(() => parseHash(window.location.hash))
    useEffect(() => {
        const sync = (): void => { setRoute(parseHash(window.location.hash)) }
        window.addEventListener("hashchange", sync)
        return () => { window.removeEventListener("hashchange", sync) }
    }, [])
    return [route, (next) => { window.location.hash = hashOf({ ...route, ...next }) }]
}

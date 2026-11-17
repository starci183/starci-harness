import { useEffect, useState } from "react"
import { SHOT_WIDTHS } from "../explain.ts"
import type { Width } from "../explain.ts"

export type View = "side" | "slider" | "shot"
export interface Route {
    readonly screen: string | null
    readonly flows: boolean
    readonly width: Width
    readonly view: View
}

/** `#/<area>/<screen>?w=1440&v=side` or `#/flows`: the address is the state, so a screen can be linked and shared. */
export function parseHash(hash: string): Route {
    const [path = "", query = ""] = hash.replace(/^#\/?/u, "").split("?")
    const params = new URLSearchParams(query)
    const width = params.get("w")
    const view = params.get("v")
    return {
        screen: path === "" || path === "flows" ? null : decodeURIComponent(path),
        flows: path === "flows",
        width: SHOT_WIDTHS.find((one) => one === width) ?? "1440",
        view: view === "slider" || view === "shot" ? view : "side",
    }
}

export const hashOf = (route: Route): string => {
    const params = new URLSearchParams({ w: route.width, v: route.view })
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

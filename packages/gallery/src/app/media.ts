import { useEffect, useState } from "react"

/** The width under which the gallery is one column and shows one pane at a time (the same step as the stylesheet's media query). */
export const NARROW_QUERY = "(max-width: 1100px)"

export function useNarrow(): boolean {
    const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
    useEffect(() => {
        const query = window.matchMedia(NARROW_QUERY)
        const sync = (): void => {
            setNarrow(query.matches)
        }
        query.addEventListener("change", sync)
        return () => {
            query.removeEventListener("change", sync)
        }
    }, [])
    return narrow
}

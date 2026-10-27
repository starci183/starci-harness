import { useEffect, useState } from "react"

/** The inline size of an element, followed as it resizes: a ref callback and the current width. */
export const useInlineSize = (): readonly [(element: HTMLDivElement | null) => void, number] => {
    const [size, setSize] = useState(0)
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    useEffect(() => {
        if (element === null) return
        const observer = new ResizeObserver(([entry]) => setSize(entry?.contentRect.width ?? 0))
        observer.observe(element)
        return () => observer.disconnect()
    }, [element])
    return [setElement, size]
}

"use client"

import { useEffect, useId, useRef } from "react"
import { SkeletonPlaceholder } from "../Skeleton/index.js"

export type TerminalProps = {
    /** The log, oldest first. Each entry is one line. */
    readonly lines: ReadonlyArray<string>
    /** A caption above the log; it also names the log region. */
    readonly title?: string
    /** Names the log when there is no `title`. */
    readonly label?: string
    /**
     * Unresolved log (knowledge STATE-8): the same frame and title; each line (three when none arrived yet) is laid out
     * unseen under a shimmer bar, so the log keeps its ready box (skeleton parity). Nothing is announced; the root is `aria-busy`.
     */
    readonly isSkeleton?: boolean
}

const LOADING_LINES: ReadonlyArray<string> = ["", "", ""]

/** Within this many pixels of the end the log counts as followed, so rounding never loses the tail. */
const FOLLOW_THRESHOLD = 8

/**
 * ATOM - `Terminal`: a dark monospace log tail. `role="log"` with `aria-live="polite"`, so new lines are announced
 * without interrupting. It follows the end as lines arrive, unless the reader has scrolled up; scrolling back to
 * the end follows again.
 */
export const Terminal = ({ lines, title, label, isSkeleton = false }: TerminalProps) => {
    const titleId = useId()
    const logRef = useRef<HTMLDivElement>(null)
    const following = useRef(true)

    useEffect(() => {
        const log = logRef.current
        if (log !== null && following.current) log.scrollTop = log.scrollHeight
    }, [lines])

    return (
        <div data-tier="atom" data-component="Terminal" className="starci-core-terminal" {...(isSkeleton ? { "data-loading": "true", "aria-busy": true } : {})}>
            {title === undefined ? null : <div id={titleId} className="starci-core-terminal-title">{title}</div>}
            <div
                ref={logRef}
                role="log"
                aria-live={isSkeleton ? "off" : "polite"}
                {...(title === undefined ? { "aria-label": label ?? "Log" } : { "aria-labelledby": titleId })}
                tabIndex={0}
                className="starci-core-terminal-log"
                onScroll={(event) => {
                    const log = event.currentTarget
                    following.current = log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_THRESHOLD
                }}
            >
                {isSkeleton
                    ? (lines.length === 0 ? LOADING_LINES : lines).map((line, index) => (
                        <div key={index} className="starci-core-terminal-line" aria-hidden="true"><SkeletonPlaceholder>{line}</SkeletonPlaceholder></div>
                    ))
                    : lines.map((line, index) => <div key={index} className="starci-core-terminal-line">{line === "" ? " " : line}</div>)}
            </div>
        </div>
    )
}

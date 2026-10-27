"use client"

import { useEffect, useId, useRef } from "react"

export type TerminalProps = {
    /** The log, oldest first. Each entry is one line. */
    readonly lines: ReadonlyArray<string>
    /** A caption above the log; it also names the log region. */
    readonly title?: string
    /** Names the log when there is no `title`. */
    readonly label?: string
}

/** Within this many pixels of the end the log counts as followed, so rounding never loses the tail. */
const FOLLOW_THRESHOLD = 8

/**
 * ATOM - `Terminal`: a dark monospace log tail. `role="log"` with `aria-live="polite"`, so new lines are announced
 * without interrupting. It follows the end as lines arrive, unless the reader has scrolled up; scrolling back to
 * the end follows again.
 */
export const Terminal = ({ lines, title, label }: TerminalProps) => {
    const titleId = useId()
    const logRef = useRef<HTMLDivElement>(null)
    const following = useRef(true)

    useEffect(() => {
        const log = logRef.current
        if (log !== null && following.current) log.scrollTop = log.scrollHeight
    }, [lines])

    return (
        <div data-tier="atom" data-component="Terminal" className="starci-core-terminal">
            {title === undefined ? null : <div id={titleId} className="starci-core-terminal-title">{title}</div>}
            <div
                ref={logRef}
                role="log"
                aria-live="polite"
                {...(title === undefined ? { "aria-label": label ?? "Log" } : { "aria-labelledby": titleId })}
                tabIndex={0}
                className="starci-core-terminal-log"
                onScroll={(event) => {
                    const log = event.currentTarget
                    following.current = log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_THRESHOLD
                }}
            >
                {lines.map((line, index) => <div key={index} className="starci-core-terminal-line">{line === "" ? " " : line}</div>)}
            </div>
        </div>
    )
}

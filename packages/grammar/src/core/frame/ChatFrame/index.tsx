"use client"

import { useCallback, useRef, type ReactNode, type Ref } from "react"
import { VerticalScrollRegionPart } from "../VerticalScrollRegion/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import { SurfaceNesting } from "../../surfaceContext.js"

export type ChatFrameProps = {
    /** The thread's accessible name (its `role="log"` region). */
    readonly label: string
    /**
     * Who the reader talks to: a `PaneHeader` (mark = Avatar, title = name, status, description = context line), and for a customer chat the owner row beneath it,
     * in one zone with no inner divider.
     */
    readonly header: ReactNode
    /** The thread: `MessageBubble`s and day `Divider`s, oldest first. */
    readonly children?: ReactNode
    /** The composer, or the decision actions. Omitted, the frame draws no footer and no line above it. */
    readonly footer?: ReactNode
    /** The element that scrolls (the thread), for jump-to-message. */
    readonly scrollRef?: Ref<HTMLDivElement>
    /** The first read of the thread has no data yet (knowledge STATE-8): the thread draws its loading structure. */
    readonly isLoading?: boolean
    /** The read failed: this takes the place of the thread's messages. Loading comes first, then error. */
    readonly error?: ErrorData
}

/** How near the foot (px) a reader counts as reading the newest message, so a new one keeps the thread at the foot. */
const FOOT_SLACK = 48

/** Hands one element to the caller's ref (a callback or an object). */
const assignRef = (ref: Ref<HTMLDivElement> | undefined, element: HTMLDivElement | null): void => {
    if (typeof ref === "function") ref(element)
    else if (ref !== null && ref !== undefined) (ref as { current: HTMLDivElement | null }).current = element
}

/** A thread opens at its newest message and follows new ones: on mount the scroller goes to its foot, and whenever its content grows while the reader was at the foot it goes there again; a reader who scrolled up stays where they are. */
const useFollowNewest = (scrollRef: Ref<HTMLDivElement> | undefined) => {
    const observer = useRef<ResizeObserver | null>(null)
    return useCallback((element: HTMLDivElement | null) => {
        assignRef(scrollRef, element)
        observer.current?.disconnect()
        observer.current = null
        if (element === null) return
        let atFoot = true
        const toFoot = () => { element.scrollTop = element.scrollHeight }
        element.addEventListener("scroll", () => { atFoot = element.scrollHeight - element.scrollTop - element.clientHeight <= FOOT_SLACK }, { passive: true })
        toFoot()
        if (typeof ResizeObserver === "undefined") return
        observer.current = new ResizeObserver(() => { if (atFoot) toFoot() })
        observer.current.observe(element)
        const content = element.firstElementChild
        if (content !== null) observer.current.observe(content)
    }, [scrollRef])
}

/**
 * The one chat frame, on any host (a `Pane content="chat"` of a PaneGrid, a `Drawer` body, a page `Section`): the header zone (who the reader talks to), one 1px
 * full-width line, the thread (the only scroller, on `--background`, opening at the newest message and following new ones while the reader is at the foot), one
 * 1px full-width line, then the footer zone (omitted with its line when `footer` is omitted). Nothing else in the frame draws a divider. The frame fills the
 * height its host gives it.
 */
export const ChatFrame = ({ label, header, children: messages, footer, scrollRef, isLoading: ownLoading, error }: ChatFrameProps) => {
    const isLoading = useIsLoading(ownLoading)
    const threadRef = useFollowNewest(scrollRef)
    const content = !isLoading && error !== undefined ? <ErrorView error={error} /> : <LoadingScope isLoading={isLoading}>{messages}</LoadingScope>
    return (
        <SurfaceNesting host="chat">
            <div
                className="starci-core-chat-frame"
                data-component="ChatFrame"
                data-tier="frame"
                data-contract="PADDING-4 GAP-2"
                data-grammar-chat-footer={footer === undefined ? "false" : "true"}
                aria-busy={isLoading ? true : undefined}
            >
                <div className="starci-core-chat-frame-header" data-grammar-chat-zone="header">{header}</div>
                <VerticalScrollRegionPart
                    aria-label={label}
                    className="starci-core-chat-frame-thread"
                    data-grammar-chat-zone="thread"
                    data-grammar-loading-region={isLoading ? "true" : undefined}
                    isScrollable
                    role="log"
                    tone="background"
                    ref={threadRef}
                >
                    <div className="starci-core-chat-frame-thread-content">{content}</div>
                </VerticalScrollRegionPart>
                {footer === undefined ? null : <div className="starci-core-chat-frame-footer" data-grammar-chat-zone="footer">{footer}</div>}
            </div>
        </SurfaceNesting>
    )
}

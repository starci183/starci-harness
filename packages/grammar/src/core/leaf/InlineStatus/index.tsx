"use client"

import type { ReactNode } from "react"
import { InlineStatusGlyph, MARK_STATE_TONE, type MarkState } from "../../statusMark.js"
import { Skeleton } from "../Skeleton/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

export type InlineStatusProps = NoChildren & {
    readonly state: MarkState
    /** The state in words, in the app's language ("Đã xong", "Đang chạy"). Required: a status is never a bare glyph. */
    readonly label: string
    /** What trails the words: a time or a short fact ("2 phút trước"). */
    readonly meta?: ReactNode
    /** Unresolved status (knowledge STATE-8): the glyph and the words as one short skeleton line. */
    readonly isLoading?: boolean
}

/**
 * LEAF - `InlineStatus`: (A) of the status-mark rule (0.55.0, owner "chốt"). A bare outline glyph (24px beside its own 14px words; 20px when it stands in a 12px line: caption, label.group, badge, code or a Badge, whose size it then takes; derived from the text, never a prop) (one of the three: circle-check done,
 * circle-x error, the plain circle waiting, skipped or not run; the circle spins while running) with its words, both in the state's tone (`text-<tone>`), with NO plate. For a status word in a
 * row or a cell, a legend, a graph edge label, and the status that trails a (B) tile in a row: glyph, then words, then time.
 * Never beside a second large circle: a row leads with one 40px tile (`IconTile state`) and this trails it.
 * Contract: TRUTH-1 (the words state the fact), A11Y-2 (the glyph is decorative).
 */
export const InlineStatus = ({ state, label, meta, isLoading: ownLoading }: InlineStatusProps) => {
    const isLoading = useIsLoading(ownLoading)
    if (isLoading) {
        return <span className="starci-core-inline-status" data-component="InlineStatus" data-tier="leaf" data-loading="true" aria-hidden="true"><Skeleton shape="text" /></span>
    }
    return (
        <span className="starci-core-inline-status" data-component="InlineStatus" data-tier="leaf" data-tone={MARK_STATE_TONE[state]} data-grammar-mark-state={state} data-contract="TRUTH-1 A11Y-2">
            <InlineStatusGlyph state={state} />
            <span className="starci-core-inline-status-label">{label}</span>
            {meta === undefined ? null : <span className="starci-core-inline-status-meta">{meta}</span>}
        </span>
    )
}

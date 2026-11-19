"use client"

import { useEffect, useRef, useState } from "react"
import { Text, type TextSize, type TextTone } from "../../leaf/Text/index.js"
import { TextAction } from "../../leaf/TextAction/index.js"
import type { NoChildren } from "../../tier.js"

export type ExpandableTextProps = NoChildren & {
    /** The copy. It is clamped to two lines; the whole text stays in the page, so a reader and a crawler get all of it. */
    readonly text: string
    /** The command that opens the clamped copy ("Xem thêm"). Shown only when the copy is longer than two lines. */
    readonly moreLabel: string
    /** The command that closes it again ("Thu gọn"). */
    readonly lessLabel: string
    readonly size?: TextSize
    readonly tone?: TextTone
}

/**
 * Body copy clamped to two lines with a "Xem thêm" command (0.48.0, _TYPOGRAPHY.md: body is clamped to 2 lines, followed by "Xem thêm" where needed).
 * The command exists only while the copy overflows its two lines; it toggles the clamp and keeps the full text in the DOM.
 */
export const ExpandableText = ({ text, moreLabel, lessLabel, size, tone }: ExpandableTextProps) => {
    const ref = useRef<HTMLSpanElement>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [isLong, setIsLong] = useState(false)
    useEffect(() => {
        const node = ref.current?.querySelector<HTMLElement>(".starci-core-text")
        if (node === null || node === undefined || isOpen) return
        setIsLong(node.scrollHeight > node.clientHeight + 1)
    }, [text, isOpen])
    return (
        <span ref={ref} className="starci-core-expandable-text" data-component="ExpandableText" data-tier="branch" data-grammar-expanded={isOpen ? "true" : "false"}>
            <Text {...(size === undefined ? {} : { size })} {...(tone === undefined ? {} : { tone })} {...(isOpen ? {} : { overflow: "clamp-2" as const })}>{text}</Text>
            {isLong || isOpen ? <TextAction appearance="inline" onPress={() => setIsOpen(!isOpen)}>{isOpen ? lessLabel : moreLabel}</TextAction> : null}
        </span>
    )
}

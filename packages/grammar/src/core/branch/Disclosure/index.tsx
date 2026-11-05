"use client"

import { useIsLoading, withRegionInert } from "../../regionScope.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { StepMark, type StepLeading } from "../../StepMark.js"
import { Disclosure as HeroDisclosure } from "@heroui/react"
import { useId, useState, type ReactNode } from "react"
import type { NoChildren } from "../../tier.js"

export type DisclosureProps = NoChildren & {
    /** The always-visible trigger text. */
    readonly title: ReactNode
    /** What the section shows when open. */
    readonly body: ReactNode
    /** A step mark at the start of the trigger row (a check, the current number, a warning triangle, a grey number); decorative, the words carry the state. */
    readonly leading?: StepLeading
    /**
     * Muted one-line text at the trailing end of the trigger row (truncated with an ellipsis), visible closed and open: a
     * count, a current value, a status. It is the trigger's accessible DESCRIPTION (`aria-describedby`), not part of its name.
     */
    readonly summary?: ReactNode
    /** Controlled expansion. Omit for uncontrolled use with `defaultExpanded`. */
    readonly isExpanded?: boolean
    readonly defaultExpanded?: boolean
    readonly onExpandedChange?: (isExpanded: boolean) => void
    readonly isDisabled?: boolean
    /** Heading level of the trigger's heading element. */
    readonly headingLevel?: 2 | 3 | 4 | 5 | 6
    /**
     * What the trigger is. `row` (default) is the full-size row of a list or a card. `quiet` is a small link-toned line with the
     * chevron before the words and the content folded under it (a note such as "Evidence (2)" that a reader may skip).
     */
    readonly kind?: "row" | "quiet"
    /**
     * The side of the chevron. `end` (default for `row`) draws it after the words; `start` draws it before them, pointing toward the
     * reading direction while closed and down when open (a source text folded under its title). A `quiet` disclosure defaults to `start`.
     */
    readonly chevron?: "start" | "end"
}

/*
 * Consumer hooks: `starci-core-disclosure-panel`, `starci-core-disclosure-body` name HeroUI parts
 * whose vendor paint Common leaves as it is. No shipped sheet paints them; the Grammar name lets a
 * consumer or family select those parts without reaching for vendor class names.
 */

/**
 * One show/hide section (the generic, unframed disclosure; `SurfaceCard kind="accordion"` is the framed
 * card form). The trigger is a real button inside a heading with `aria-expanded`/`aria-controls`;
 * `data-grammar-disclosure-state` mirrors the open state for the stylesheet.
 * Contract: root STATE-7 (controlled expansion), trigger FOCUS-1, indicator MOTION-2.
 */
const DisclosureInner = ({
    title,
    body,
    summary,
    leading,
    isExpanded,
    defaultExpanded = false,
    onExpandedChange,
    isDisabled = false,
    headingLevel = 3,
    kind = "row",
    chevron,
}: DisclosureProps) => {
    const chevronSide = chevron ?? (kind === "quiet" ? "start" : "end")
    const indicator = <HeroDisclosure.Indicator className="starci-core-disclosure-indicator" data-contract="MOTION-2" />
    const [uncontrolled, setUncontrolled] = useState(defaultExpanded)
    const expanded = isExpanded ?? uncontrolled
    const summaryId = useId()
    // A loading region keeps the title real and draws the data parts (the step mark, the end summary) as the geometry of the ready ones.
    const isLoading = useIsLoading(undefined)
    const hasSummary = summary !== undefined && summary !== null && summary !== false && summary !== ""
    return (
        <HeroDisclosure
            className="starci-core-disclosure"
            data-component="Disclosure"
            data-tier="branch"
            data-contract="STATE-7"
            data-grammar-disclosure-state={expanded ? "open" : "closed"}
            data-grammar-disclosure-kind={kind}
            data-grammar-disclosure-chevron={chevronSide}
            isDisabled={isDisabled}
            isExpanded={expanded}
            onExpandedChange={(next: boolean) => {
                if (isExpanded === undefined) setUncontrolled(next)
                onExpandedChange?.(next)
            }}
        >
            <HeroDisclosure.Heading className="starci-core-disclosure-heading" level={headingLevel}>
                <HeroDisclosure.Trigger className="starci-core-disclosure-trigger" data-contract="FOCUS-1" data-grammar-disclosure-trigger="true" {...(hasSummary ? { "aria-describedby": summaryId } : {})}>
                    {chevronSide === "start" ? indicator : null}
                    {leading === undefined ? null : isLoading
                        ? <SkeletonPlaceholder shape="circle"><StepMark state={leading.state} position={leading.position} /></SkeletonPlaceholder>
                        : <StepMark state={leading.state} position={leading.position} />}
                    <span className="starci-core-disclosure-title">{title}</span>
                    {hasSummary ? <span id={summaryId} aria-hidden="true" className="starci-core-disclosure-summary" data-grammar-disclosure-summary="true">{isLoading ? <SkeletonPlaceholder>{summary}</SkeletonPlaceholder> : summary}</span> : null}
                    {chevronSide === "end" ? indicator : null}
                </HeroDisclosure.Trigger>
            </HeroDisclosure.Heading>
            <HeroDisclosure.Content className="starci-core-disclosure-panel" data-grammar-disclosure-panel="true">
                <HeroDisclosure.Body className="starci-core-disclosure-body">{body}</HeroDisclosure.Body>
            </HeroDisclosure.Content>
        </HeroDisclosure>
    )
}

/**
 * One show/hide section (the generic, unframed disclosure; `SurfaceCard kind="accordion"` is the framed
 * card form). The trigger is a real button inside a heading with `aria-expanded`/`aria-controls`;
 * `data-grammar-disclosure-state` mirrors the open state for the stylesheet.
 * Contract: root STATE-7 (controlled expansion), trigger FOCUS-1, indicator MOTION-2.
 */
export const Disclosure = withRegionInert(DisclosureInner)

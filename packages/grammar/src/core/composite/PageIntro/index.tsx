"use client"

import type { ReactNode } from "react"
import { Heading } from "../../leaf/Heading/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** One muted fact line of an intro (an address, opening hours), with an optional glyph. */
export type PageIntroLine = {
    readonly id: string
    readonly text: string
    readonly icon?: IconSource
}

export type PageIntroProps = NoChildren & {
    /** The identity the page is about (a shop, a workspace, a job). It is the page's heading. */
    readonly title: string
    /** `1` when this is the page's heading (default), `2` under another heading. */
    readonly headingLevel?: 1 | 2
    /** The identity mark left of the title: an `Avatar` (`tone="accent"` for a brand mark) or an `IconTile`. */
    readonly mark?: ReactNode
    /** Muted fact lines under the title (address, hours), each one line. */
    readonly lines?: ReadonlyArray<PageIntroLine>
    /** One supporting sentence under the lines. */
    readonly description?: string
    /** The identity is unresolved (STATE-8): the same lines laid out unseen under a shimmer; a loading region is inherited. */
    readonly isLoading?: boolean
}

/**
 * The plain heading block of a public page: a mark, the title, fact lines and one sentence, floating on the page ground with no band,
 * surface or rule (a booking page's shop identity beside its card). A page that heads a console region uses `Page`'s `header`.
 */
export const PageIntro = ({ title, headingLevel = 1, mark, lines = [], description, isLoading: ownLoading }: PageIntroProps) => {
    const isLoading = useIsLoading(ownLoading)
    return (
        <div data-tier="composite" data-component="PageIntro" data-contract="GAP-3" className="starci-core-page-intro" {...(isLoading ? { "data-loading": "true" } : {})}>
            {mark === undefined ? null : <span className="starci-core-page-intro-mark" aria-hidden={isLoading || undefined}>{mark}</span>}
            <div className="starci-core-page-intro-copy" data-contract="GAP-1">
                <Heading level={headingLevel} isLoading={isLoading}>{title}</Heading>
                {lines.map((line) => (
                    <Text key={line.id} size="xs" tone="muted" isLoading={isLoading} startContent={line.icon === undefined ? undefined : <Icon source={line.icon} usage="leading" />}>{line.text}</Text>
                ))}
                {description === undefined ? null : <Text size="sm" tone="muted" isLoading={isLoading}>{description}</Text>}
            </div>
        </div>
    )
}

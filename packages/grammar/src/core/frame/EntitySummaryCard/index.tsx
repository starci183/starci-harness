"use client"

import type { ReactNode } from "react"
import { AgentName } from "../../leaf/AgentName/index.js"
import { InlineStatus } from "../../leaf/InlineStatus/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { AvatarGroup, type AvatarGroupItem } from "../../composite/AvatarGroup/index.js"
import { SurfaceCard } from "../SurfaceCard/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { MarkState } from "../../statusMark.js"
import type { NoChildren } from "../../tier.js"

/** Which way a figure moved since the last period, and which way is good for the business (fewer complaints is good). */
export type EntitySummaryDelta = {
    /** The change in words, in the app's language ("+12% so với tuần trước"). */
    readonly text: string
    readonly direction: "up" | "down" | "flat"
    readonly goodWhen: "up" | "down"
}

/** One business figure of the period: its plain label ("Đơn chốt"), its value and, optionally, its change. */
export type EntitySummaryFigure = {
    readonly label: string
    readonly value: ReactNode
    readonly delta?: EntitySummaryDelta
}

/** A group of channels or people on the card: a round AvatarGroup with "+N". */
export type EntitySummaryGroup = {
    readonly label: string
    readonly items: ReadonlyArray<AvatarGroupItem>
    readonly overflowLabel: (hiddenCount: number) => string
    readonly max?: number
}

export type EntitySummaryCardProps = NoChildren & {
    /** The entity's name (an agent, a shop, a channel). */
    readonly name: string
    /** The entity is an AI agent: the AgentName Chip follows the name. */
    readonly isAgent?: boolean
    readonly agentLabel?: string
    /** One plain sentence: what it does for the business (an agent's `role`). Never a trigger kind, a provider key or a step chain. */
    readonly role?: string
    /** The status at the head's top end, as an inline status (A): glyph and words. */
    readonly status: { readonly state: MarkState; readonly label: string }
    /** The heading of the figures, in the app's language ("Tuần này"). */
    readonly periodLabel: string
    /**
     * EXACTLY three business figures of the period (the owner's law: "agent nào cũng có 3 chỉ số tuần này"): results the owner asks about, never run or
     * workflow counts. The tuple type refuses two or four.
     */
    readonly figures: readonly [EntitySummaryFigure, EntitySummaryFigure, EntitySummaryFigure]
    /** At most ONE line for what needs the reader ("3 khách chờ bạn duyệt"): a waiting (or error) inline status. The whole card is the way there. */
    readonly needsYou?: { readonly label: string; readonly state?: "waiting" | "error" }
    readonly channels?: EntitySummaryGroup
    readonly people?: EntitySummaryGroup
    /** The whole card is one link, to the entity's page. */
    readonly href: string
    /** The link's name for assistive technology ("Mở Sales AI"). */
    readonly linkLabel: string
    /** First read (knowledge STATE-8): every slot is skeleton, no real label and no figure. */
    readonly isLoading?: boolean
}

const deltaTone = ({ direction, goodWhen }: EntitySummaryDelta): "success" | "danger" | "neutral" => direction === "flat" ? "neutral" : direction === goodWhen ? "success" : "danger"

const Group = ({ group }: { readonly group: EntitySummaryGroup }) => (
    <AvatarGroup
        label={group.label}
        items={group.items}
        overflowLabel={group.overflowLabel}
        size="sm"
        hasMemberList={false}
        {...(group.max === undefined ? {} : { max: group.max })}
    />
)

/**
 * COMPOSITE - `EntitySummaryCard` (0.55.0, contexts/ui/situations.md "an entity summary card", contexts/ui/content.md): the owner-facing summary of
 * one entity, built for the owner's business questions (results, what needs me, who). The head holds the name, the AgentName Chip and the status
 * (A); then the role sentence; then the period heading with exactly three business figures; at most one "needs you" line; the channel and the
 * people groups (round AvatarGroups with "+N"). The whole card is one link (`SurfaceCard wholeAction`): it holds no control of its own.
 * An app never composes a summary card from Text and Stack (the "hand-composed" lens).
 * Contract: SURFACE-4 (one destination), TRUTH-1 (the status and the deltas say the fact in words), HIERARCHY-3.
 */
export const EntitySummaryCard = (props: EntitySummaryCardProps) => {
    const isLoading = useIsLoading(props.isLoading)
    const { name, isAgent = false, agentLabel, role, status, periodLabel, figures, needsYou, channels, people, href, linkLabel } = props
    return (
        <SurfaceCard {...(isLoading ? {} : { ariaLabel: name })} wholeAction={{ kind: "link", href, label: linkLabel }} isLoading={isLoading}>
            <div className="starci-core-entity-summary" data-component="EntitySummaryCard" data-tier="frame" data-contract="HIERARCHY-3 TRUTH-1" data-loading={String(isLoading)} {...(isLoading ? { "aria-hidden": true } : {})}>
                <div className="starci-core-entity-summary-head" data-grammar-entity-slot="head">
                    <span className="starci-core-entity-summary-name">{isLoading ? <Skeleton shape="text" /> : <AgentName name={name} isAgent={isAgent} {...(agentLabel === undefined ? {} : { agentLabel })} />}</span>
                    <InlineStatus state={status.state} label={status.label} isLoading={isLoading} />
                </div>
                {role === undefined ? null : <p className="starci-core-entity-summary-role" data-grammar-entity-slot="role">{isLoading ? <Skeleton shape="text" /> : role}</p>}
                <div className="starci-core-entity-summary-period" data-grammar-entity-slot="figures">
                    <p className="starci-core-entity-summary-period-label">{isLoading ? <Skeleton shape="text" /> : periodLabel}</p>
                    <dl className="starci-core-entity-summary-figures">
                        {figures.map((figure, index) => (
                            <div key={index} className="starci-core-entity-summary-figure">
                                <dt className="starci-core-entity-summary-figure-label">{isLoading ? <Skeleton shape="text" /> : figure.label}</dt>
                                <dd className="starci-core-entity-summary-figure-value">{isLoading ? <Skeleton shape="text" /> : figure.value}</dd>
                                {figure.delta === undefined ? null : (
                                    <dd className="starci-core-entity-summary-figure-delta" data-tone={isLoading ? "neutral" : deltaTone(figure.delta)}>{isLoading ? <Skeleton shape="text" /> : figure.delta.text}</dd>
                                )}
                            </div>
                        ))}
                    </dl>
                </div>
                {needsYou === undefined ? null : (
                    <div className="starci-core-entity-summary-needs" data-grammar-entity-slot="needs-you">
                        <InlineStatus state={needsYou.state ?? "waiting"} label={needsYou.label} isLoading={isLoading} />
                    </div>
                )}
                {channels === undefined && people === undefined ? null : (
                    <div className="starci-core-entity-summary-groups" data-grammar-entity-slot="groups">
                        {channels === undefined ? null : isLoading ? <Skeleton shape="circle" size="sm" /> : <Group group={channels} />}
                        {people === undefined ? null : isLoading ? <Skeleton shape="circle" size="sm" /> : <Group group={people} />}
                    </div>
                )}
            </div>
        </SurfaceCard>
    )
}

export const ENTITY_SUMMARY_FIGURE_COUNT = 3

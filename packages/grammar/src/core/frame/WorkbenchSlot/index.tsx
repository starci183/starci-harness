"use client"

import type { ReactNode } from "react"
import { Heading } from "../../leaf/Heading/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading } from "../../regionScope.js"

/** What the slot says when the agent's pack ships no workbench of its own. */
export type WorkbenchSlotEmpty = {
    /** The plain statement, e.g. "This agent has no workbench yet". */
    readonly title: string
    /** Why, and what the agent does meanwhile, e.g. "The pack made no screen for it. The agent still works; here is what it did lately." */
    readonly description: string
}

export type WorkbenchSlotProps = {
    /** Names the region for assistive technology, e.g. "Workbench of Ads". */
    readonly label: string
    /**
     * The pack ships no workbench for this agent: the slot says so, in words, ahead of `children` (the fallback content, e.g. its recent runs). Never a blank page and never a lie that
     * the agent has nothing: a workbench-less agent is a working agent.
     */
    readonly empty?: WorkbenchSlotEmpty
    /** The workbench the pack draws, or, with `empty`, what stands in its place. */
    readonly children?: ReactNode
    /** The first read has no data yet: the slot keeps its place and its content draws as its own loading geometry. */
    readonly isLoading?: boolean
}

/**
 * FRAME - `WorkbenchSlot`: the first tab of an agent, the region its pack fills with its own workbench (what it spent, what it waits on, what it booked). It owns the one thing every
 * agent shares: the region, its name, and the empty state when the pack ships none, which opens with a plain sentence and then shows the fallback the app gives it.
 */
export const WorkbenchSlot = ({ label, empty, children, isLoading: ownLoading }: WorkbenchSlotProps) => {
    const isLoading = useIsLoading(ownLoading)
    return (
        <section
            data-tier="frame"
            data-component="WorkbenchSlot"
            data-contract="STATE-8"
            className="starci-core-workbench-slot"
            aria-label={label}
            data-grammar-workbench-state={empty === undefined ? "ready" : "empty"}
            {...(isLoading ? { "aria-busy": true } : {})}
        >
            {empty === undefined ? null : (
                <div className="starci-core-workbench-empty">
                    <Heading level={2} isLoading={isLoading}>{empty.title}</Heading>
                    <Text tone="muted" isLoading={isLoading}>{empty.description}</Text>
                </div>
            )}
            {children}
        </section>
    )
}

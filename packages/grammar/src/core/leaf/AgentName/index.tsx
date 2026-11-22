"use client"

import type { ReactNode } from "react"
import { Badge } from "../Badge/index.js"
import type { NoChildren } from "../../tier.js"

export type AgentNameProps = NoChildren & {
    /** The name, as the slot draws it (a title, a heading, the sender's name). */
    readonly name: ReactNode
    /** The name belongs to an AI agent: a small neutral "AI" Chip follows it. Without it the name is drawn alone. */
    readonly isAgent?: boolean
    /** The Chip's word, in the app's language; "AI" when omitted. */
    readonly agentLabel?: string
}

/**
 * A name and, for an agent, the small neutral "AI" Chip right after it (owner 2026-11-22: the badge belongs after the name, never on the avatar). The one place the
 * Chip is placed: a slot that names someone takes `isAgent` and draws this, so an app never places the Chip by hand.
 * Contract: TRUTH-1 (the Chip states the fact in words, neutral tone).
 */
export const AgentName = ({ name, isAgent = false, agentLabel = "AI" }: AgentNameProps) => isAgent ? (
    <span className="starci-core-agent-name" data-component="AgentName" data-tier="leaf" data-grammar-agent="true">
        {name}
        <Badge>{agentLabel}</Badge>
    </span>
) : <>{name}</>

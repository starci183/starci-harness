"use client"

import { createElement as h, type ReactElement, type ReactNode } from "react"
import { Badge, Cluster, Drawer, InlineStatus, Section, Stack } from "../../index.js"
import { markState, normalizeStatus } from "./shared/status.js"
import type { FlowStatusInput } from "./types.js"

/**
 * The five parts a step's drawer can show, always in this order: what came `in`, the `code` that ran, the `mutation` it wrote into the run's state, what
 * went `out`, and the `state` the whole run shares. The titles are the app's words ("Data in", "Code chạy", "Mutation: ghi vào state", "Data out",
 * "State chung của run").
 */
export const FLOW_STEP_PARTS = ["in", "code", "mutation", "out", "state"] as const
export type FlowStepPart = (typeof FLOW_STEP_PARTS)[number]

/** One part of a step's drawer: its title (the app's words) and what it holds (the app's blocks: a `CodeBlock`, a key-value `Section` list, a JSON view). */
export interface FlowStepSection {
    readonly part: FlowStepPart
    readonly title: string
    readonly children: ReactNode
    /** One muted line under the part's body: where the data comes from, its size. */
    readonly caption?: string
}

export interface FlowStepDrawerProps {
    /** Open while a step is open; `onOpenChange(false)` when the person closes it (the close button, Escape, a press outside). */
    readonly isOpen: boolean
    readonly onOpenChange: (isOpen: boolean) => void
    /** The step's name: the drawer's heading and its accessible name. */
    readonly title: string
    /** The version of the step's code ("v2.1"), a badge under the title. */
    readonly version?: string
    /** The step's state in the run and its word (the graph's `statusLabels`). */
    readonly status?: { readonly state: FlowStatusInput; readonly label: string }
    /** The step's mark before the title (its icon tile). */
    readonly leading?: ReactNode
    readonly closeLabel: string
    /** The parts the app has for this step; any may be left out. They are drawn in the order of `FLOW_STEP_PARTS`, whatever order they are given in. */
    readonly sections: readonly FlowStepSection[]
    /** The parts are still loading: each draws as its ready box, with its real title. */
    readonly isLoading?: boolean
}

/**
 * The drawer a `FlowGraph` step opens (`onNodeOpen`): a wide right-side `Drawer` with the step's name, its version badge and state, then its parts in one
 * fixed order (data in, the code that ran, the mutation it wrote, data out, the run's shared state), each a titled `Section`. The app fills every part;
 * the Grammar only lays them out, so every flow screen reads a step the same way.
 */
export const FlowStepDrawer = ({ isOpen, onOpenChange, title, version, status, leading, closeLabel, sections, isLoading = false }: FlowStepDrawerProps): ReactElement => {
    const ordered = FLOW_STEP_PARTS.flatMap((part) => sections.filter((section) => section.part === part))
    const facts =
        version === undefined && status === undefined
            ? undefined
            : h(Cluster, {
                  gap: "inline",
                  children: [
                      version === undefined ? null : h(Badge, { key: "version", tone: "accent" }, version),
                      status === undefined ? null : h(InlineStatus, { key: "status", state: markState(normalizeStatus(status.state)), label: status.label }),
                  ],
              })
    return h(
        Drawer,
        { isOpen, onOpenChange, title, closeLabel, placement: "right", width: "wide", isLoading, ...(facts === undefined ? {} : { description: facts }), ...(leading === undefined ? {} : { leading }) },
        h(Stack, {
            gap: "section",
            children: ordered.map((section) =>
                h("div", { key: section.part, "data-flow-step-part": section.part }, h(Section, { title: section.title, children: section.children, ...(section.caption === undefined ? {} : { caption: section.caption }) })),
            ),
        }),
    )
}

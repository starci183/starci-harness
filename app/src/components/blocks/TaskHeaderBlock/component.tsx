import { Breadcrumbs, Divider, Region, SectionHeader, Text } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/** The task's header facts, resolved for drawing. */
export interface TaskHeaderView {
    readonly workflow: string
    readonly workflowHref: string
    readonly title: string
    readonly state: ToneLabel
    /** How long the live attempt has run; null when the task is not running. */
    readonly elapsed: string | null
}

/** Complete input of TaskHeaderBlockBase. */
export interface TaskHeaderBlockBaseProps {
    readonly props: {
        readonly task: string
        readonly header: DataSlot<TaskHeaderView>
        readonly labels: { readonly trail: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

const HEADER_PLACEHOLDER: TaskHeaderView = {
    workflow: " ",
    workflowHref: "/",
    title: " ",
    state: { label: " ", tone: "neutral" },
    elapsed: null,
}

/**
 * Pure half: the page header band (where the task sits, its title, state, id and the live attempt's elapsed time) closed
 * by a full-width separator. It is the one block the Grammar's PageHeader replaces.
 */
export const TaskHeaderBlockBase = (props: TaskHeaderBlockBaseProps) => {
    const { labels, task } = props.props
    return (
        <div className="app-stack">
            <Region label={labels.trail}>
                <SlotView slot={props.props.header} placeholder={HEADER_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                    {(header, isSkeleton) => (
                        <div className="app-pair">
                            <Breadcrumbs
                                label={labels.trail}
                                items={[
                                    { id: "workflow", label: header.workflow, href: header.workflowHref, ...(isSkeleton ? { isSkeleton: true as const } : {}) },
                                    { id: "task", label: task },
                                ]}
                            />
                            <SectionHeader
                                level={1}
                                title={header.title}
                                isSkeleton={isSkeleton}
                                description={
                                    <span className="app-row">
                                        <StatusWord status={header.state} />
                                        {header.elapsed === null ? null : (
                                            <Text as="span" size="sm" tone="muted" tabular>
                                                {header.elapsed}
                                            </Text>
                                        )}
                                    </span>
                                }
                            />
                        </div>
                    )}
                </SlotView>
            </Region>
            <Divider />
        </div>
    )
}

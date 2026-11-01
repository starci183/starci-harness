import { Page } from "@starci/grammar/core"
import type { ReactNode } from "react"
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

/** Complete input of TaskPageBlockBase. */
export interface TaskPageBlockBaseProps {
    readonly props: {
        readonly task: string
        readonly header: DataSlot<TaskHeaderView>
        readonly labels: { readonly trail: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
    /** The page body, below the header. */
    readonly body: ReactNode
}

const HEADER_PLACEHOLDER: TaskHeaderView = {
    workflow: " ",
    workflowHref: "/",
    title: " ",
    state: { label: " ", tone: "neutral" },
    elapsed: null,
}

/**
 * Pure half: the route Page, headed by where the task sits, its title, its state and the live attempt's elapsed time,
 * around the page body. The task id is the last crumb.
 */
export const TaskPageBlockBase = (props: TaskPageBlockBaseProps) => {
    const { labels, task } = props.props
    return (
        <SlotView
            slot={props.props.header}
            placeholder={HEADER_PLACEHOLDER}
            labels={labels.slot}
            frame={(notice) => (
                <Page measure="full">
                    {notice}
                    {props.body}
                </Page>
            )}
            onRetry={props.on.retry} render={(header, isSkeleton) => (
                <Page
                    measure="full"
                    isSkeleton={isSkeleton}
                    header={{
                        breadcrumbs: {
                            label: labels.trail,
                            items: [
                                { id: "workflow", label: header.workflow, href: header.workflowHref, ...(isSkeleton ? { isSkeleton: true as const } : {}) },
                                { id: "task", label: task },
                            ],
                        },
                        title: header.title,
                        status: <StatusWord status={header.state} />,
                        ...(header.elapsed === null ? {} : { meta: header.elapsed }),
                    }}
                >
                    {props.body}
                </Page>
            )} />
    )
}

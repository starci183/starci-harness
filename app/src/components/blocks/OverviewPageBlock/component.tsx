import { PlusIcon } from "@heroicons/react/20/solid"
import { Button, Icon, Page } from "@starci/grammar/core"
import type { ReactNode } from "react"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Copy the connected header resolves. */
export interface OverviewPageBlockLabels {
    readonly title: string
    readonly newWorkflow: string
    readonly newWorkflowReason: string
    readonly slot: SlotLabels
}

/** Complete input of OverviewPageBlockBase. */
export interface OverviewPageBlockBaseProps {
    readonly props: {
        /** The live counts line: projects, active workflows, running Ops. */
        readonly counts: DataSlot<string>
        readonly labels: OverviewPageBlockLabels
    }
    readonly on: { readonly retry: () => void }
    /** The page body, below the header. */
    readonly children: ReactNode
}

const COUNTS_PLACEHOLDER = " "

/**
 * Pure half: the route Page, headed by the title, the live counts and the not-yet-wired new-workflow action, around the page body. The title stays when the counts
 * read fails; only the counts line carries the notice and its retry.
 */
export const OverviewPageBlockBase = (props: OverviewPageBlockBaseProps) => {
    const { labels, counts } = props.props
    return (
        <Page
            measure="full"
            isSkeleton={counts.isLoading === true}
            header={{
                title: labels.title,
                description: (
                    <SlotView slot={counts} placeholder={COUNTS_PLACEHOLDER} labels={labels.slot} forbidden="hide" onRetry={props.on.retry}>
                        {(line) => line}
                    </SlotView>
                ),
                actions: (
                    <Button
                        intent="commit"
                        isDisabled
                        disabledReason={labels.newWorkflowReason}
                        startContent={<Icon source={PlusIcon} usage="leading" />}
                    >
                        {labels.newWorkflow}
                    </Button>
                ),
            }}
        >
            {props.children}
        </Page>
    )
}

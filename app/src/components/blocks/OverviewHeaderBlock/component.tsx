import { PlusIcon } from "@heroicons/react/20/solid"
import { Button, Icon, PageHeader } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Copy the connected header resolves. */
export interface OverviewHeaderBlockLabels {
    readonly title: string
    readonly newWorkflow: string
    readonly newWorkflowReason: string
    readonly slot: SlotLabels
}

/** Complete input of OverviewHeaderBlockBase. */
export interface OverviewHeaderBlockBaseProps {
    readonly props: {
        /** The live counts line: projects, active workflows, running Ops. */
        readonly counts: DataSlot<string>
        readonly labels: OverviewHeaderBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const COUNTS_PLACEHOLDER = " "

/**
 * Pure half: the page header (title, live counts, the not-yet-wired new-workflow action). The title stays when the counts
 * read fails; only the counts line carries the notice and its retry.
 */
export const OverviewHeaderBlockBase = (props: OverviewHeaderBlockBaseProps) => {
    const { labels, counts } = props.props
    return (
        <PageHeader
            title={labels.title}
            measure="full"
            isSkeleton={counts.isLoading === true}
            description={
                <SlotView slot={counts} placeholder={COUNTS_PLACEHOLDER} labels={labels.slot} forbidden="hide" onRetry={props.on.retry}>
                    {(line) => line}
                </SlotView>
            }
            actions={
                <Button
                    intent="commit"
                    isDisabled
                    disabledReason={labels.newWorkflowReason}
                    startContent={<Icon source={PlusIcon} usage="leading" />}
                >
                    {labels.newWorkflow}
                </Button>
            }
        />
    )
}

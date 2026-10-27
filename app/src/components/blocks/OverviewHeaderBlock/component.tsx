import { PlusIcon } from "@heroicons/react/20/solid"
import { Button, Icon, SectionHeader } from "@starci/grammar/core"
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

const COUNTS_PLACEHOLDER = " "

/** Pure half: the page title, the live counts and the (not yet wired) new-workflow action. */
export const OverviewHeaderBlockBase = (props: OverviewHeaderBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SlotView slot={props.props.counts} placeholder={COUNTS_PLACEHOLDER} labels={labels.slot} forbidden="hide" onRetry={props.on.retry}>
            {(counts, isSkeleton) => (
                <SectionHeader
                    level={1}
                    title={labels.title}
                    description={counts}
                    isSkeleton={isSkeleton}
                    action={
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
            )}
        </SlotView>
    )
}

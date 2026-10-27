import { PlusIcon } from "@heroicons/react/20/solid"
import { Button, Icon, SectionHeader, Tooltip } from "@starci/grammar/core"
import type { Overview } from "@contract"
import { OVERVIEW } from "../../app/labels"
import { overviewCounts } from "./format"

interface OverviewHeaderProps {
    readonly overview?: Overview
    readonly isLoading: boolean
}

/** Page title, live counts and the (not yet wired) new-workflow action; the sidebar footer carries the host's watch and tick. */
export const OverviewHeader = ({ overview, isLoading }: OverviewHeaderProps) => (
    <SectionHeader
        level={1}
        title={OVERVIEW.title}
        description={overview === undefined ? undefined : overviewCounts(overview)}
        isSkeleton={isLoading}
        action={
            <Tooltip content={OVERVIEW.newWorkflowHint}>
                <Button intent="commit" isDisabled startContent={<Icon source={PlusIcon} usage="leading" />}>
                    {OVERVIEW.newWorkflow}
                </Button>
            </Tooltip>
        }
    />
)

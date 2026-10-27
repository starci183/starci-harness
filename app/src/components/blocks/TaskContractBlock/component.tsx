import { DescriptionList, SurfaceCard, TagGroup, Text } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { KeyList } from "../../leaves/KeyList"

/** A task's contract, resolved for drawing. */
export interface TaskContractView {
    readonly summary: string
    readonly allowPaths: readonly string[]
    readonly dependsOn: readonly string[]
    readonly record: readonly string[]
    readonly step: readonly string[]
}

/** Copy the connected block resolves. */
export interface TaskContractBlockLabels {
    readonly title: string
    readonly allowPaths: string
    readonly anyPath: string
    readonly deps: string
    readonly record: string
    readonly step: string
    readonly none: string
    readonly slot: SlotLabels
}

/** Complete input of TaskContractBlockBase. */
export interface TaskContractBlockBaseProps {
    readonly props: {
        readonly contract: DataSlot<TaskContractView>
        readonly labels: TaskContractBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const CONTRACT_PLACEHOLDER: TaskContractView = { summary: "", allowPaths: [], dependsOn: [], record: [], step: [] }

/** Pure half: what the Op must do, where it may write, what it waits on, and where it records. */
export const TaskContractBlockBase = (props: TaskContractBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView slot={props.props.contract} placeholder={CONTRACT_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false}>
                {(contract, isSkeleton) => (
                    <div className="app-stack">
                        <Text isSkeleton={isSkeleton}>{contract.summary}</Text>
                        <TagGroup
                            label={labels.allowPaths}
                            size="sm"
                            items={contract.allowPaths.map((path) => ({ id: path, label: path }))}
                            emptyContent={
                                <Text size="sm" tone="muted" isSkeleton={isSkeleton}>
                                    {labels.anyPath}
                                </Text>
                            }
                        />
                        <DescriptionList
                            isDivided
                            isLoading={isSkeleton}
                            items={[
                                { id: "deps", term: labels.deps, description: <KeyList keys={contract.dependsOn} noneLabel={labels.none} /> },
                                { id: "record", term: labels.record, description: <KeyList keys={contract.record} noneLabel={labels.none} /> },
                                { id: "step", term: labels.step, description: <KeyList keys={contract.step} noneLabel={labels.none} /> },
                            ]}
                        />
                    </div>
                )}
            </SlotView>
        </SurfaceCard>
    )
}

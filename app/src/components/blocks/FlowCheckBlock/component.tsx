import { ExclamationTriangleIcon } from "@heroicons/react/24/outline"
import { Alert, FencedCodeBlock, Icon, ListRow, SurfaceCard, SurfaceListCard, Text } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** The lanes' flow and what the flow check found. */
export interface FlowCheckView {
    readonly flow: readonly string[]
    readonly problems: readonly string[]
    readonly problemsTitle: string
}

/** Copy the connected block resolves. */
export interface FlowCheckBlockLabels {
    readonly title: string
    readonly code: string
    readonly noLanes: string
    readonly clean: string
    readonly cleanHint: string
    readonly slot: SlotLabels
}

/** Complete input of FlowCheckBlockBase. */
export interface FlowCheckBlockBaseProps {
    readonly props: {
        readonly check: DataSlot<FlowCheckView>
        readonly labels: FlowCheckBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const CHECK_PLACEHOLDER: FlowCheckView = { flow: [], problems: [], problemsTitle: "" }

/** Pure half: the lanes' flow as code, then a clean verdict or each flow problem. */
export const FlowCheckBlockBase = (props: FlowCheckBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView slot={props.props.check} placeholder={CHECK_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false}>
                {(check, isSkeleton) => (
                    <div className="app-stack">
                        {check.flow.length === 0 ? (
                            <Text size="sm" tone="muted" isSkeleton={isSkeleton}>
                                {labels.noLanes}
                            </Text>
                        ) : (
                            <FencedCodeBlock label={labels.code} code={check.flow.join("\n")} />
                        )}
                        {check.problems.length === 0 ? (
                            // A verdict has nowhere to go before the check answers (LOADING-5); the Alert has no resting shape.
                            isSkeleton ? null : <Alert tone="affirmative" appearance="soft" title={labels.clean} description={labels.cleanHint} />
                        ) : (
                            <SurfaceListCard label={check.problemsTitle} headingLevel={3} depth="nested">
                                {check.problems.map((problem) => (
                                    <ListRow key={problem} title={problem} state="negative" leading={<Icon source={ExclamationTriangleIcon} usage="leading" />} />
                                ))}
                            </SurfaceListCard>
                        )}
                    </div>
                )}
            </SlotView>
        </SurfaceCard>
    )
}

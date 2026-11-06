import { DescriptionList, Stack, SurfaceCard, Text, Timeline } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Why the router chose this model, resolved for drawing. */
export interface TaskRouteView {
    readonly steps: readonly { readonly id: string; readonly step: string; readonly detail: string }[]
    readonly model: string
    readonly effort: string
    readonly by: string
}

/** Copy the connected block resolves. */
export interface TaskRouteBlockLabels {
    readonly title: string
    readonly steps: string
    readonly chosen: string
    readonly model: string
    readonly effort: string
    readonly by: string
    readonly slot: SlotLabels
}

/** Complete input of TaskRouteBlockBase. */
export interface TaskRouteBlockBaseProps {
    readonly props: {
        readonly route: DataSlot<TaskRouteView>
        /** The route tier; empty until the read answers. */
        readonly fact: string
        readonly labels: TaskRouteBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const ROUTE_PLACEHOLDER: TaskRouteView = {
    steps: ["r0", "r1", "r2"].map((id) => ({ id, step: "", detail: "" })),
    model: "",
    effort: "",
    by: "",
}

/** Pure half: the router's steps, then the member it chose. */
export const TaskRouteBlockBase = (props: TaskRouteBlockBaseProps) => {
    const { labels, fact } = props.props
    return (
        <SlotView slot={props.props.route} placeholder={ROUTE_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false} render={(route, isLoading) => (
                <SurfaceCard
                    label={labels.title}
                    headingLevel={2}
                    isLoading={isLoading}
                    {...(fact === "" ? {} : { fact })}
                    headers={[
                        {
                            kind: "custom",
                            children: (
                                <Timeline
                                    label={labels.steps}
                                    items={isLoading ? [] : route.steps.map((step) => ({ id: step.id, title: step.step, description: step.detail }))}
                                    isLoading={isLoading}
                                />
                            ),
                        },
                    ]}
                >
                    <Stack gap="identity">
                        <Text size="sm" tone="muted" isLoading={isLoading}>
                            {labels.chosen}
                        </Text>
                        <DescriptionList
                            layout="stacked"
                            isDivided
                            isLoading={isLoading}
                            items={[
                                { id: "model", term: labels.model, description: route.model },
                                { id: "effort", term: labels.effort, description: route.effort },
                                { id: "by", term: labels.by, description: route.by },
                            ]}
                        />
                    </Stack>
                </SurfaceCard>
            )} />
    )
}

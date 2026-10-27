import { DescriptionList, SurfaceCard, Timeline } from "@starci/grammar/core"
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
        <SurfaceCard label={labels.title} headingLevel={2} {...(fact === "" ? {} : { fact })}>
            <SlotView slot={props.props.route} placeholder={ROUTE_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false}>
                {(route, isSkeleton) => (
                    <div className="app-stack">
                        <Timeline
                            label={labels.steps}
                            items={isSkeleton ? [] : route.steps.map((step) => ({ id: step.id, title: step.step, description: step.detail }))}
                            isLoading={isSkeleton}
                            loadingRows={route.steps.length}
                        />
                        <SurfaceCard label={labels.chosen} headingLevel={3} state="informative">
                            <DescriptionList
                                layout="stacked"
                                isDivided
                                isLoading={isSkeleton}
                                items={[
                                    { id: "model", term: labels.model, description: route.model },
                                    { id: "effort", term: labels.effort, description: route.effort },
                                    { id: "by", term: labels.by, description: route.by },
                                ]}
                            />
                        </SurfaceCard>
                    </div>
                )}
            </SlotView>
        </SurfaceCard>
    )
}

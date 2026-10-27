import { SurfaceCard, Timeline, type PresentationState } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One attempt, newest first, resolved for drawing. */
export interface AttemptView {
    readonly id: string
    readonly title: string
    readonly outcome: string
    readonly at: string
    readonly timeLabel: string
    readonly state: PresentationState
}

/** Complete input of TaskAttemptsBlockBase. */
export interface TaskAttemptsBlockBaseProps {
    readonly props: {
        readonly attempts: DataSlot<readonly AttemptView[]>
        readonly labels: { readonly title: string; readonly list: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

const ATTEMPTS_PLACEHOLDER: readonly AttemptView[] = ["a0", "a1"].map((id) => ({
    id,
    title: "",
    outcome: "",
    at: "",
    timeLabel: "",
    state: "neutral",
}))

/** Pure half: every attempt of the task, the current one first. */
export const TaskAttemptsBlockBase = (props: TaskAttemptsBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView slot={props.props.attempts} placeholder={ATTEMPTS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(attempts, isSkeleton) => (
                    <Timeline
                        label={labels.list}
                        items={
                            isSkeleton
                                ? []
                                : attempts.map((attempt, index) => ({
                                      id: attempt.id,
                                      title: attempt.title,
                                      description: attempt.outcome,
                                      dateTime: attempt.at,
                                      timeLabel: attempt.timeLabel,
                                      state: attempt.state,
                                      isCurrent: index === 0,
                                  }))
                        }
                        isLoading={isSkeleton}
                        loadingRows={attempts.length}
                    />
                )}
            </SlotView>
        </SurfaceCard>
    )
}

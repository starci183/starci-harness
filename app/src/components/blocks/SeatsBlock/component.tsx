import { EmptyNotice, SurfaceCard, Text } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One seat of the workflow's tree, resolved for drawing. */
export interface SeatView {
    readonly id: string
    readonly model: string
    readonly title: string
    readonly member: string
    readonly liveness: ToneLabel
    readonly taskHref: string | null
}

/** Copy the connected block resolves. */
export interface SeatsBlockLabels {
    readonly title: string
    readonly count: string
    readonly empty: string
    readonly openTask: string
    readonly slot: SlotLabels
}

/** Complete input of SeatsBlockBase. */
export interface SeatsBlockBaseProps {
    readonly props: {
        readonly seats: DataSlot<readonly SeatView[]>
        readonly labels: SeatsBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const SEATS_PLACEHOLDER: readonly SeatView[] = ["s0", "s1", "s2", "s3"].map((id) => ({
    id,
    model: id,
    title: "",
    member: "",
    liveness: { label: "", tone: "neutral" },
    taskHref: null,
}))

/** Pure half: the workflow's seats (Supervisor, Kernel, Ops), each with its liveness and its task. */
export const SeatsBlockBase = (props: SeatsBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SlotView slot={props.props.seats} placeholder={SEATS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false}>
            {(seats, isSkeleton) => (
                <SurfaceCard
                    kind="list"
                    label={labels.title}
                    headingLevel={2}
                    isSkeleton={isSkeleton}
                    labelEnd={
                        <Text as="span" size="sm" tone="muted" isSkeleton={isSkeleton}>
                            {labels.count}
                        </Text>
                    }
                    empty={<EmptyNotice message={labels.empty} />}
                    items={seats.map((seat) => ({
                        id: seat.id,
                        leading: { avatar: { name: seat.model, seed: seat.model, kind: "agent" } },
                        title: seat.title,
                        description: seat.member,
                        badges: [{ label: seat.liveness.label, tone: seat.liveness.tone, isDot: true }],
                        ...(seat.taskHref === null ? {} : { action: { label: labels.openTask, href: seat.taskHref } }),
                    }))}
                />
            )}
        </SlotView>
    )
}

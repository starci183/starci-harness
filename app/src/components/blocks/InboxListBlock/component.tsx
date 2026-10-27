import { Badge, ListBox, RelativeTime, SurfaceCard, type ListBoxItem } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One waiting decision as the list draws it. */
export interface DecisionItemView {
    readonly key: string
    readonly id: string
    readonly title: string
    readonly kind: ToneLabel
    readonly raisedAt: string
}

/** Complete input of InboxListBlockBase. */
export interface InboxListBlockBaseProps {
    readonly props: {
        readonly decisions: DataSlot<readonly DecisionItemView[]>
        /** The decision on screen; null when none is listed. */
        readonly selectedKey: string | null
        readonly locale: string
        readonly labels: { readonly card: string; readonly list: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void; readonly select: (key: string) => void }
}

const DECISIONS_PLACEHOLDER: readonly DecisionItemView[] = ["d0", "d1", "d2"].map((key) => ({
    key,
    id: "",
    title: "",
    kind: { label: "", tone: "neutral" },
    raisedAt: "",
}))

/** Pure half: the open escalations, newest first, one selected. */
export const InboxListBlockBase = (props: InboxListBlockBaseProps) => {
    const { labels, selectedKey, locale } = props.props
    return (
        <SurfaceCard ariaLabel={labels.card}>
            <SlotView slot={props.props.decisions} placeholder={DECISIONS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(decisions, isSkeleton) => {
                    const items: ListBoxItem[] = isSkeleton
                        ? []
                        : decisions.map((decision) => ({
                              id: decision.key,
                              label: decision.title,
                              description: (
                                  <span className="app-row">
                                      <Badge tone={decision.kind.tone}>{decision.kind.label}</Badge>
                                      <span>{decision.id}</span>
                                  </span>
                              ),
                              trailing: <RelativeTime dateTime={decision.raisedAt} locale={locale} size="xs" tone="muted" />,
                          }))
                    return (
                        <ListBox
                            label={labels.list}
                            items={items}
                            selectionMode="single"
                            selectionIndicator="none"
                            selectedIds={selectedKey === null ? [] : [selectedKey]}
                            onSelectionChange={(ids) => {
                                const id = ids[0]
                                if (id !== undefined) props.on.select(id)
                            }}
                            isLoading={isSkeleton}
                            loadingRows={decisions.length}
                        />
                    )
                }}
            </SlotView>
        </SurfaceCard>
    )
}

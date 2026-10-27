import { Badge, DataTable, EmptyNotice, SurfaceCard, Text, type DataTableColumn } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/** One check of the newest attempt, resolved for drawing. */
export interface CheckView {
    readonly id: string
    readonly name: string
    readonly tier: string
    readonly state: ToneLabel
    readonly detail: string
}

/** Copy the connected block resolves. */
export interface TaskChecksBlockLabels {
    readonly title: string
    readonly table: string
    readonly columns: { readonly name: string; readonly tier: string; readonly state: string; readonly detail: string }
    readonly slot: SlotLabels
}

/** Complete input of TaskChecksBlockBase. */
export interface TaskChecksBlockBaseProps {
    readonly props: {
        readonly checks: DataSlot<readonly CheckView[]>
        readonly labels: TaskChecksBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const CHECKS_PLACEHOLDER: readonly CheckView[] = ["c0", "c1", "c2"].map((id) => ({
    id,
    name: "",
    tier: "",
    state: { label: "", tone: "neutral" },
    detail: "",
}))

const Cell = ({ row, columnId }: { readonly row: CheckView; readonly columnId: string }) => {
    switch (columnId) {
        case "name":
            return (
                <Text size="sm" mono>
                    {row.name}
                </Text>
            )
        case "tier":
            return <Badge tone="neutral">{row.tier}</Badge>
        case "state":
            return <StatusWord status={row.state} />
        default:
            return (
                <Text size="sm" tone="muted">
                    {row.detail}
                </Text>
            )
    }
}

/** Pure half: each check's tier, state and detail on the newest attempt. */
export const TaskChecksBlockBase = (props: TaskChecksBlockBaseProps) => {
    const { labels } = props.props
    const columns: readonly DataTableColumn<CheckView>[] = [
        { id: "name", label: labels.columns.name, isRowHeader: true },
        { id: "tier", label: labels.columns.tier },
        { id: "state", label: labels.columns.state },
        { id: "detail", label: labels.columns.detail },
    ]
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView slot={props.props.checks} placeholder={CHECKS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(checks, isSkeleton) => (
                    <DataTable<CheckView>
                        label={labels.table}
                        columns={columns}
                        rows={checks}
                        renderCell={(row, columnId) => <Cell row={row} columnId={columnId} />}
                        // The slot says empty before the table could; the table still names its own empty content.
                        emptyContent={<EmptyNotice message={labels.slot.empty} />}
                        isLoading={isSkeleton}
                        loadingRows={checks.length}
                    />
                )}
            </SlotView>
        </SurfaceCard>
    )
}

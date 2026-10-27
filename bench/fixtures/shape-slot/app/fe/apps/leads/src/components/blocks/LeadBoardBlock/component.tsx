import { List, ListItem, SectionHeader, SegmentedControl, SurfaceCard, Text } from "@starci/grammar/core"
import { SlotView } from "@/components/composites/SlotView"
import type { DataSlot, LeadRow, OwnerOption, SlotLabels } from "@/modules/types"

/** The drawn shapes of the lead board, in the order its switch offers them: every lead, leads by stage, unowned leads. */
export const LEAD_BOARD_BLOCK_SHAPES = ["list", "stages", "unassigned"] as const

/** One drawn shape of the lead board; each member has a story. */
export type LeadBoardBlockShape = (typeof LEAD_BOARD_BLOCK_SHAPES)[number]

/** Copy, the two reads and the shape switch the connected lead board supplies. */
export interface LeadBoardBlockBaseProps {
    readonly shape: LeadBoardBlockShape
    readonly props: {
        readonly title: string
        readonly ownersTitle: string
        readonly shapeLabels: Readonly<Record<LeadBoardBlockShape, string>>
        readonly leads: DataSlot<readonly LeadRow[]>
        readonly owners: DataSlot<readonly OwnerOption[]>
        readonly leadsLabels: SlotLabels
        readonly ownersLabels: SlotLabels
    }
    readonly on: {
        readonly show: (shape: LeadBoardBlockShape) => void
        readonly retryLeads: () => void
        readonly retryOwners: () => void
    }
}

/** Fake leads of the ready shape: the skeleton draws these rows shimmering. */
const LEADS_PLACEHOLDER: readonly LeadRow[] = [
    { id: "placeholder-1", name: "Placeholder lead", stage: "new" },
    { id: "placeholder-2", name: "Placeholder lead", stage: "contacted" },
]

/** Fake owners of the ready shape. */
const OWNERS_PLACEHOLDER: readonly OwnerOption[] = [{ id: "placeholder-owner", name: "Placeholder owner" }]

/** The rows of one shape: the unowned shape keeps only leads nobody owns, the stage shape orders by stage. */
const rowsOf = (shape: LeadBoardBlockShape, rows: readonly LeadRow[]): readonly LeadRow[] => {
    if (shape === "unassigned") return rows.filter((row) => row.ownerName === undefined)
    if (shape === "stages") return [...rows].sort((a, b) => a.stage.localeCompare(b.stage))
    return rows
}

/** The shape a switch value names, or undefined for a value the board does not draw. */
const shapeOf = (value: string): LeadBoardBlockShape | undefined => LEAD_BOARD_BLOCK_SHAPES.find((shape) => shape === value)

/** The pure lead board: one shape at a time, each read drawn through SlotView in its own place. */
export const LeadBoardBlockBase = (props: LeadBoardBlockBaseProps) => (
    <SurfaceCard label={props.props.title}>
        <SegmentedControl
            label={props.props.title}
            options={LEAD_BOARD_BLOCK_SHAPES.map((shape) => ({ value: shape, label: props.props.shapeLabels[shape] }))}
            value={props.shape}
            onValueChange={(value) => {
                const shape = shapeOf(value)
                if (shape !== undefined) props.on.show(shape)
            }}
        />
        <SlotView slot={props.props.leads} placeholder={LEADS_PLACEHOLDER} labels={props.props.leadsLabels} onRetry={props.on.retryLeads}>
            {(leads, isSkeleton) => (
                <List label={props.props.shapeLabels[props.shape]}>
                    {rowsOf(props.shape, leads).map((lead) => (
                        <ListItem key={lead.id}>
                            <Text isSkeleton={isSkeleton}>{lead.name}</Text>
                            {props.shape === "list" ? null : <Text tone="muted" isSkeleton={isSkeleton}>{lead.stage}</Text>}
                        </ListItem>
                    ))}
                </List>
            )}
        </SlotView>
        <SectionHeader title={props.props.ownersTitle} />
        <SlotView slot={props.props.owners} placeholder={OWNERS_PLACEHOLDER} labels={props.props.ownersLabels} forbidden="hide" onRetry={props.on.retryOwners}>
            {(owners, isSkeleton) => (
                <List label={props.props.ownersTitle}>
                    {owners.map((owner) => (
                        <ListItem key={owner.id}>
                            <Text isSkeleton={isSkeleton}>{owner.name}</Text>
                        </ListItem>
                    ))}
                </List>
            )}
        </SlotView>
    </SurfaceCard>
)

import type { Meta, StoryObj } from "@storybook/react"
import { LeadBoardBlockBase } from "@/components/blocks/LeadBoardBlock/component"
import { loadingSlot } from "@/hooks/slot/slot.shared"
import { LEAD_BOARD_ARGS } from "./LeadBoardBlock.data"

/** The pure lead board: one story per drawn shape, and the skeleton story with both reads loading. */
const meta = {
    title: "Blocks/LeadBoardBlock",
    component: LeadBoardBlockBase,
    args: LEAD_BOARD_ARGS,
} satisfies Meta<typeof LeadBoardBlockBase>

export default meta

type Story = StoryObj<typeof meta>

/** Every lead in one list. */
export const ListShape: Story = { args: { shape: "list" } }

/** The leads ordered by stage, each with its stage. */
export const StagesShape: Story = { args: { shape: "stages" } }

/** Only the leads nobody owns. */
export const UnassignedShape: Story = { args: { shape: "unassigned" } }

/** Both reads loading: SlotView draws each region's placeholder with isSkeleton. */
export const Skeleton: Story = { args: { props: { ...LEAD_BOARD_ARGS.props, leads: loadingSlot(), owners: loadingSlot() } } }

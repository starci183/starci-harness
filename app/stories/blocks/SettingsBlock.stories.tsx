import type { Meta, StoryObj } from "@storybook/react-vite"
import { SettingsBlockBase } from "../../src/components/blocks/SettingsBlock/component"
import { CONFIG_GROUPS, EFFORT_OPTIONS, SETTINGS, TIER } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const members = (tier: string, items: readonly string[]) => ({
    configKey: `routing.tiers.${tier}.members`,
    label: SETTINGS.tierMembers(tier),
    items,
    pool: ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6-luna"],
    addLabel: SETTINGS.tierAdd(tier),
    addPlaceholder: SETTINGS.addModelPlaceholder,
    emptyText: SETTINGS.noMembers,
    exhaustedText: SETTINGS.noMoreModels,
    isOrdered: true,
    isAddLabelHidden: true,
    error: null,
})

const effort = (tier: string, value: string) => ({
    kind: "effort" as const,
    configKey: `routing.tiers.${tier}.effort`,
    label: SETTINGS.tierEffort(tier),
    description: null,
    error: null,
    value,
})

const meta = {
    title: "SettingsBlock",
    component: SettingsBlockBase,
    args: {
        props: {
            settings: ready({
                tabs: CONFIG_GROUPS.map((group) => ({ id: group.id, label: group.label })),
                active: {
                    id: "models",
                    label: CONFIG_GROUPS[0]?.label ?? "",
                    description: CONFIG_GROUPS[0]?.description ?? "",
                    kind: "models",
                    tiers: [
                        { id: "frontier", name: TIER.frontier?.label ?? "", description: TIER.frontier?.description ?? null, members: members("frontier", ["claude-opus-5-5"]), effort: effort("frontier", "max") },
                        { id: "medium", name: TIER.medium?.label ?? "", description: TIER.medium?.description ?? null, members: members("medium", ["claude-sonnet-5-5", "gpt-6-luna"]), effort: effort("medium", "medium") },
                    ],
                    lanes: [],
                    fields: [],
                },
            }),
            pending: [],
            hasRefusals: false,
            summary: null,
            isSaving: false,
            labels: {
                groups: SETTINGS.groups,
                scrollPrevious: SETTINGS.scrollPrevious,
                scrollNext: SETTINGS.scrollNext,
                tier: SETTINGS.tier,
                members: SETTINGS.members,
                effort: SETTINGS.effort,
                noTiers: SETTINGS.noTiers,
                pendingList: SETTINGS.pendingList,
                pendingFact: SETTINGS.pendingFact,
                pendingActions: SETTINGS.pendingActions,
                pendingSummary: SETTINGS.pending(0),
                refusedHint: SETTINGS.refusedHint,
                discard: SETTINGS.discard,
                save: SETTINGS.save,
                efforts: EFFORT_OPTIONS,
                words: {
                    add: SETTINGS.add,
                    removeTag: SETTINGS.removeTag,
                    reorderInstructions: SETTINGS.reorderInstructions,
                    reorderAnnouncement: SETTINGS.reorderAnnouncement,
                },
                slot: slotLabels(SETTINGS.empty),
            },
        },
        on: { retry: noop, selectTab: noop, change: noop, json: noop, discard: noop, save: noop },
    },
} satisfies Meta<typeof SettingsBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "SettingsBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, settings: loading() } },
    parameters: { dna: { pair: "SettingsBlock", phase: "loading" } },
}

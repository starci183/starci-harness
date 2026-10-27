import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxListBlockBase } from "../../src/components/blocks/InboxListBlock/component"
import { DECISION_KIND, INBOX, LOCALE } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "InboxListBlock",
    component: InboxListBlockBase,
    args: {
        props: {
            decisions: ready([
                { key: "starci-next/d-69", id: "d-6979996fe691", title: "Kernel không áp được graph v15", kind: DECISION_KIND.harness, raisedAt: "2026-10-27T00:41:00Z" },
                { key: "nivo-lite/d-c1", id: "d-c1106437", title: "Publish core cohort 0.12.15 + hfs 4.7.48", kind: DECISION_KIND.owner, raisedAt: "2026-10-26T22:41:00Z" },
            ]),
            selectedKey: "starci-next/d-69",
            locale: LOCALE,
            labels: { card: INBOX.listCard, list: INBOX.list, slot: slotLabels(INBOX.empty) },
        },
        on: { retry: noop, select: noop },
    },
} satisfies Meta<typeof InboxListBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "InboxListBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, decisions: loading(), selectedKey: null } },
    parameters: { dna: { pair: "InboxListBlock", phase: "loading" } },
}

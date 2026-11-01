import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxPageBlockBase } from "../../src/components/blocks/InboxPageBlock/component"
import { INBOX } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "InboxPageBlock",
    component: InboxPageBlockBase,
    args: {
        children: null,
        props: { count: ready(2), labels: { title: INBOX.title, description: INBOX.description, count: INBOX.count, slot: slotLabels(INBOX.empty) } },
        on: { retry: noop },
    },
} satisfies Meta<typeof InboxPageBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "InboxPageBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, count: loading() } },
    parameters: { dna: { pair: "InboxPageBlock", phase: "loading" } },
}

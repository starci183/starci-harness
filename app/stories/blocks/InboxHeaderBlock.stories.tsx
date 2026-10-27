import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxHeaderBlockBase } from "../../src/components/blocks/InboxHeaderBlock/component"
import { INBOX } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "InboxHeaderBlock",
    component: InboxHeaderBlockBase,
    args: {
        props: { count: ready(2), labels: { title: INBOX.title, description: INBOX.description, slot: slotLabels(INBOX.empty) } },
        on: { retry: noop },
    },
} satisfies Meta<typeof InboxHeaderBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "InboxHeaderBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, count: loading() } },
    parameters: { dna: { pair: "InboxHeaderBlock", phase: "loading" } },
}

import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxDetailBlockBase } from "../../src/components/blocks/InboxDetailBlock/component"
import { DECISION_KIND, INBOX } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "InboxDetailBlock",
    component: InboxDetailBlockBase,
    args: {
        shape: "ruling",
        props: {
            decision: ready({
                kind: DECISION_KIND.harness,
                raised: INBOX.raised("starci-next", "next-subscription-sepay", "[Supervisor] starci-next"),
                title: "Kernel không áp được graph v15",
                paragraphs: ["**Vấn đề.** Flow check từ chối FLOW_INCOMPLETE: record FE `impl.commerce.fe.subscription` thiếu code.", "**Hiện trạng.** Graph v14 còn nguyên."],
                options: [
                    { value: "1", label: "BE + FE một workflow, FE chờ code BE", description: "Kernel thêm lane FE." },
                    { value: "2", label: "Gửi Debug sửa harness" },
                ],
                command: "starci supervisor submit \"D:/.claude/.runtime/projects/starci-next/owner-commands/d-6979996fe691.json\" --cwd \"D:/Repositories/starci-next\"",
            }),
            option: "1",
            note: "",
            canSend: true,
            isPending: false,
            refusal: null,
            ruled: { option: "BE + FE một workflow, FE chờ code BE", note: INBOX.noNote },
            labels: {
                detail: INBOX.detail,
                body: INBOX.body,
                ruling: INBOX.ruling,
                note: INBOX.note,
                send: INBOX.send,
                commandPrefix: INBOX.commandPrefix,
                commandSuffix: INBOX.commandSuffix,
                sent: INBOX.sent,
                ruledOption: INBOX.ruledOption,
                ruledNote: INBOX.ruledNote,
                ruledHint: INBOX.ruledHint,
                slot: slotLabels(INBOX.empty, INBOX.emptyHint),
            },
        },
        on: { retry: noop, setOption: noop, setNote: noop, send: noop },
    },
} satisfies Meta<typeof InboxDetailBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ruling: Story = { args: { shape: "ruling" }, parameters: { dna: { pair: "InboxDetailBlock", phase: "ready" } } }

export const Ruled: Story = { args: { shape: "ruled" }, parameters: { dna: { pair: "InboxDetailBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { shape: "ruling", props: { ...meta.args.props, decision: loading() } },
    parameters: { dna: { pair: "InboxDetailBlock", phase: "loading" } },
}

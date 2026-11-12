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
                raised: INBOX.raised("demo-app", "add-search", "[Supervisor] demo-app"),
                title: "Kernel could not apply graph v15",
                paragraphs: ["**Problem.** Flow check rejected FLOW_INCOMPLETE: FE record `impl.search.fe.ui` lacks code.", "**State.** Graph v14 is intact."],
                options: [
                    { value: "1", label: "BE + FE in one workflow, FE waits for BE code", description: "Kernel adds an FE lane." },
                    { value: "2", label: "Send Debug to fix the harness" },
                ],
                command: "starci supervisor submit \"/path/to/harness/projects/demo-app/owner-commands/d-6979996fe691.json\" --cwd \"/path/to/demo-app\"",
            }),
            option: "1",
            note: "",
            canSend: true,
            isPending: false,
            refusal: null,
            ruled: { option: "BE + FE in one workflow, FE waits for BE code", note: INBOX.noNote },
            labels: {
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

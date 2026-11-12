import type { Meta, StoryObj } from "@storybook/react-vite"
import { OwnerRequestBlockBase } from "../../src/components/blocks/OwnerRequestBlock/component"
import { OWNER_REQUEST } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "OwnerRequestBlock",
    component: OwnerRequestBlockBase,
    args: {
        props: {
            projects: ready([
                { value: "demo-app", label: "demo-app" },
                { value: "demo-lib", label: "demo-lib" },
            ]),
            requests: ready([
                { id: "r-0214a7c3b9e1", project: "demo-app", text: "Start workflow uat-sign-in after auth-sign-in is done.", status: { label: OWNER_REQUEST.open, tone: "warning" } },
                { id: "r-09c1e5d27f40", project: "demo-lib", text: "Kernels back to Claude.", status: { label: OWNER_REQUEST.closedBy("c-4f1a82d0"), tone: "success" } },
            ]),
            project: "demo-app",
            text: "Start workflow uat-sign-in after auth-sign-in is done.",
            canSend: true,
            isPending: false,
            labels: {
                card: OWNER_REQUEST.card,
                project: OWNER_REQUEST.project,
                projectPlaceholder: OWNER_REQUEST.projectPlaceholder,
                text: OWNER_REQUEST.text,
                textHint: OWNER_REQUEST.textHint,
                send: OWNER_REQUEST.send,
                commandPrefix: OWNER_REQUEST.commandPrefix,
                command: "starci supervisor ask",
                commandSuffix: OWNER_REQUEST.commandSuffix,
                list: OWNER_REQUEST.list,
                projectsSlot: slotLabels(OWNER_REQUEST.noProjects),
                requestsSlot: slotLabels(OWNER_REQUEST.empty, OWNER_REQUEST.emptyHint),
            },
        },
        on: { retryProjects: noop, retryRequests: noop, setProject: noop, setText: noop, send: noop },
    },
} satisfies Meta<typeof OwnerRequestBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "OwnerRequestBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, projects: loading(), requests: loading(), project: null, text: "", canSend: false } },
    parameters: { dna: { pair: "OwnerRequestBlock", phase: "loading" } },
}

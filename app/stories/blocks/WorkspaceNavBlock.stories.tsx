import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkspaceNavBlockBase } from "../../src/components/blocks/WorkspaceNavBlock/component"
import { CONNECTION, NAV, supervisorStatus } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "WorkspaceNavBlock",
    component: WorkspaceNavBlockBase,
    args: {
        props: {
            presentation: "rail",
            selectedKey: "overview",
            logoSrc: "starci-logo.png",
            version: NAV.version("0.1.0"),
            projects: [
                { key: "starci-next", name: "starci-next", supervisor: supervisorStatus("alive"), isAlive: true },
                { key: "nivo-lite", name: "nivo-lite", supervisor: supervisorStatus("stalled"), isAlive: false },
            ],
            openDecisions: 2,
            status: ready("Dữ liệu mẫu · Tick 51 lúc 12:44"),
            labels: {
                landmark: NAV.landmark,
                product: NAV.product,
                overview: NAV.overview,
                workflows: NAV.workflows,
                inbox: NAV.inbox,
                inboxBadge: NAV.inboxBadge(2),
                settings: NAV.settings,
                projects: NAV.projects,
                slot: slotLabels(CONNECTION.fixtures),
            },
        },
        on: { select: noop, home: noop, retry: noop },
    },
    parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspaceNavBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "WorkspaceNavBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, projects: [], openDecisions: 0, status: loading() } },
    parameters: { dna: { pair: "WorkspaceNavBlock", phase: "loading" } },
}

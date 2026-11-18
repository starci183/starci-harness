import type { Meta, StoryObj } from "@storybook/react-vite"
import { VpsFleetBlockBase, type VpsFleetView } from "../../src/components/blocks/VpsFleetBlock/component"
import { VPS } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const FLEET: VpsFleetView = {
    alert: { title: VPS.alertTitle(1), lines: [VPS.alertLine("vps-sg1", VPS.failedLogins(312, 24))] },
    rows: [
        {
            id: "vps-sg1",
            serverLine: VPS.serverLine("vultr", "ubuntu", 2),
            status: { label: VPS.up("41,2"), tone: "success" },
            statusDetail: "",
            cpu: VPS.cpu("2", "0,4"),
            usage: VPS.usage("62%", "48%"),
            failed: "312",
            isFailedAlert: true,
            swarmRole: "manager",
            swarm: VPS.swarm("1", "6"),
            uiUrl: "https://ui-vps-sg1.starci.org",
            uiLabel: "ui-vps-sg1.starci.org",
            ingress: "tunnel",
            panelUrl: "https://panel.example.com",
        },
        {
            id: "vps-old",
            serverLine: VPS.serverLine("contabo", "debian", 0),
            status: { label: VPS.unreachable, tone: "danger" },
            statusDetail: "ssh: connect timed out",
            cpu: "–",
            usage: "",
            failed: "–",
            isFailedAlert: false,
            swarmRole: "",
            swarm: "–",
            uiUrl: "https://ui-vps-old.starci.org",
            uiLabel: "ui-vps-old.starci.org",
            ingress: "tunnel",
            panelUrl: null,
        },
    ],
}

const meta = {
    title: "VpsFleetBlock",
    component: VpsFleetBlockBase,
    args: {
        props: {
            fleet: ready(FLEET),
            labels: { title: VPS.tableTitle, fact: VPS.tableFact, panel: VPS.panel, columns: VPS.columns, slot: slotLabels(VPS.empty, VPS.emptyHint) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof VpsFleetBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "VpsFleetBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, fleet: loading() } },
    parameters: { dna: { pair: "VpsFleetBlock", phase: "loading" } },
}

import type { Meta, StoryObj } from "@storybook/react-vite"
import { ProvidersBlockBase, type ProviderView } from "../../src/components/blocks/ProvidersBlock/component"
import { CIRCUIT, LOCALE, OVERVIEW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const provider = (id: string, name: string, usage: number, circuit: keyof typeof CIRCUIT): ProviderView => ({
    id,
    name,
    circuit: { label: CIRCUIT[circuit].label, tone: CIRCUIT[circuit].tone },
    meterTone: CIRCUIT[circuit].meter,
    usage,
    usageText: `${usage}%`,
    quotaLabel: OVERVIEW.providerQuota(name),
    windows: `5h ${usage}% · tuần ${Math.round(usage / 2)}%`,
    reset: null,
    running: OVERVIEW.running("opus 3, sonnet 4", 6),
})

const PROVIDERS: readonly ProviderView[] = [
    provider("claude", "Claude", 42, "closed"),
    provider("codex", "Codex", 82, "near-reserve"),
    provider("devin", "Devin", 31, "closed"),
    provider("cursor", "Cursor", 100, "open"),
]

const meta = {
    title: "ProvidersBlock",
    component: ProvidersBlockBase,
    args: {
        props: {
            providers: ready(PROVIDERS),
            labels: { title: OVERVIEW.providersTitle, fact: OVERVIEW.providersFact, locale: LOCALE, slot: slotLabels(OVERVIEW.noProviders) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof ProvidersBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "ProvidersBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, providers: loading() } },
    parameters: { dna: { pair: "ProvidersBlock", phase: "loading" } },
}

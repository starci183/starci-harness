import type { Overview, ProviderStatus } from "@contract"
import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { circuitView, nextReset, peakUsage, runningLine, windowsLine } from "../../../modules/format"
import { COMMON, LOCALE, OVERVIEW, PROVIDER_NAME } from "../../../modules/i18n"
import { ProvidersBlockBase, type ProviderView } from "./component"

const toView = (provider: ProviderStatus): ProviderView => {
    const name = PROVIDER_NAME[provider.provider]
    const circuit = circuitView(provider)
    const reset = nextReset(provider)
    const verb = provider.circuit === "open" ? OVERVIEW.reopen : OVERVIEW.reset
    const usage = peakUsage(provider)
    return {
        id: provider.provider,
        name,
        circuit: { label: circuit.label, tone: circuit.tone },
        meterTone: circuit.meter,
        usage,
        usageText: `${usage}%`,
        quotaLabel: OVERVIEW.providerQuota(name),
        windows: windowsLine(provider),
        reset: reset === null ? null : { at: reset, template: `${verb} {time}`, fallback: `${verb} ${COMMON.dash}` },
        running: runningLine(provider),
    }
}

/** The providers region of the overview. */
export const ProvidersBlock = () => {
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    return (
        <ProvidersBlockBase
            props={{
                providers: mapSlot(slotOfQuery(query), (overview: Overview) => overview.providers.map(toView)),
                labels: {
                    title: OVERVIEW.providersTitle,
                    fact: OVERVIEW.providersFact,
                    locale: LOCALE,
                    slot: slotLabels(OVERVIEW.noProviders, OVERVIEW.noProvidersHint),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
